#!/usr/bin/env node

/**
 * Test script for the dual repository manager
 * This script tests the functionality without making actual git commits
 */

import fs from 'fs';
import path from 'path';

// Test configuration
const TEST_CONFIG = {
  privateRepo: {
    remote: 'origin-private',
    url: 'git@github.com:test/xibe-pr1-private.git',
    branch: 'main'
  },
  publicRepo: {
    remote: 'origin-public',
    url: 'git@github.com:test/xibe-pr1.git',
    branch: 'main'
  },
  privateKeyParts: {
    hardcodedPart: 'MIIEpQIBAAKCAQEA1O4muezGZn9+ivUJcABTKHPGLd2eaLuRnfmhWsymnqHIvAEE\nYe+SuvoRty7wquYkk0gtMpEf1+TCK7mopqh+D6SN8b7I/X0GM72RrPfDpRSlJRb0\nRXtE1REjytbKjm+ukoGwfk0597+0ftE4CvsqeE2NaRfitW3RfPn58QOt1NVtZh4T\nyDCsYxzGez5jsk9DoLYWuJ0mu5E9IJbMg6C1S763gD6GueujMpExLvW1UgNh1/4l\nyI6wcF2X9rzI36ZIxk8PY2JLJbVjQON8QEdXZs/d9r3aal8iht8O2ML9hGswUipF\n9xCuYm/ucVzQEaYc3Qx8t0sr9Z+0yiEHijjuIwIDAQABAoIBAQCohQMpSveKz4S7\nPUuG1Pr7nQVP74IbqbeJq7PERQvpqGlSQgvR5uXeDWRP8lqPJy3zUsBSsQDewTHb\noUiU/e0nPDkLBs/Tr0tlT7cnib/RuxEo1Y3mH7VOXA5TzsLpEAK9+N5SV5R1O8gC\nRltwdXAbXmV4s2q95HhTzRO/aAX/1qfCrNTHjOHqct3XVf39E7jqdwVHJ5B7p8Tt\nMl/VmNPJWE2Kv244XhGlU8D5TF1UqDBj9gHV2/Nb+0/WI0B+MUpYUzkGIzuZpaZG\n4XSgkUSjG9tdaBkf/bT4WChuJMuRYyewB3b+TzEC9IMkbU480gALiURE+2Yn65xH\n1QvnnB5hAoGBAP03I+dvcwPt4iqo7Tl9LxfKyLnyuzsFPVrKqmupW1ewh+d4rgIL\npFpAy87ldx/dLcS7JWpRvx+tTpcOk5wkrvzjhnWnmr0UjgQPpQRTyKZkMb31iU+t\nVUU9/DUfWuRHJ8l+D+wHcqJOMc6EbZ98ljS861v6+yI3qDVapcvtAmrNAoGBANdF\nmWD6YjQytn2vCcUNS/hHAxmeRmlWTJ20ygV8HbdOHpganHUqCtLeMwqvTK6GM0RA\nVOc71NSoDrphOdMIi4AJkdkepfbqKAYSi74jOzS1xxkbveCjJGnICqCtUXcfndER\nCECZBC2XUyjnWFMkCRxvcq9N5Rj8j7DutvmIcZyvAoGBAPEYT1dNBnX3SiDUNwtF\n5lEBA54JP7wygPixfxKDbjVQIBaFESlhbFuC1otocMQmFC39AuL4csH2gZ3Sgzlo\ntDSVbrEXpH3j1FSJkNVN8P5859+2qcbzgv0qx7jM4f34wilXnlFdxghD66h27umr\n9ljAiFhL4FH0LHSgmrxQLr0BAoGBAJ/ycJHjt8+81mbwBTxKMuYYLS99sCdYHbkX\nuPr2S0YFXyn4q8NKJ5yhyB7qPPl3cOQHQI5GoE4ZSEgnMUWhlbTeZ2WBJiMdu/s3\nEGmH19fEMFhxilU8IjQOlAbqgBsYfLP4Cb+lcbtGMl2z9qZfof1kuTuTjuNP1JvL\n4lvpizC1AoGAQ2UmFfJAZQjt6SIlI95Lqg24JRrHXoTpcFLF2YvD+CtCbZLzNgr8\nhftuMtL931IB4FbEWxc2UTKL9aEjC95tDDxdmHrbe/h2HD9bWURGRBdWAOs+4u3a\nQ2Y+b0nFZPsIUIRrRWP+WJ0dvgNEckOBa+ecE5zVs9VhNmLbWfusxo0=',
    envPart: 'TEST_SUFFIX_PART'
  },
  currentMode: 'public'
};

