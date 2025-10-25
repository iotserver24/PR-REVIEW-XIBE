import fetch from 'node-fetch';

// Test Case 1: User asks a specific question
const testQuestion = {
  action: 'created',
  issue: {
    number: 1,
    pull_request: {
      url: 'https://api.github.com/repos/test/repo/pulls/1'
    }
  },
  comment: {
    id: 123456789,
    body: '@Xibe-review should I add more error handling to this code?',
    user: {
      login: 'testuser'
    }
  },
  repository: {
    name: 'test-repo',
    full_name: 'test/repo',
    owner: {
      login: 'test'
    }
  },
  installation: {
    id: 90988524
  }
};

// Test Case 2: User asks for a general review
const testReviewRequest = {
  action: 'created',
  issue: {
    number: 2,
    pull_request: {
      url: 'https://api.github.com/repos/test/repo/pulls/2'
    }
  },
  comment: {
    id: 123456790,
    body: '@Xibe-review please review this PR',
    user: {
      login: 'testuser'
    }
  },
  repository: {
    name: 'test-repo',
    full_name: 'test/repo',
    owner: {
      login: 'test'
    }
  },
  installation: {
    id: 90988524
  }
};

// Test Case 3: User asks about security
const testSecurityQuestion = {
  action: 'created',
  issue: {
    number: 3,
    pull_request: {
      url: 'https://api.github.com/repos/test/repo/pulls/3'
    }
  },
  comment: {
    id: 123456791,
    body: '@Xibe-review is this code secure? Are there any vulnerabilities?',
    user: {
      login: 'testuser'
    }
  },
  repository: {
    name: 'test-repo',
    full_name: 'test/repo',
    owner: {
      login: 'test'
    }
  },
  installation: {
    id: 90988524
  }
};

async function sendTestWebhook(testName, payload) {
  try {
    console.log(`\n🧪 ${testName}`);
    console.log('='.repeat(60));
    console.log(`📋 Test Details:`);
    console.log(`   PR Number: #${payload.issue.number}`);
    console.log(`   User Comment: "${payload.comment.body}"`);
    console.log('');
    
    console.log('📤 Sending webhook to bot...');
    
    const response = await fetch('http://localhost:3000/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issue_comment',
        'X-GitHub-Delivery': `test-delivery-${Date.now()}`,
        'User-Agent': 'GitHub-Hookshot/test'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    
    console.log(`📥 Response Status: ${response.status}`);
    console.log(`📥 Response: ${responseText}`);
    
    if (response.ok) {
      console.log('✅ Webhook received successfully!');
      console.log('🤖 Bot will now process this request with user comment context');
    } else {
      console.log('❌ Webhook failed');
    }
    
    return response.ok;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting User Comment Tests');
  console.log('='.repeat(60));
  console.log('These tests verify that user comments are properly passed');
  console.log('through the two-stage AI review process.');
  console.log('');
  
  const results = [];
  
  // Wait a bit between tests to avoid rate limiting
  results.push(await sendTestWebhook('Test 1: User asks specific question', testQuestion));
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  results.push(await sendTestWebhook('Test 2: User requests general review', testReviewRequest));
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  results.push(await sendTestWebhook('Test 3: User asks about security', testSecurityQuestion));
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`${passed === total ? '🎉 All tests passed!' : '⚠️  Some tests failed'}`);
  console.log('');
  console.log('💡 Check the bot console logs to verify that:');
  console.log('   1. User comments are logged in the review process');
  console.log('   2. Stage 1 (Analysis) receives the user comment');
  console.log('   3. Stage 2 (Comment) generates responses addressing user questions');
}

runAllTests();
