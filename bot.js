import dotenv from 'dotenv';
import express from 'express';
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Redis } from '@upstash/redis';

dotenv.config();

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY;
const GITHUB_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const AI_API = process.env.AI_API;
const AI_KEY = process.env.AI_KEY;
const MODEL_ID = process.env.MODEL_ID;
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'your_analysis_model'; // Model for Stage 1: Code Analysis
const COMMENT_MODEL = process.env.COMMENT_MODEL || 'your_comment_model'; // Model for Stage 2: Comment Generation
const BOT_USERNAME = process.env.BOT_USERNAME || 'Xibe-review';

// Initialize Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Utility function to limit mentions in comments
function limitMentionsInComment(comment, maxMentionsPerUser = 2) {
  if (!comment || typeof comment !== 'string') {
    return comment;
  }

  // Find all mentions in the comment
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(comment)) !== null) {
    mentions.push({
      username: match[1],
      fullMatch: match[0],
      index: match.index
    });
  }

  // Count mentions per user
  const mentionCounts = {};
  mentions.forEach(mention => {
    mentionCounts[mention.username] = (mentionCounts[mention.username] || 0) + 1;
  });

  // If no user exceeds the limit, return original comment
  const exceededUsers = Object.keys(mentionCounts).filter(user => mentionCounts[user] > maxMentionsPerUser);
  if (exceededUsers.length === 0) {
    return comment;
  }

  console.log(`⚠️  Limiting mentions: ${exceededUsers.join(', ')} mentioned more than ${maxMentionsPerUser} times`);

  // Remove excess mentions for each user
  let result = comment;
  exceededUsers.forEach(user => {
    const userMentions = mentions.filter(m => m.username === user);
    const mentionsToRemove = userMentions.slice(maxMentionsPerUser); // Keep first N, remove rest
    
    // Remove mentions in reverse order to maintain indices
    mentionsToRemove.reverse().forEach(mention => {
      const beforeMention = result.substring(0, mention.index);
      const afterMention = result.substring(mention.index + mention.fullMatch.length);
      result = beforeMention + afterMention;
    });
  });

  return result;
}

// Database operations for analytics
async function saveReviewToDatabase(reviewData) {
  try {
    const reviewId = `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reviewRecord = {
      id: reviewId,
      timestamp: new Date().toISOString(),
      repository: reviewData.repository,
      pullRequest: reviewData.pullNumber,
      user: reviewData.user,
      installationId: reviewData.installationId,
      model: reviewData.model,
      reviewContent: reviewData.reviewContent,
      processingTime: reviewData.processingTime,
      status: 'completed'
    };
    
    // Store individual review
    await redis.setex(`review:${reviewId}`, 86400 * 30, JSON.stringify(reviewRecord)); // 30 days TTL
    
    // Add to reviews list
    await redis.lpush('reviews:all', reviewId);
    
    // Check if this is a new user BEFORE updating their stats
    const userExists = await redis.exists(`user:${reviewData.user}:stats`);
    
    // Update user analytics
    await redis.hincrby(`user:${reviewData.user}:stats`, 'reviews', 1);
    await redis.hset(`user:${reviewData.user}:info`, {
      lastActive: new Date().toISOString(),
      totalReviews: await redis.hget(`user:${reviewData.user}:stats`, 'reviews') || 0
    });
    
    // Update global analytics
    await redis.hincrby('analytics:global', 'totalReviews', 1);
    
    // Only increment totalUsers if this is a new user
    if (!userExists) {
      await redis.hincrby('analytics:global', 'totalUsers', 1);
    }
    
    console.log(`📊 Review saved to database: ${reviewId}`);
    console.log(`📊 Analytics updated - User: ${reviewData.user}, Repository: ${reviewData.repository}`);
    return reviewId;
  } catch (error) {
    console.error('❌ Error saving review to database:', error);
    console.error('❌ Redis connection might be down - analytics not saved');
    return null;
  }
}

async function getUserStats(userId) {
  try {
    const userStats = await redis.hgetall(`user:${userId}:stats`);
    const userInfo = await redis.hgetall(`user:${userId}:info`);
    
    return {
      userId,
      totalReviews: parseInt(userStats.reviews || 0),
      lastActive: userInfo.lastActive,
      ...userStats
    };
  } catch (error) {
    console.error('❌ Error getting user stats:', error);
    return null;
  }
}

async function getGlobalAnalytics() {
  try {
    const analytics = await redis.hgetall('analytics:global');
    const recentReviews = await redis.lrange('reviews:all', 0, 9);
    
    console.log('📊 Analytics Debug:');
    console.log(`   Redis analytics data:`, analytics);
    console.log(`   Recent reviews count:`, recentReviews.length);
    console.log(`   Total users: ${analytics.totalUsers || 0}`);
    console.log(`   Total reviews: ${analytics.totalReviews || 0}`);
    
    return {
      totalUsers: parseInt(analytics.totalUsers || 0),
      totalReviews: parseInt(analytics.totalReviews || 0),
      recentReviews: recentReviews.length
    };
  } catch (error) {
    console.error('❌ Error getting global analytics:', error);
    console.log('⚠️  Redis might not be connected - returning fallback data');
    return { totalUsers: 0, totalReviews: 0, recentReviews: 0 };
  }
}

async function getGitHubAppInstallations() {
  try {
    if (!hasGitHubApp) {
      console.log('⚠️ GitHub App not configured, cannot fetch installations');
      return 0;
    }

    // Get app installations using GitHub App authentication
    const octokit = new Octokit({
      auth: await getGitHubAppToken(),
    });

    const installations = await octokit.rest.apps.listInstallations();
    const installationCount = installations.data.length;
    
    console.log(`📊 GitHub App installations: ${installationCount}`);
    return installationCount;
  } catch (error) {
    console.error('❌ Error fetching GitHub App installations:', error);
    return 0;
  }
}

async function getRecentReviews(limit = 10) {
  try {
    const reviewIds = await redis.lrange('reviews:all', 0, limit - 1);
    const reviews = [];
    
    for (const id of reviewIds) {
      const reviewData = await redis.get(`review:${id}`);
      if (reviewData) {
        try {
          const review = typeof reviewData === 'string' ? JSON.parse(reviewData) : reviewData;
          reviews.push(review);
        } catch (parseError) {
          console.error(`❌ Error parsing review ${id}:`, parseError);
        }
      }
    }
    
    return reviews;
  } catch (error) {
    console.error('❌ Error getting recent reviews:', error);
    return [];
  }
}

// Validate GitHub App credentials first (prioritized over PAT)
const hasGitHubApp = GITHUB_APP_ID && GITHUB_PRIVATE_KEY;
const hasGitHubPAT = GITHUB_TOKEN;

if (!hasGitHubApp && !hasGitHubPAT) {
  console.warn('⚠️  No GitHub authentication configured - bot will run in test mode only');
  console.warn('   Set GITHUB_APP_ID + GITHUB_PRIVATE_KEY for GitHub App (recommended)');
  console.warn('   Or set GITHUB_TOKEN for Personal Access Token (fallback)');
}

if (!AI_API || !AI_KEY) {
  console.error('❌ Error: AI_API and AI_KEY must be set in environment variables');
  process.exit(1);
}

// Initialize authentication - prioritize GitHub App over PAT
let authMode = null;
if (hasGitHubApp) {
  console.log('🔐 Initializing GitHub App authentication...');
  console.log(`   App ID: ${GITHUB_APP_ID}`);
  console.log('   ✅ GitHub App credentials found - using bot account authentication');
  authMode = 'app';
} else if (hasGitHubPAT) {
  console.log('🔑 Using Personal Access Token (PAT) authentication');
  console.log('   ⚠️  Comments will appear from your personal account');
  console.log('   💡 Consider using GitHub App for bot account with [bot] badge');
  authMode = 'pat';
} else {
  console.log('🧪 Running in test mode (no GitHub authentication)');
  authMode = 'test';
}

// For backward compatibility with PAT
let defaultOctokit = null;
if (hasGitHubPAT) {
  defaultOctokit = new Octokit({ auth: GITHUB_TOKEN });
}

const openai = new OpenAI({
  apiKey: AI_KEY,
  baseURL: AI_API + '/v1'
});


// Model selection - use the configured MODEL_ID or fallback to ANALYSIS_MODEL
function selectModelForPR(pr, files, diff) {
  return MODEL_ID || ANALYSIS_MODEL || 'your_default_model';
}

console.log('🤖 Bot Configuration:');
console.log(`   AI API: ${AI_API}/v1`);
console.log(`   Default Model: ${MODEL_ID}`);
console.log(`   Analysis Model (Stage 1): ${ANALYSIS_MODEL}`);
console.log(`   Comment Model (Stage 2): ${COMMENT_MODEL}`);
console.log(`   Bot Username: ${BOT_USERNAME}`);
console.log(`   Port: ${PORT}`);
console.log('');

// Helper function to get Octokit instance for a specific installation
async function getOctokitForInstallation(installationId) {
  if (authMode === 'app') {
    // Create an authenticated Octokit instance for this installation
    // Load private key from environment variable (base64 encoded to avoid special characters)
    let privateKey;
    
    // Load private key from environment variable
    console.log('🔐 Loading private key from environment variable');
    privateKey = GITHUB_PRIVATE_KEY;

    // Ensure proper PEM format with correct line endings
    privateKey = privateKey.trim();
    
    // Validate that the private key has the correct format
    if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') || !privateKey.includes('-----END RSA PRIVATE KEY-----')) {
      console.error('❌ Invalid private key format - missing PEM headers');
      throw new Error('Invalid private key format - missing PEM headers');
    }

    console.log(`🔐 Creating Octokit with App ID: ${GITHUB_APP_ID}, Installation ID: ${installationId}`);

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: GITHUB_APP_ID,
        privateKey: privateKey,
        installationId: installationId,
      },
    });
    return octokit;
  } else if (defaultOctokit) {
    return defaultOctokit;
  } else if (authMode === 'test') {
    // Return a mock Octokit for testing
    console.log('🧪 Using mock Octokit for testing');
    return {
      reactions: {
        createForIssueComment: async () => {
          throw { status: 404, message: 'Mock: Comment not found (expected for testing)' };
        }
      },
      issues: {
        createComment: async () => {
          throw { status: 403, message: 'Mock: Resource not accessible (expected for testing)' };
        }
      },
      pulls: {
        get: async ({ mediaType }) => {
          if (mediaType && mediaType.format === 'diff') {
            return {
              data: `diff --git a/test/file.js b/test/file.js
+ console.log("Mock diff content for testing");
- console.log("Old content");`
            };
          }
          throw { status: 404, message: 'Mock: PR not found (expected for testing)' };
        },
        listFiles: async () => {
          return {
            data: [
              {
                filename: 'test/file.js',
                status: 'modified',
                additions: 1,
                deletions: 1,
                patch: '+ console.log("Mock patch content");'
              }
            ]
          };
        }
      }
    };
  } else {
    throw new Error('No GitHub authentication available');
  }
}

async function getPRFiles(octokit, owner, repo, pullNumber) {
  try {
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return files;
  } catch (error) {
    console.error('Error fetching PR files:', error);
    throw error;
  }
}

async function getPRDiff(octokit, owner, repo, pullNumber) {
  try {
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: {
        format: 'diff',
      },
    });
    return pr;
  } catch (error) {
    console.error('Error fetching PR diff:', error);
    throw error;
  }
}

// Stage 1: Analyze individual files
async function analyzeFileWithAI(modelName, prTitle, prBody, file, userComment = null) {
  const maxInputChars = 8000; // Default character limit

  const filePatch = (file.patch || '').substring(0, maxInputChars);
  
  let analysisPrompt = `You are an expert code analyst specializing in security and code quality. Analyze this specific file change from a pull request.

**PR Context:**
- Title: ${prTitle}
- Description: ${prBody || 'No description provided'}

**File Being Analyzed:**
- Filename: ${file.filename}
- Status: ${file.status}
- Changes: +${file.additions} additions, -${file.deletions} deletions

**Code Changes:**
\`\`\`diff
${filePatch}
\`\`\``;

  if (userComment) {
    analysisPrompt += `

**User's Request/Question:**
"${userComment}"

**IMPORTANT:** Address the user's specific request or question in your analysis.`;
  }

  analysisPrompt += `

**CRITICAL FOCUS AREAS:**
1. 🔴 **HARDCODED VALUES** - Identify any hardcoded credentials, API keys, secrets, passwords, URLs, IP addresses, or sensitive configuration
2. 🔴 **SECURITY VULNERABILITIES** - SQL injection, XSS, authentication issues, authorization bypasses, insecure dependencies
3. 🔴 **CODE SMELLS** - Poor practices, anti-patterns, potential bugs

Provide your analysis in this structure:

## 📄 **File: ${file.filename}**

### 🔴 **CRITICAL ISSUES** (if any)
- List any hardcoded secrets, credentials, or severe security vulnerabilities
- Mark each with 🔴 emoji for visibility

### ⚠️ **Security Concerns** (if any)
- Identify security vulnerabilities or risks
- Include specific line references

### 💡 **Code Quality Issues** (if any)
- Code smells, anti-patterns, potential bugs
- Best practice violations

### ✅ **Positive Aspects** (if any)
- What's done well in this file

**Guidelines:**
- Be specific with line numbers and code examples
- Focus on ACTIONABLE findings
- Highlight critical issues clearly
- Do NOT use placeholder text`;

  console.log(`🔍 Analyzing file: ${file.filename}`);

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: 'system',
        content: 'You are a security-focused code analyst. Identify hardcoded values, security vulnerabilities, and code quality issues. Be specific and actionable. Use 🔴 emoji for critical issues.',
      },
      {
        role: 'user',
        content: analysisPrompt,
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  });

  return response.choices[0].message.content;
}

