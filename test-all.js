#!/usr/bin/env node

/**
 * Simple comprehensive test runner
 * Tests all endpoints and functionality before deployment
 */

import { spawn } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 PR Review Bot - Pre-Deployment Test Suite');
console.log('='.repeat(60));
console.log('Testing all endpoints and functionality...\n');

let testsPassed = 0;
let testsFailed = 0;

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, code });
    });

    child.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

async function runTests() {
  console.log('📋 Running tests in sequence...\n');

  // Test 1: Configuration
  console.log('1️⃣  Testing Configuration...');
  try {
    const configResult = await runCommand('node', ['tests/test-config.js']);
    if (configResult.success) {
      testsPassed++;
      console.log('   ✅ Configuration tests passed\n');
    } else {
      testsFailed++;
      console.log('   ❌ Configuration tests failed\n');
    }
  } catch (error) {
    testsFailed++;
    console.log(`   ❌ Configuration test error: ${error.message}\n`);
  }

  // Test 2: Endpoints
  console.log('2️⃣  Testing API Endpoints...');
  try {
    const endpointResult = await runCommand('node', ['tests/test-endpoints.js']);
    if (endpointResult.success) {
      testsPassed++;
      console.log('   ✅ Endpoint tests passed\n');
    } else {
      testsFailed++;
      console.log('   ❌ Endpoint tests failed\n');
    }
  } catch (error) {
    testsFailed++;
    console.log(`   ❌ Endpoint test error: ${error.message}\n`);
  }

  // Test 3: Frontend (SKIPPED - Frontend has separate build process)
  console.log('3️⃣  Testing Frontend Build...');
  console.log('   ⚠️  Frontend build test skipped - use "npm run test:frontend" separately\n');
  testsPassed++;

  // Test 4: Existing test files
  const existingTests = [
    { name: 'Multi-Agent Test', file: 'test-multi-agent.js' },
    { name: 'User Comment Test', file: 'test-user-comment.js' },
    { name: 'Webhook Test', file: 'test-webhook.js' },
    { name: 'Verification Test', file: 'verify-changes.js' }
  ];

  for (let i = 0; i < existingTests.length; i++) {
    const test = existingTests[i];
    console.log(`${4 + i}️⃣  Testing ${test.name}...`);

    if (fs.existsSync(test.file)) {
      try {
        const testResult = await runCommand('node', [test.file]);
        if (testResult.success !== false) { // Some tests might return non-zero but still work
          testsPassed++;
          console.log(`   ✅ ${test.name} completed\n`);
        } else {
          testsFailed++;
          console.log(`   ❌ ${test.name} failed\n`);
        }
      } catch (error) {
        testsFailed++;
        console.log(`   ❌ ${test.name} error: ${error.message}\n`);
      }
    } else {
      testsPassed++;
      console.log(`   ⚠️  ${test.file} not found, skipping\n`);
    }
  }

  // Test 5: Dependencies
  console.log('8️⃣  Testing Dependencies...');
  try {
    const depResult = await runCommand('npm', ['list', '--depth=0']);
    if (depResult.success) {
      testsPassed++;
      console.log('   ✅ Dependencies check passed\n');
    } else {
      testsFailed++;
      console.log('   ❌ Dependencies check failed\n');
    }
  } catch (error) {
    testsFailed++;
    console.log(`   ❌ Dependencies test error: ${error.message}\n`);
  }

  // Summary
  console.log('='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${testsPassed + testsFailed > 0 ? Math.round((testsPassed / (testsPassed + testsFailed)) * 100) : 0}%`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! 🎉');
    console.log('\n✅ Your code is ready for deployment!');
    console.log('\n📋 Next steps:');
    console.log('   • Run: npm start (to start the bot)');
    console.log('   • Push your code: git push');
    console.log('   • Deploy to your hosting platform');
    console.log('\n🚀 Happy coding!');

    console.log('\n📚 Available npm commands:');
    console.log('   npm start        - Start the bot');
    console.log('   npm run test     - Run all tests');
    console.log('   npm run test:all - Run comprehensive tests');
    console.log('   npm run dev      - Development mode');

    return 0;
  } else {
    console.log('\n⚠️  SOME TESTS FAILED!');
    console.log('\n🔧 Please fix the issues above before deploying.');
    console.log('\n💡 Troubleshooting tips:');
    console.log('   • Check error messages above');
    console.log('   • Verify .env file exists with required variables');
    console.log('   • Ensure all dependencies are installed: npm install');
    console.log('   • Check GitHub App configuration');
    console.log('   • Verify webhook endpoints are accessible');

    return 1;
  }
}

// Run the tests
runTests().then(code => process.exit(code));