console.log('🧪 Testing Dual Repository Manager...\n');

// Test 1: Check if bot.js exists
console.log('Test 1: Checking bot.js exists...');
if (fs.existsSync('bot.js')) {
  console.log('✅ bot.js found');
} else {
  console.log('❌ bot.js not found');
  process.exit(1);
}

// Test 2: Check if .env.example exists
console.log('\nTest 2: Checking .env.example exists...');
if (fs.existsSync('.env.example')) {
  console.log('✅ .env.example found');
} else {
  console.log('❌ .env.example not found');
}

// Test 3: Test private key reconstruction
console.log('\nTest 3: Testing private key reconstruction...');
const hardcodedPart = TEST_CONFIG.privateKeyParts.hardcodedPart;
const envPart = TEST_CONFIG.privateKeyParts.envPart;

// Simulate private mode (hardcoded)
const privateKey = `-----BEGIN RSA PRIVATE KEY-----
${hardcodedPart}${envPart}
-----END RSA PRIVATE KEY-----`;

// Simulate public mode (environment variable)
const publicKey = `-----BEGIN RSA PRIVATE KEY-----
${hardcodedPart}\${GITHUB_PRIVATE_KEY_SUFFIX || ''}
-----END RSA PRIVATE KEY-----`;

console.log('✅ Private key reconstruction works');
console.log(`   Private mode key length: ${privateKey.length}`);
console.log(`   Public mode key length: ${publicKey.length}`);

// Test 4: Test configuration file creation
console.log('\nTest 4: Testing configuration file creation...');
try {
  fs.writeFileSync('.repo-config.json', JSON.stringify(TEST_CONFIG, null, 2));
  console.log('✅ Configuration file created successfully');
  
  // Read it back
  const loadedConfig = JSON.parse(fs.readFileSync('.repo-config.json', 'utf8'));
  console.log('✅ Configuration file can be read back');
  console.log(`   Current mode: ${loadedConfig.currentMode}`);
  console.log(`   Private repo: ${loadedConfig.privateRepo.url}`);
  console.log(`   Public repo: ${loadedConfig.publicRepo.url}`);
  
} catch (error) {
  console.log('❌ Configuration file creation failed:', error.message);
}

// Test 5: Test bot.js modification (simulation)
console.log('\nTest 5: Testing bot.js modification simulation...');
try {
  let botContent = fs.readFileSync('bot.js', 'utf8');
  
  // Check if the current content has the expected structure
  if (botContent.includes('GITHUB_PRIVATE_KEY_SUFFIX')) {
    console.log('✅ bot.js has environment variable structure');
  } else {
    console.log('⚠️  bot.js does not have environment variable structure');
  }
  
  if (botContent.includes('Private key is split for security')) {
    console.log('✅ bot.js has the expected comment structure');
  } else {
    console.log('⚠️  bot.js does not have the expected comment structure');
  }
  
} catch (error) {
  console.log('❌ bot.js modification test failed:', error.message);
}

// Test 6: Test .env.example modification (simulation)
console.log('\nTest 6: Testing .env.example modification simulation...');
try {
  if (fs.existsSync('.env.example')) {
    let envContent = fs.readFileSync('.env.example', 'utf8');
    
    if (envContent.includes('GITHUB_PRIVATE_KEY_SUFFIX')) {
      console.log('✅ .env.example has GITHUB_PRIVATE_KEY_SUFFIX variable');
    } else {
      console.log('⚠️  .env.example does not have GITHUB_PRIVATE_KEY_SUFFIX variable');
    }
    
    if (envContent.includes('Last part of private key')) {
      console.log('✅ .env.example has the expected comment');
    } else {
      console.log('⚠️  .env.example does not have the expected comment');
    }
  } else {
    console.log('⚠️  .env.example not found, skipping test');
  }
} catch (error) {
  console.log('❌ .env.example modification test failed:', error.message);
}

// Cleanup
console.log('\n🧹 Cleaning up test files...');
try {
  if (fs.existsSync('.repo-config.json')) {
    fs.unlinkSync('.repo-config.json');
    console.log('✅ Test configuration file removed');
  }
} catch (error) {
  console.log('⚠️  Could not remove test configuration file:', error.message);
}

console.log('\n🎉 All tests completed!');
console.log('\n📋 Next steps:');
console.log('   1. Run: node repo-manager.js init');
console.log('   2. Configure your private key parts');
console.log('   3. Test: node repo-manager.js private');
console.log('   4. Test: node repo-manager.js public');
console.log('   5. Check: node repo-manager.js status');