// Stage 2: Synthesize all file analyses into comprehensive review
async function synthesizeReviewFromAnalyses(modelName, prTitle, prBody, files, fileAnalyses, prAuthor, mentionedBy, userComment = null) {
  
  const filesList = files.map(f => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`).join('\n');
  const allAnalyses = fileAnalyses.join('\n\n---\n\n');
  
  let synthesisPrompt = `You are an expert code reviewer. Based on detailed file-by-file analyses, create a comprehensive final review.

**PR Context:**
- Title: ${prTitle}
- Description: ${prBody || 'No description provided'}
- Author: @${prAuthor}
- Files Changed (${files.length} files): 
${filesList}`;

  if (mentionedBy && mentionedBy !== prAuthor) {
    synthesisPrompt += `
- Requested by: @${mentionedBy}`;
  }


  if (userComment) {
    synthesisPrompt += `

**User's Request/Question:**
"${userComment}"

**IMPORTANT:** Address the user's specific request in your final review.`;
  }

  synthesisPrompt += `

**Individual File Analyses:**
${allAnalyses}

**YOUR TASK:**
Create a comprehensive, professional code review that:
1. Highlight ALL critical issues (hardcoded values, security vulnerabilities) from individual analyses
2. Provides a clear overall assessment
3. Tags relevant users appropriately
4. Uses 🔴 emoji to highlight critical issues for visibility
5. Gives actionable recommendations

Write your review in this format:

## 🤖 Code Review

**@${prAuthor}** - Thank you for your contribution!${mentionedBy && mentionedBy !== prAuthor ? ` (Review requested by @${mentionedBy})` : ''}

### ✅ **Recommendation**
[APPROVE / REQUEST_CHANGES / COMMENT] - Clear verdict with reasoning

### 📋 **Summary**
**What this PR does:** Brief description of changes
**Impact:** Effect on the codebase
**Files analyzed:** ${files.length} files

### 🔴 **CRITICAL ISSUES** (if any)
List all critical issues found (hardcoded secrets, severe security vulnerabilities, syntax errors)
- Use 🔴 emoji for each critical item
- Tag @${prAuthor} for attention

### ⚠️ **Security & Best Practices**
- Security vulnerabilities found
- Best practice violations
- Recommended fixes

### 💡 **Suggestions for Improvement**
- Code quality improvements
- Performance optimizations
- Maintainability enhancements

### ✅ **What's Good**
- Positive aspects of the PR

### 📝 **Action Items**
- [ ] Specific tasks for @${prAuthor}

**Guidelines:**
- Be professional and constructive
- Use specific examples and line numbers
- Prioritize critical issues
- Use 🔴 for critical items to make them stand out`;

  console.log(`💬 Synthesizing final review from ${fileAnalyses.length} file analyses`);

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: 'system',
        content: `You are a professional code reviewer. Synthesize file analyses into a clear, actionable review. Highlight critical issues with 🔴 emoji. Tag users appropriately. Be constructive and specific.`,
      },
      {
        role: 'user',
        content: synthesisPrompt,
      },
    ],
    max_tokens: 3000,
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

