#!/usr/bin/env node

/**
 * Configuration Test
 * Tests environment variables and configuration setup
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

console.log('🔧 Configuration Test');
console.log('====================');

let testsPassed = 0;
let testsFailed = 0;

// Test 1: Check if .env file exists
console.log('\n1️⃣  Checking .env file...');
try {
  const fs = await import('fs');
  if (fs.existsSync('.env')) {
    console.log('   ✅ .env file found');
    testsPassed++;
  } else {
    console.log('   ⚠️  .env file not found (using system environment)');
    testsPassed++; // Not critical for testing
  }
} catch (error) {
  console.log('   ❌ Error checking .env file:', error.message);
  testsFailed++;
}

// Test 2: Check required environment variables
console.log('\n2️⃣  Checking required environment variables...');
const requiredVars = [
  'AI_API',
  'AI_KEY',
  'PORT'
];

const optionalVars = [
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_TOKEN',
  'BOT_USERNAME'
];

let missingRequired = [];
let missingOptional = [];

requiredVars.forEach(varName => {
  if (!process.env[varName]) {
    missingRequired.push(varName);
  }
});

optionalVars.forEach(varName => {
  if (!process.env[varName]) {
    missingOptional.push(varName);
  }
});

if (missingRequired.length === 0) {
  console.log('   ✅ All required environment variables are set');
  testsPassed++;
} else {
  console.log(`   ❌ Missing required variables: ${missingRequired.join(', ')}`);
  testsFailed++;
}

if (missingOptional.length > 0) {
  console.log(`   ⚠️  Missing optional variables: ${missingOptional.join(', ')}`);
}

// Test 3: Check AI configuration
console.log('\n3️⃣  Checking AI configuration...');
if (process.env.AI_API && process.env.AI_KEY) {
  console.log('   ✅ AI configuration found');
  console.log(`   📡 AI API: ${process.env.AI_API}`);
  console.log(`   🔑 AI Key: ${process.env.AI_KEY.substring(0, 10)}...`);
  testsPassed++;
} else {
  console.log('   ❌ AI configuration missing');
  testsFailed++;
}

// Test 4: Check GitHub authentication
console.log('\n4️⃣  Checking GitHub authentication...');
const hasGitHubApp = process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY;
const hasGitHubPAT = process.env.GITHUB_TOKEN;

if (hasGitHubApp) {
  console.log('   ✅ GitHub App authentication configured');
  console.log(`   🆔 App ID: ${process.env.GITHUB_APP_ID}`);
  testsPassed++;
} else if (hasGitHubPAT) {
  console.log('   ✅ GitHub PAT authentication configured');
  console.log(`   🔑 Token: ${process.env.GITHUB_TOKEN.substring(0, 10)}...`);
  testsPassed++;
} else {
  console.log('   ⚠️  No GitHub authentication configured (test mode)');
  testsPassed++; // Not critical for testing
}

// Test 5: Check bot configuration
console.log('\n5️⃣  Checking bot configuration...');
const botUsername = process.env.BOT_USERNAME || 'Xibe-review';
const port = process.env.PORT || 3000;

console.log(`   🤖 Bot Username: ${botUsername}`);
console.log(`   🌐 Port: ${port}`);
console.log('   ✅ Bot configuration valid');
testsPassed++;

// Summary
console.log('\n📊 Configuration Test Results:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);

if (testsFailed === 0) {
  console.log('\n🎉 All configuration tests passed!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some configuration tests failed!');
  console.log('💡 Make sure to set required environment variables');
  process.exit(1);
}