// This function is now replaced by the multi-agent approach
// Kept for backward compatibility reference only
async function generateReviewComment_LEGACY(modelName, analysis, prTitle, prBody, files, diff, userComment = null) {
  // Legacy function - now using synthesizeReviewFromAnalyses instead
  throw new Error('This function has been replaced by multi-agent review system');
}

// Main multi-agent review function
async function reviewCodeWithAI(modelName, prTitle, prBody, files, diff, prAuthor, mentionedBy = null, userComment = null) {
  try {
    console.log(`🚀 Starting multi-agent AI review process`);
    console.log(`   Analysis Model: ${ANALYSIS_MODEL}`);
    console.log(`   Synthesis Model: ${COMMENT_MODEL}`);
    console.log(`   Files to analyze: ${files.length}`);
    console.log(`   PR Author: @${prAuthor}`);
    if (mentionedBy) {
      console.log(`   Review requested by: @${mentionedBy}`);
    }
    if (userComment) {
      console.log(`   User Comment: "${userComment.substring(0, 100)}${userComment.length > 100 ? '...' : ''}"`);
    }
    
    // Agent 1: Analyze each file individually
    console.log(`\n📊 Agent 1: Analyzing ${files.length} files individually...`);
    const fileAnalyses = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`   [${i + 1}/${files.length}] Analyzing: ${file.filename}`);
      
      try {
        const analysis = await analyzeFileWithAI(ANALYSIS_MODEL, prTitle, prBody, file, userComment);
        fileAnalyses.push(analysis);
        console.log(`   ✅ Completed: ${file.filename}`);
      } catch (error) {
        console.error(`   ❌ Error analyzing ${file.filename}:`, error.message);
        fileAnalyses.push(`## 📄 **File: ${file.filename}**\n\n⚠️ Analysis skipped due to error: ${error.message}`);
      }
    }
    
    console.log(`✅ Agent 1 completed: Analyzed ${fileAnalyses.length} files`);
    
    // Agent 2: Synthesize all analyses into final review
    console.log(`\n💬 Agent 2: Synthesizing comprehensive review...`);
    const finalReview = await synthesizeReviewFromAnalyses(
      COMMENT_MODEL,
      prTitle,
      prBody,
      files,
      fileAnalyses,
      prAuthor,
      mentionedBy,
      userComment
    );
    console.log(`✅ Agent 2 completed: Final review generated`);
    
    return finalReview;
  } catch (error) {
    console.error(`Error in multi-agent review process:`, error);
    throw error;
  }
}

// Ensure the review follows the proper structure
function ensureProperStructure(content) {
  // Check if the content already has the proper structure
  if (content.includes('## ✅ **Recommendation**') && 
      content.includes('## 📋 **Summary**') && 
      content.includes('## 🔍 **Code Analysis**')) {
    return content;
  }
  
  // If not, wrap it in the proper structure
  return `## ✅ **Recommendation**
**[COMMENT]** - [Reasoning for the recommendation]

## 📋 **Summary**
**What this PR does:** [Analysis of the changes and their purpose]

**Key changes:** [Main modifications identified]

**Impact:** [Effect on the codebase and users]

## 🔍 **Code Analysis**

### ✅ **What's Good**
- [Positive aspects found with specific examples]

### ⚠️ **Issues Found**
- [Issues identified with line references]

### 💡 **Suggestions for Improvement**
- [Recommendations provided with code examples]

## 🔒 **Security & Best Practices**
- [Security and best practice considerations]

## 📝 **Action Items**
- [ ] [Actionable tasks with clear instructions]

---

${content}`;
}

// Generate code snippets for key changes
function generateCodeSnippets(files, diff) {
  const snippets = [];
  
  // Extract key code snippets from files
  files.forEach(file => {
    if (file.patch && file.patch.length > 0) {
      const lines = file.patch.split('\n');
      const addedLines = lines.filter(line => line.startsWith('+')).slice(0, 10); // More additions for context
      const removedLines = lines.filter(line => line.startsWith('-')).slice(0, 8); // More removals for context
      
      if (addedLines.length > 0 || removedLines.length > 0) {
        snippets.push(`\n### 📄 **${file.filename}** (${file.status})`);
        snippets.push(`**Changes:** +${file.additions} additions, -${file.deletions} deletions`);
        
        if (addedLines.length > 0) {
          snippets.push('\n**➕ Added Code:**');
          snippets.push('```diff');
          addedLines.forEach(line => snippets.push(line));
          snippets.push('```');
        }
        
        if (removedLines.length > 0) {
          snippets.push('\n**➖ Removed Code:**');
          snippets.push('```diff');
          removedLines.forEach(line => snippets.push(line));
          snippets.push('```');
        }
        
        // Add context lines for better understanding
        const contextLines = lines.filter(line => !line.startsWith('+') && !line.startsWith('-') && line.trim().length > 0).slice(0, 5);
        if (contextLines.length > 0) {
          snippets.push('\n**📝 Context:**');
          snippets.push('```');
          contextLines.forEach(line => snippets.push(line));
          snippets.push('```');
        }
        
        // Add file type information for better syntax highlighting
        const fileExtension = file.filename.split('.').pop();
        if (fileExtension) {
          snippets.push(`\n**📋 File Type:** ${fileExtension.toUpperCase()}`);
        }
      }
    }
  });
  
  return snippets.length > 0 ? `\n## 📝 **Key Code Changes**\n${snippets.join('\n')}` : '';
}

// Backward compatibility function
async function reviewCodeWithOpenAI(prTitle, prBody, files, diff, prAuthor, mentionedBy = null, userComment = null) {
  return await reviewCodeWithAI(MODEL_ID, prTitle, prBody, files, diff, prAuthor, mentionedBy, userComment);
}

async function postReviewComment(octokit, owner, repo, pullNumber, comment) {
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: comment,
    });
    console.log(`✅ Posted review comment to PR #${pullNumber}`);
    return true;
  } catch (error) {
    console.error('❌ Error posting comment:', error.message);
    if (error.status === 403 || error.status === 404) {
      console.log(`ℹ️  Cannot post comment - likely testing with fake data or insufficient permissions`);
      console.log(`💡 Review content (would be posted to GitHub):`);
      console.log(`=======================================`);
      console.log(comment);
      console.log(`=======================================`);
      return false;
    }
    throw error;
  }
}

async function handlePRReviewRequest(octokit, owner, repo, pullNumber, commentId, webhookLogId = null, isAutoReview = false, installationId = null, userComment = null, mentionedBy = null) {
  const startTime = Date.now();
  const lockKey = `lock:review:${owner}:${repo}:${pullNumber}`;
  const recentCommentKey = `recent_comment:${owner}:${repo}:${pullNumber}`;
  
  try {
    console.log(`🤖 Starting review for PR #${pullNumber} in ${owner}/${repo}`);

    // Acquire lock to prevent concurrent processing of the same PR
    let lockAcquired = false;
    try {
      // Try to acquire lock with 10-minute expiry (in case of crash)
      const lockValue = `${Date.now()}_${Math.random()}`;
      const acquired = await redis.set(lockKey, lockValue, {
        nx: true,  // Only set if key doesn't exist (atomic)
        ex: 600    // Expire in 10 minutes
      });
      
      if (!acquired) {
        console.log(`⏭️  Skipping review - another instance is already processing PR #${pullNumber}`);
        return;
      }
      lockAcquired = true;
      console.log(`🔒 Acquired lock for PR #${pullNumber}`);
    } catch (redisError) {
      console.log('⚠️  Could not acquire lock (Redis error):', redisError.message);
      console.log('⚠️  Proceeding without lock - may result in duplicate reviews');
    }

    // Check for duplicate processing and recent comments
    try {
      // Check if we've already processed this specific comment
      const processedCommentKey = `processed_comment:${owner}:${repo}:${commentId}`;
      const alreadyProcessed = await redis.get(processedCommentKey);
      if (alreadyProcessed) {
        console.log(`⏭️  Skipping review - already processed comment ${commentId} on PR #${pullNumber}`);
        if (lockAcquired) {
          await redis.del(lockKey);
        }
        return;
      }

      // For non-tagged requests, check if bot commented recently to prevent spam
      if (!mentionedBy) {
        const recentComment = await redis.get(recentCommentKey);
        if (recentComment) {
          const commentTime = new Date(recentComment);
          const timeDiff = Date.now() - commentTime.getTime();
          // If commented within last 5 minutes, skip to prevent duplicates
          if (timeDiff < 5 * 60 * 1000) {
            console.log(`⏭️  Skipping review - bot already commented recently on PR #${pullNumber}`);
            if (lockAcquired) {
              await redis.del(lockKey);
            }
            return;
          }
        }
      } else {
        console.log(`🎯 Bot was tagged by @${mentionedBy} - proceeding with review regardless of recent activity`);
      }
    } catch (redisError) {
      console.log('⚠️  Could not check recent comments (Redis error):', redisError.message);
    }

    let pr, files, diff;

    // Get PR details (handle errors gracefully)
    try {
      const prResponse = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      pr = prResponse.data;
      console.log(`✅ Fetched PR details: "${pr.title}"`);
    } catch (error) {
      console.error(`❌ Error fetching PR details:`, error.message);
      if (error.status === 403 || error.status === 404) {
        console.log(`ℹ️  PR doesn't exist - using mock data for testing`);
        pr = {
          title: 'Mock PR Title',
          body: 'Mock PR description for testing purposes',
          user: { login: 'test-user' }
        };
      } else {
        throw error;
      }
    }

    // Get PR author
    const prAuthor = pr.user?.login || 'unknown';

    // Get PR files and diff (handle errors gracefully)
    try {
      files = await getPRFiles(octokit, owner, repo, pullNumber);
      diff = await getPRDiff(octokit, owner, repo, pullNumber);
      console.log(`✅ Fetched ${files.length} files and diff`);
    } catch (error) {
      console.error(`❌ Error fetching PR files/diff:`, error.message);
      if (error.status === 403 || error.status === 404) {
        console.log(`ℹ️  Using mock file data for testing`);
        files = [
          {
            filename: 'test/file.js',
            patch: '+ console.log("Mock file content");',
            additions: 1,
            deletions: 0,
            status: 'modified'
          }
        ];
        diff = 'Mock diff content for testing';
      } else {
        throw error;
      }
    }


    // Post initial greeting comment to acknowledge the request
    const userName = mentionedBy || prAuthor;
    let greetingComment = `Hey @${userName}! 👋\n\n`;
    greetingComment += `I'll go through the changes and help you out${isAutoReview ? ' with an automated review' : ''}! 🔍\n\n`;
    greetingComment += `Starting the review now...`;
    
    // Apply mention limiting to greeting comment
    const limitedGreetingComment = limitMentionsInComment(greetingComment, 2);
    if (limitedGreetingComment !== greetingComment) {
      console.log(`⚠️  Applied mention limiting to greeting comment`);
    }

    console.log(`💬 Posting greeting comment for @${userName} (${isAutoReview ? 'auto-review' : 'manual review'})`);
    await postReviewComment(octokit, owner, repo, pullNumber, limitedGreetingComment);


    // Select appropriate model and review with AI
    const selectedModel = selectModelForPR(pr, files, diff);
    console.log(`🧠 Generating review: ${selectedModel}`);

    // Review with AI
    const review = await reviewCodeWithAI(selectedModel, pr.title, pr.body, files, diff, prAuthor, mentionedBy, userComment);
    console.log(`✅ AI review generated successfully with ${selectedModel}`);

    // Post the review as a comment with simplified footer
    const totalCharsAnalyzed = files.reduce((sum, f) => sum + (f.patch?.length || 0), 0);
    const reviewComment = `${review}

---

<div align="center">

**🤖 Powered by [Xibe AI](https://xibe.app)**${isAutoReview ? ' • Auto-generated' : ''}
**📊 Analysis:** ${totalCharsAnalyzed} characters analyzed across ${files.length} file${files.length !== 1 ? 's' : ''}
[💙 Support Development](https://razorpay.me/@megavault) • [📚 Documentation](https://xibe.app)

</div>`;

    // Apply mention limiting to prevent spam
    const limitedReviewComment = limitMentionsInComment(reviewComment, 2);
    if (limitedReviewComment !== reviewComment) {
      console.log(`⚠️  Applied mention limiting to review comment`);
    }

    const posted = await postReviewComment(octokit, owner, repo, pullNumber, limitedReviewComment);

    if (posted) {
      console.log(`✅ Review completed and posted for PR #${pullNumber}`);
      
      // Mark that bot has commented to prevent duplicates
      try {
        await redis.setex(recentCommentKey, 300, new Date().toISOString()); // 5 minutes TTL
      } catch (redisError) {
        console.log('⚠️  Could not save recent comment timestamp:', redisError.message);
      }

      // Mark this specific comment as processed to prevent duplicate responses
      try {
        const processedCommentKey = `processed_comment:${owner}:${repo}:${commentId}`;
        await redis.setex(processedCommentKey, 86400, 'processed'); // 24 hours TTL
        console.log(`✅ Marked comment ${commentId} as processed`);
      } catch (redisError) {
        console.log('⚠️  Could not mark comment as processed:', redisError.message);
      }
    } else {
      console.log(`✅ Review completed (content shown above) - not posted due to permissions`);
      
      // Still mark comment as processed even if not posted to avoid reprocessing
      try {
        const processedCommentKey = `processed_comment:${owner}:${repo}:${commentId}`;
        await redis.setex(processedCommentKey, 86400, 'processed'); // 24 hours TTL
        console.log(`✅ Marked comment ${commentId} as processed (not posted due to permissions)`);
      } catch (redisError) {
        console.log('⚠️  Could not mark comment as processed:', redisError.message);
      }
    }

    // Release lock
    if (lockAcquired) {
      try {
        await redis.del(lockKey);
        console.log(`🔓 Released lock for PR #${pullNumber}`);
      } catch (redisError) {
        console.log('⚠️  Could not release lock:', redisError.message);
      }
    }

    // Save review data to database for analytics
    const reviewData = {
      repository: `${owner}/${repo}`,
      pullNumber,
      user: prAuthor,
      installationId,
      model: selectedModel,
      reviewContent: review,
      processingTime: Date.now() - startTime
    };
    
    const reviewId = await saveReviewToDatabase(reviewData);
    if (reviewId) {
      console.log(`📊 Analytics updated for review: ${reviewId}`);
    }

    // Update webhook log status to completed
    if (webhookLogId) {
      try {
        const logData = await redis.get(`webhook:${webhookLogId}`);
        if (logData) {
          const log = typeof logData === 'string' ? JSON.parse(logData) : logData;
          const oldStatus = log.status;
          log.status = 'completed';
          log.processingTime = Date.now() - new Date(log.timestamp).getTime();
          await redis.setex(`webhook:${webhookLogId}`, 86400 * 7, JSON.stringify(log));
          console.log(`📊 Updated webhook log ${webhookLogId} to completed`);
          
          // Update webhook stats: decrement old status, increment new status
          if (oldStatus !== 'completed') {
            await redis.hincrby('webhook:stats', oldStatus, -1);
            await redis.hincrby('webhook:stats', 'completed', 1);
          }
        }
      } catch (updateError) {
        console.error('Error updating webhook log:', updateError);
      }
    }

  } catch (error) {
    console.error(`❌ Error handling PR review request:`, error.message);

    // Release lock on error
    try {
      await redis.del(lockKey);
      console.log(`🔓 Released lock for PR #${pullNumber} (after error)`);
    } catch (redisError) {
      // Ignore lock release errors
    }

    // Mark comment as processed even on error to prevent infinite retries
    try {
      const processedCommentKey = `processed_comment:${owner}:${repo}:${commentId}`;
      await redis.setex(processedCommentKey, 86400, 'processed'); // 24 hours TTL
      console.log(`✅ Marked comment ${commentId} as processed (after error)`);
    } catch (redisError) {
      console.log('⚠️  Could not mark comment as processed after error:', redisError.message);
    }

    // Update webhook log status to error
    if (webhookLogId) {
      try {
        const logData = await redis.get(`webhook:${webhookLogId}`);
        if (logData) {
          const log = typeof logData === 'string' ? JSON.parse(logData) : logData;
          const oldStatus = log.status;
          log.status = 'error';
          log.error = error.message;
          log.processingTime = Date.now() - new Date(log.timestamp).getTime();
          await redis.setex(`webhook:${webhookLogId}`, 86400 * 7, JSON.stringify(log));
          console.log(`📊 Updated webhook log ${webhookLogId} to error`);
          
          // Update webhook stats: decrement old status, increment new status
          if (oldStatus !== 'error') {
            await redis.hincrby('webhook:stats', oldStatus, -1);
            await redis.hincrby('webhook:stats', 'error', 1);
          }
        }
      } catch (updateError) {
        console.error('Error updating webhook log:', updateError);
      }
    }

    // Don't post error comments for ignored events or duplicate processing
    console.log(`ℹ️  Skipping error comment - event ignored or duplicate: ${error.message}`);
  }
}

// Redis-based webhook logging with fallback
const MAX_LOGS = 1000; // Increased for Redis storage
const fallbackLogs = []; // Fallback in-memory storage

async function addWebhookLog(log) {
  try {
    // Store individual log
    await redis.setex(`webhook:${log.id}`, 86400 * 7, JSON.stringify(log)); // 7 days TTL
    
    // Add to recent logs list
    await redis.lpush('webhook:recent', log.id);
    
    // Keep only recent logs (trim to MAX_LOGS)
    await redis.ltrim('webhook:recent', 0, MAX_LOGS - 1);
    
    // Initialize stats hash if it doesn't exist
    const existingStats = await redis.hgetall('webhook:stats');
    if (!existingStats || Object.keys(existingStats).length === 0) {
      await redis.hset('webhook:stats', {
        total: 0,
        completed: 0,
        error: 0,
        ignored: 0,
        processing: 0
      });
    }
    
    // Update stats
    await redis.hincrby('webhook:stats', log.status, 1);
    await redis.hincrby('webhook:stats', 'total', 1);
    
    console.log(`📊 Webhook log stored in Redis: ${log.id}`);
  } catch (error) {
    console.error('❌ Error storing webhook log in Redis:', error);
    // Fallback to in-memory storage
    fallbackLogs.unshift(log);
    if (fallbackLogs.length > 100) {
      fallbackLogs.pop();
    }
    console.log(`📊 Webhook log stored in fallback memory: ${log.id}`);
  }
}

async function getWebhookLogs(limit = 50, status = null) {
  try {
    const logIds = await redis.lrange('webhook:recent', 0, limit - 1);
    const logs = [];
    
    for (const id of logIds) {
      const logData = await redis.get(`webhook:${id}`);
      if (logData) {
        try {
          // Handle both string and object data
          const log = typeof logData === 'string' ? JSON.parse(logData) : logData;
          if (!status || log.status === status) {
            logs.push(log);
          }
        } catch (parseError) {
          console.error(`❌ Error parsing webhook log ${id}:`, parseError);
          // Skip this log and continue
        }
      }
    }
    
    // If no logs from Redis, use fallback
    if (logs.length === 0 && fallbackLogs.length > 0) {
      console.log('📊 Using fallback webhook logs');
      let fallbackLogsFiltered = fallbackLogs;
      if (status) {
        fallbackLogsFiltered = fallbackLogs.filter(log => log.status === status);
      }
      return fallbackLogsFiltered.slice(0, limit);
    }
    
    return logs;
  } catch (error) {
    console.error('❌ Error retrieving webhook logs from Redis:', error);
    // Use fallback logs
    let fallbackLogsFiltered = fallbackLogs;
    if (status) {
      fallbackLogsFiltered = fallbackLogs.filter(log => log.status === status);
    }
    return fallbackLogsFiltered.slice(0, limit);
  }
}

async function getWebhookStats() {
  try {
    const stats = await redis.hgetall('webhook:stats');
    // Handle case where Redis returns null or empty object
    if (!stats || Object.keys(stats).length === 0) {
      return {
        total: 0,
        completed: 0,
        error: 0,
        ignored: 0,
        processing: 0
      };
    }
    return {
      total: parseInt(stats.total || 0),
      completed: parseInt(stats.completed || 0),
      error: parseInt(stats.error || 0),
      ignored: parseInt(stats.ignored || 0),
      processing: parseInt(stats.processing || 0)
    };
  } catch (error) {
    console.error('❌ Error retrieving webhook stats from Redis:', error);
    // Use fallback stats from memory
    const fallbackStats = {
      total: fallbackLogs.length,
      completed: fallbackLogs.filter(log => log.status === 'completed').length,
      error: fallbackLogs.filter(log => log.status === 'error').length,
      ignored: fallbackLogs.filter(log => log.status === 'ignored').length,
      processing: fallbackLogs.filter(log => log.status === 'processing').length
    };
    return fallbackStats;
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const startTime = Date.now();
  const logId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const event = req.headers['x-github-event'];
    const payload = req.body;
    const installationId = payload.installation?.id;

    console.log(`🔍 Webhook Debug:`);
    console.log(`   Event: ${event}`);
    console.log(`   Installation ID from payload: ${installationId} (type: ${typeof installationId})`);
    console.log(`   Payload installation object:`, payload.installation);
    console.log('');

    const webhookLog = {
      id: logId,
      timestamp: new Date().toISOString(),
      event,
      installationId,
      repository: payload.repository?.full_name || 'Unknown',
      user: payload.sender?.login || 'Unknown',
      comment: payload.comment?.body || '',
      isPR: payload.issue?.pull_request ? true : false,
      prNumber: payload.issue?.number || null,
      status: 'processing',
      processingTime: null,
      error: null,
      actions: []
    };

    await addWebhookLog(webhookLog);

    console.log(`📡 Received ${event} event`);
    console.log(`🔐 Installation ID: ${installationId || 'Not provided'}`);
    console.log(`📋 Repository: ${payload.repository?.full_name || 'Unknown'}`);
    console.log(`👤 User: ${payload.sender?.login || 'Unknown'}`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`🌐 Webhook Call Details:`);
    console.log(`   Method: ${req.method}`);
    console.log(`   URL: ${req.url}`);
    console.log(`   Headers: ${JSON.stringify({
      'x-github-event': req.headers['x-github-event'],
      'x-github-delivery': req.headers['x-github-delivery'],
      'user-agent': req.headers['user-agent']
    }, null, 2)}`);
    console.log('');

    // Handle PR events and issue_comment events
    console.log(`🔍 Debug: event=${event}, action=${payload.action}`);

    // Handle pull_request events (auto-review)
    if (event === 'pull_request' && (payload.action === 'opened' || payload.action === 'synchronize' || payload.action === 'reopened')) {
      const pr = payload.pull_request;
      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const pullNumber = pr.number;

      webhookLog.actions.push('Auto-review triggered for PR');
      webhookLog.actions.push(`PR #${pullNumber} ${payload.action}`);
      webhookLog.actions.push(`Repository: ${owner}/${repo}`);

      console.log(`🤖 Auto-review triggered for PR #${pullNumber} in ${owner}/${repo}`);
      console.log(`   Action: ${payload.action}`);
      console.log(`   Title: "${pr.title}"`);
      console.log('');

      // Get the appropriate Octokit instance
      let octokit;
      try {
        if (authMode === 'app' && installationId) {
          octokit = await getOctokitForInstallation(installationId);
        } else if (authMode === 'pat' && defaultOctokit) {
          octokit = defaultOctokit;
        } else if (authMode === 'test') {
          octokit = await getOctokitForInstallation(null);
        } else {
          octokit = await getOctokitForInstallation(null);
        }
      } catch (error) {
        console.error('❌ Error getting Octokit instance:', error.message);
        webhookLog.actions.push(`❌ Authentication error: ${error.message}`);
        webhookLog.error = `Authentication error: ${error.message}`;
        octokit = await getOctokitForInstallation(null);
      }

      // Handle the review asynchronously
      webhookLog.actions.push('Starting auto-review process');
      webhookLog.status = 'processing';
      await addWebhookLog(webhookLog);
      handlePRReviewRequest(octokit, owner, repo, pullNumber, null, logId, true, installationId, null, null);

      res.status(200).json({ message: 'Auto-review request received', logId });

    // Handle issue_comment event (manual review requests)
    } else if (event === 'issue_comment' && (payload.action === 'created' || payload.action === 'edited')) {
      const comment = payload.comment;
      const issue = payload.issue;

      webhookLog.actions.push('Comment received');
      webhookLog.actions.push(`Comment ID: ${comment.id}`);
      webhookLog.actions.push(`Comment: "${comment.body}"`);

      console.log(`💬 Comment Details:`);
      console.log(`   Comment ID: ${comment.id}`);
      console.log(`   Comment Body: "${comment.body}"`);
      console.log(`   Issue Number: ${issue.number}`);
      console.log(`   Is PR: ${issue.pull_request ? 'Yes' : 'No'}`);
      console.log('');

      // Check if this is a PR and the bot was mentioned (case-insensitive, various patterns, not by the bot itself)
      const commentBodyLc = (comment.body || '').toLowerCase();
      const botNameLc = (BOT_USERNAME || '').toLowerCase();

      // Function to detect bot mentions in various formats
      const isBotMentioned = (text, botName) => {
        // Handle bot name variations - "Xibe-review" -> ["xibe", "review"]
        const botNameParts = botName.split('-');
        const baseName = botNameParts[0]; // "xibe"
        const reviewWord = botNameParts[1]; // "review"

        const patterns = [
          // @Xibe-review, @xibe-review, @XIbe-review (with @)
          new RegExp(`@${botName}`, 'i'),
          // @Xibe, @xibe (just @name)
          new RegExp(`@${baseName}`, 'i'),
          // Xibe review, xibe review (name + space + review)
          new RegExp(`${baseName}\\s+${reviewWord}\\b`, 'i'),
          // xibe-review, Xibe-review (full name with hyphen)
          new RegExp(`${botName}\\b`, 'i'),
          // Just "Xibe" (standalone base name)
          new RegExp(`\\b${baseName}\\b`, 'i'),
          // "Xibe review this" (name + space + review + space)
          new RegExp(`${baseName}\\s+${reviewWord}\\s`, 'i'),
          // "xibe-review this" (full name + space + review)
          new RegExp(`${botName}\\s+${reviewWord}`, 'i')
        ];

        return patterns.some(pattern => pattern.test(text));
      };

      const isMentioned = isBotMentioned(comment.body || '', botNameLc);
      const isFromBotSelf = (comment.user?.login || '').toLowerCase() === `${botNameLc}[bot]`;

      if (issue.pull_request && isMentioned && !isFromBotSelf) {
        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        const pullNumber = issue.number;

        webhookLog.actions.push('Bot mentioned in PR');
        webhookLog.actions.push(`Repository: ${owner}/${repo}`);
        webhookLog.actions.push(`PR Number: ${pullNumber}`);

        console.log(`🤖 Bot mentioned in PR #${pullNumber}`);
        console.log(`   Repository: ${owner}/${repo}`);
        console.log(`   Installation ID: ${installationId}`);
        console.log(`   Comment: "${comment.body}"`);
        console.log('');

        // Get the appropriate Octokit instance - prioritize GitHub App
        let octokit;
        try {
          if (authMode === 'app' && installationId) {
            console.log(`🔐 Using GitHub App installation ID: ${installationId}`);
            console.log('   ✅ Comments will appear from bot account with [bot] badge');
            webhookLog.actions.push('Using GitHub App authentication');
            webhookLog.actions.push(`Installation ID: ${installationId}`);

            // Validate installationId is a valid number
            const validInstallationId = parseInt(installationId);
            if (isNaN(validInstallationId) || validInstallationId <= 0) {
              throw new Error(`Invalid installation ID: ${installationId}. Must be a positive integer.`);
            }

            octokit = await getOctokitForInstallation(validInstallationId);

            // Test the authentication by making a simple API call
            try {
              console.log(`🔍 Verifying GitHub App installation: ${validInstallationId}`);
              const installation = await octokit.apps.getInstallation({ installation_id: validInstallationId });
              console.log(`✅ GitHub App installation verified: ${installation.data.account.login}/${installation.data.repository_selection}`);
              webhookLog.actions.push('✅ GitHub App authentication verified');
            } catch (authError) {
              console.error('❌ GitHub App authentication failed:', authError.message);
              console.error('❌ Auth Error Details:', authError);
              webhookLog.actions.push(`❌ GitHub App authentication failed: ${authError.message}`);
              webhookLog.error = `GitHub App authentication failed: ${authError.message}`;
              throw authError;
            }
          } else if (authMode === 'app' && !installationId) {
            console.log('⚠️  GitHub App configured but no installation ID found in webhook');
            console.log('   💡 Make sure your GitHub App is installed on the repository');
            console.log('   💡 Check webhook payload for installation.id field');
            console.log('   💡 Installation ID is required for GitHub App authentication');
            console.log('   🔄 Falling back to test mode');
            webhookLog.actions.push('GitHub App configured but no installation ID - falling back to test mode');
            webhookLog.actions.push('💡 Install the GitHub App on the repository to fix this');
            webhookLog.error = 'No installation ID found - GitHub App not installed on repository';
            octokit = await getOctokitForInstallation(null);
          } else if (authMode === 'pat' && defaultOctokit) {
            console.log('🔑 Using Personal Access Token');
            console.log('   ⚠️  Comments will appear from your personal account');
            webhookLog.actions.push('Using Personal Access Token');
            
            // Test the PAT authentication
            try {
              await defaultOctokit.users.getAuthenticated();
              webhookLog.actions.push('✅ Personal Access Token authentication verified');
            } catch (authError) {
              console.error('❌ Personal Access Token authentication failed:', authError.message);
              webhookLog.actions.push(`❌ Personal Access Token authentication failed: ${authError.message}`);
              webhookLog.error = `Personal Access Token authentication failed: ${authError.message}`;
              throw authError;
            }
            octokit = defaultOctokit;
          } else if (authMode === 'test') {
            console.log('🧪 Using test mode (no GitHub auth)');
            webhookLog.actions.push('Using test mode');
            octokit = await getOctokitForInstallation(null);
          } else {
            console.log('⚠️  No GitHub authentication - using test mode');
            webhookLog.actions.push('No authentication - using test mode');
            octokit = await getOctokitForInstallation(null);
          }
        } catch (error) {
          console.error('❌ Error getting Octokit instance:', error.message);
          console.log('🧪 Falling back to test mode');
          webhookLog.actions.push(`❌ Authentication error: ${error.message}`);
          webhookLog.error = `Authentication error: ${error.message}`;
          octokit = await getOctokitForInstallation(null);
        }

        // React to the comment to acknowledge (manual review path)
        const isAutoReviewFlag = false;
        if (comment?.id && !isAutoReviewFlag) {
          try {
            await octokit.reactions.createForIssueComment({
              owner,
              repo,
              comment_id: comment.id,
              content: 'eyes',
            });
            console.log('✅ Added 👀 reaction to comment');
            webhookLog.actions.push('Added 👀 reaction to comment');
          } catch (error) {
            console.error('❌ Error adding reaction:', error.message);
            webhookLog.actions.push(`Failed to add reaction: ${error.message}`);
            if (error.status === 403 || error.status === 404) {
              console.log('ℹ️  Cannot add reaction - likely testing with fake data or insufficient permissions');
            }
          }
        } else if (isAutoReviewFlag) {
          console.log('🤖 Auto-review - no reaction needed');
          webhookLog.actions.push('Auto-review - no reaction needed');
        }

        // Handle the review asynchronously
        webhookLog.actions.push('Starting PR review process');
        webhookLog.status = 'processing';
        await addWebhookLog(webhookLog);
        
        // Pass the user who mentioned the bot
        const mentionedBy = comment.user?.login || null;
        handlePRReviewRequest(octokit, owner, repo, pullNumber, comment.id, logId, false, installationId, comment.body, mentionedBy);

        res.status(200).json({ message: 'Review request received', logId });
      } else {
        const reason = !issue.pull_request ? 'not a PR' :
                      !isMentioned ? 'bot not mentioned' :
                      isFromBotSelf ? 'comment from bot itself' : 'unknown reason';
        webhookLog.actions.push(`Event ignored - ${reason}`);
        webhookLog.status = 'ignored';
        webhookLog.processingTime = Date.now() - startTime;
        await addWebhookLog(webhookLog);
        res.status(200).json({ message: 'Event ignored' });
      }
    } else {
      console.log(`🔍 Debug: Event ignored - event=${event}, action=${payload.action}`);
      webhookLog.actions.push(`Event ignored - event=${event}, action=${payload.action}`);
      webhookLog.status = 'ignored';
      webhookLog.processingTime = Date.now() - startTime;
      await addWebhookLog(webhookLog);
      res.status(200).json({ message: 'Event ignored' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    
    // Update webhook log with error
    try {
      const logData = await redis.get(`webhook:${logId}`);
      if (logData) {
        const log = typeof logData === 'string' ? JSON.parse(logData) : logData;
        const oldStatus = log.status;
        log.status = 'error';
        log.error = error.message;
        log.processingTime = Date.now() - startTime;
        await redis.setex(`webhook:${logId}`, 86400 * 7, JSON.stringify(log));
        
        // Update webhook stats: decrement old status, increment new status
        if (oldStatus !== 'error') {
          await redis.hincrby('webhook:stats', oldStatus, -1);
          await redis.hincrby('webhook:stats', 'error', 1);
        }
      }
    } catch (updateError) {
      console.error('Error updating webhook log:', updateError);
    }
    
    res.status(500).json({ error: 'Internal server error', logId });
  }
});

// Set security headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self';");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Serve static files
app.use(express.static(__dirname));

// Serve the main landing page
app.get('/', (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PR-REVIEW-XIBE - AI-Powered PR Review Bot</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.6;
                color: #1e293b;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .container {
                max-width: 900px;
                background: white;
                padding: 3rem;
                border-radius: 1rem;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                text-align: center;
            }

            .header {
                margin-bottom: 2rem;
            }

            .header h1 {
                font-size: 3rem;
                font-weight: 700;
                margin-bottom: 0.5rem;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }

            .header p {
                font-size: 1.2rem;
                color: #64748b;
                margin-bottom: 1rem;
            }

            .badge {
                display: inline-block;
                background: rgba(102, 126, 234, 0.1);
                color: #667eea;
                padding: 0.5rem 1rem;
                border-radius: 9999px;
                font-size: 0.875rem;
                font-weight: 500;
                margin-bottom: 2rem;
            }

            .features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 2rem;
                margin: 2rem 0;
            }

            .feature-card {
                background: #f8fafc;
                padding: 1.5rem;
                border-radius: 0.75rem;
                border: 1px solid #e2e8f0;
                transition: transform 0.2s, box-shadow 0.2s;
            }

            .feature-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            }

            .feature-card h3 {
                color: #667eea;
                margin-bottom: 0.5rem;
                font-size: 1.1rem;
            }

            .feature-card p {
                color: #64748b;
                font-size: 0.9rem;
            }

            .cta-section {
                margin: 2rem 0;
                padding: 2rem;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 0.75rem;
                color: white;
            }

            .cta-section h2 {
                margin-bottom: 1rem;
            }

            .btn {
                display: inline-block;
                background: white;
                color: #667eea;
                padding: 0.75rem 2rem;
                border-radius: 0.5rem;
                text-decoration: none;
                font-weight: 600;
                margin: 0.5rem;
                transition: transform 0.2s, box-shadow 0.2s;
            }

            .btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            }

            .btn.secondary {
                background: rgba(255, 255, 255, 0.2);
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.3);
            }

            .footer {
                margin-top: 2rem;
                padding-top: 2rem;
                border-top: 1px solid #e2e8f0;
                color: #64748b;
                font-size: 0.875rem;
            }

            .status-indicator {
                display: inline-block;
                width: 0.75rem;
                height: 0.75rem;
                border-radius: 50%;
                background: #10b981;
                margin-right: 0.5rem;
            }

            @media (max-width: 768px) {
                .container {
                    margin: 1rem;
                    padding: 2rem;
                }

                .header h1 {
                    font-size: 2rem;
                }

                .features {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🤖 PR-REVIEW-XIBE</h1>
                <p>AI-Powered GitHub PR Review Bot</p>
                <div class="badge">🚀 Production Ready • 🔍 Smart Reviews • 📊 Real-time Monitoring</div>
            </div>

            <div class="features">
                <div class="feature-card">
                    <h3>🔍 Intelligent Code Review</h3>
                    <p>AI-powered analysis of your pull requests with detailed feedback on code quality, security, and best practices.</p>
                </div>

                <div class="feature-card">
                    <h3>⚡ Auto-Review</h3>
                    <p>Automatically reviews PRs when they're created, opened, or updated - no manual intervention needed.</p>
                </div>

                <div class="feature-card">
                    <h3>📊 Real-time Dashboard</h3>
                    <p>Monitor webhook events, review history, and bot performance with a beautiful, responsive interface.</p>
                </div>

                <div class="feature-card">
                    <h3>🔧 Easy Setup</h3>
                    <p>Simple GitHub App integration with comprehensive documentation and troubleshooting tools.</p>
                </div>
            </div>

            <div class="cta-section">
                <h2>🚀 Get Started</h2>
                <p>Your bot is running and ready to review pull requests!</p>
                <div>
                    <a href="/status" class="btn">📊 View Dashboard</a>
                    <a href="/health" class="btn secondary">🔍 Health Check</a>
                </div>
            </div>

            <div class="footer">
                <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-bottom: 1rem;">
                    <span class="status-indicator"></span>
                    <span>Bot Status: <strong>Running</strong></span>
                </div>
                <p>🤖 Powered by Xibe AI • 📡 Webhook: /webhook • 🎯 Auto-review enabled</p>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Serve the dashboard at /status
app.get('/status', (req, res) => {
  try {
    // Try multiple possible locations for index.html
    const possiblePaths = [
      join(__dirname, 'index.html'),
      join(process.cwd(), 'index.html'),
      '/app/index.html',
      './index.html'
    ];

    let fileFound = false;
    for (const filePath of possiblePaths) {
      try {
        res.sendFile(filePath);
        fileFound = true;
        break;
      } catch (pathError) {
        console.log(`Tried path: ${filePath} - not found`);
      }
    }

    if (!fileFound) {
      throw new Error('index.html not found in any expected location');
    }
  } catch (error) {
    console.error('Error serving dashboard:', error);
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>PR-REVIEW-XIBE Dashboard - Error</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #ef4444; margin-bottom: 20px; }
            .error { background: #fef2f2; color: #dc2626; padding: 10px; border-radius: 4px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Dashboard Error</h1>
            <div class="error">Could not load dashboard. Please check if index.html exists.</div>
            <p><a href="/">← Back to Home</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Redis test endpoint
app.get('/api/test-redis', async (req, res) => {
  try {
    await redis.ping();
    const testKey = 'test:connection';
    await redis.setex(testKey, 60, 'test-value');
    const testValue = await redis.get(testKey);
    await redis.del(testKey);
    
    res.json({
      status: 'connected',
      test: 'passed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Uptime status endpoint with detailed bot information
app.get('/api/status/uptime', async (req, res) => {
  // Set no CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  try {
    const stats = await getWebhookStats();
    const recentLogs = await getWebhookLogs(5);
    
    // Calculate uptime in different formats
    const uptimeSeconds = process.uptime();
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    
    // Format uptime string
    let uptimeString = '';
    if (uptimeDays > 0) {
      uptimeString += `${uptimeDays}d `;
    }
    if (uptimeHours % 24 > 0) {
      uptimeString += `${uptimeHours % 24}h `;
    }
    if (uptimeMinutes % 60 > 0) {
      uptimeString += `${uptimeMinutes % 60}m `;
    }
    uptimeString += `${Math.floor(uptimeSeconds % 60)}s`;
    
    // Get memory usage
    const memoryUsage = process.memoryUsage();
    
    // Get last activity
    const lastActivity = recentLogs.length > 0 ? recentLogs[0].timestamp : null;
    
    const uptimeStatus = {
      bot: {
        status: 'running',
        uptime: {
          seconds: Math.floor(uptimeSeconds),
          formatted: uptimeString.trim(),
          started: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
          lastUpdated: new Date().toISOString()
        },
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024) // MB
        },
        configuration: {
          authMode,
          githubAppId: GITHUB_APP_ID,
          botUsername: BOT_USERNAME,
          aiApi: AI_API,
          model: MODEL_ID,
          port: PORT
        },
        lastActivity: lastActivity,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      },
      webhooks: {
        total: stats.total,
        completed: stats.completed,
        error: stats.error,
        ignored: stats.ignored,
        processing: stats.processing,
        successRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
      },
      system: {
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        pid: process.pid,
        cwd: process.cwd()
      }
    };
    
    res.json(uptimeStatus);
  } catch (error) {
    console.error('Error getting uptime status:', error);
    res.status(500).json({ 
      error: 'Failed to get uptime status',
      timestamp: new Date().toISOString(),
      bot: {
        status: 'error',
        uptime: {
          seconds: Math.floor(process.uptime()),
          formatted: 'Unknown',
          lastUpdated: new Date().toISOString()
        }
      }
    });
  }
});

// Monitoring endpoints
app.get('/api/status', async (req, res) => {
  try {
    const stats = await getWebhookStats();
    const recentLogs = await getWebhookLogs(10);
    
    const status = {
      bot: {
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        authMode,
        githubAppId: GITHUB_APP_ID,
        botUsername: BOT_USERNAME,
        aiApi: AI_API,
        model: MODEL_ID
      },
      webhooks: {
        total: stats.total,
        recent: recentLogs,
        stats: {
          completed: stats.completed,
          error: stats.error,
          ignored: stats.ignored,
          processing: stats.processing
        }
      }
    };
    res.json(status);
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.get('/api/webhooks', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status;
    
    const logs = await getWebhookLogs(limit, status);
    const stats = await getWebhookStats();
    
    res.json({
      logs,
      total: stats.total,
      filtered: logs.length
    });
  } catch (error) {
    console.error('Error getting webhook logs:', error);
    res.status(500).json({ error: 'Failed to get webhook logs' });
  }
});

app.get('/api/webhook/:id', async (req, res) => {
  try {
    const logData = await redis.get(`webhook:${req.params.id}`);
    if (!logData) {
      return res.status(404).json({ error: 'Webhook log not found' });
    }
    
    // Handle both string and object data
    const log = typeof logData === 'string' ? JSON.parse(logData) : logData;
    res.json(log);
  } catch (error) {
    console.error('Error getting webhook log:', error);
    res.status(500).json({ error: 'Failed to get webhook log' });
  }
});

// Clear webhook logs
app.delete('/api/webhooks', async (req, res) => {
  try {
    // Clear all webhook-related keys
    const keys = await redis.keys('webhook:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    res.json({ message: 'Webhook logs cleared' });
  } catch (error) {
    console.error('Error clearing webhook logs:', error);
    res.status(500).json({ error: 'Failed to clear webhook logs' });
  }
});

// Troubleshooting endpoint
app.get('/api/troubleshoot', async (req, res) => {
  try {
    const issues = [];
    const recommendations = [];

    // Check authentication
    if (!hasGitHubApp && !hasGitHubPAT) {
      issues.push('No GitHub authentication configured');
      recommendations.push('Set GITHUB_APP_ID + GITHUB_PRIVATE_KEY for GitHub App (recommended) or GITHUB_TOKEN for Personal Access Token');
    }

    // Check AI configuration
    if (!AI_API || !AI_KEY) {
      issues.push('AI API configuration missing');
      recommendations.push('Set AI_API and AI_KEY environment variables');
    }

    // Get webhook stats from Redis
    const stats = await getWebhookStats();
    const recentLogs = await getWebhookLogs(50);
    
    // Check webhook logs for common issues
    const recentErrors = recentLogs.filter(log => log.status === 'error').slice(0, 5);
    const noInstallationId = recentLogs.filter(log => log.error && log.error.includes('installation ID')).length;
    
    if (noInstallationId > 0) {
      issues.push(`${noInstallationId} webhook(s) failed due to missing installation ID`);
      recommendations.push('Install your GitHub App on the target repository');
    }

    if (recentErrors.length > 0) {
      issues.push(`${recentErrors.length} recent webhook error(s)`);
      recommendations.push('Check webhook logs for detailed error information');
    }

    // Check if bot is being mentioned correctly
    const botMentions = recentLogs.filter(log => log.comment && log.comment.includes(`@${BOT_USERNAME}`)).length;
    if (botMentions === 0 && stats.total > 0) {
      issues.push('No bot mentions found in webhook logs');
      recommendations.push(`Make sure to mention @${BOT_USERNAME} in your PR comments`);
    }

    res.json({
      status: issues.length === 0 ? 'healthy' : 'issues_found',
      issues,
      recommendations,
      stats: {
        totalWebhooks: stats.total,
        errors: stats.error,
        completed: stats.completed,
        botMentions
      },
      configuration: {
        authMode,
        hasGitHubApp,
        hasGitHubPAT,
        hasAI: !!(AI_API && AI_KEY),
        botUsername: BOT_USERNAME
      }
    });
  } catch (error) {
    console.error('Error getting troubleshoot data:', error);
    res.status(500).json({ error: 'Failed to get troubleshoot data' });
  }
});

// API endpoint to get available models
app.get('/api/models', (req, res) => {
  try {
    // Return basic model information based on environment variables
    const models = [
      {
        name: MODEL_ID || 'default',
        description: 'Current AI model configured via environment variables',
        maxInputChars: 8000,
        temperature: 0.7,
        reasoning: false,
        bestFor: ['general-purpose']
      }
    ];

    res.json({
      models,
      total: models.length,
      defaultModel: MODEL_ID || ANALYSIS_MODEL || 'your_default_model'
    });
  } catch (error) {
    console.error('Error getting models:', error);
    res.status(500).json({ error: 'Failed to get models' });
  }
});

// Analytics API endpoints
app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await getGlobalAnalytics();
    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get analytics data' 
    });
  }
});

app.get('/api/analytics/users', async (req, res) => {
  try {
    const analytics = await getGlobalAnalytics();
    res.json({
      success: true,
      data: {
        totalUsers: analytics.totalUsers,
        totalReviews: analytics.totalReviews,
        averageReviewsPerUser: analytics.totalUsers > 0 ? Math.round(analytics.totalReviews / analytics.totalUsers) : 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting user analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get user analytics' 
    });
  }
});

app.get('/api/analytics/reviews', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const reviews = await getRecentReviews(limit);
    const analytics = await getGlobalAnalytics();
    
    res.json({
      success: true,
      data: {
        reviews,
        totalReviews: analytics.totalReviews,
        recentCount: reviews.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting review analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get review analytics' 
    });
  }
});

app.get('/api/analytics/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userStats = await getUserStats(userId);
    
    if (!userStats) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: userStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting user stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get user statistics' 
    });
  }
});

app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const analytics = await getGlobalAnalytics();
    const recentReviews = await getRecentReviews(5);
    const webhookStats = await getWebhookStats();
    const installations = await getGitHubAppInstallations();
    
    res.json({
      success: true,
      data: {
        global: analytics,
        webhooks: webhookStats,
        recentActivity: recentReviews,
        installations: installations,
        bot: {
          status: 'running',
          uptime: process.uptime(),
          models: {
            default: MODEL_ID,
            analysis: ANALYSIS_MODEL,
            comment: COMMENT_MODEL
          }
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get dashboard data' 
    });
  }
});

// Test Redis connection
async function testRedisConnection() {
  try {
    await redis.ping();
    console.log('✅ Redis connection successful');
    return true;
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    console.log('⚠️  Webhook logs will not be persisted (using fallback)');
    return false;
  }
}

app.listen(PORT, async () => {
  console.log(`🚀 PR Review Bot is running on port ${PORT}`);
  console.log(`🔗 Webhook endpoint: /webhook`);
  console.log(`💚 Health check endpoint: /health`);
  console.log(`🏠 Landing page: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/status`);
  
  // Test Redis connection
  const redisConnected = await testRedisConnection();
  
  if (authMode === 'app') {
    console.log(`🔐 Authentication mode: GitHub App (Bot Account)`);
    console.log(`   ✅ Comments will appear from bot account with [bot] badge`);
    console.log(`   🎯 App ID: ${GITHUB_APP_ID}`);
  } else if (authMode === 'pat') {
    console.log(`🔐 Authentication mode: Personal Access Token`);
    console.log(`   ⚠️  Comments will appear from your personal account`);
    console.log(`   💡 Consider using GitHub App for bot account`);
  } else {
    console.log(`🔐 Authentication mode: Test Mode`);
  }

  if (authMode === 'test') {
    console.log('');
    console.log('🧪 TEST MODE ENABLED');
    console.log('   Bot will process webhooks and generate AI reviews');
    console.log('   GitHub API calls will fail gracefully');
    console.log('   Perfect for testing AI review functionality!');
  }
  
  if (redisConnected) {
    console.log('📊 Webhook logs will be stored in Redis database');
    console.log('🔍 Visit the dashboard to monitor webhook events');
  }
});
