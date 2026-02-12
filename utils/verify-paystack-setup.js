#!/usr/bin/env node

/**
 * PAYSTACK CONFIGURATION VERIFIER
 * Run this script to verify your Paystack setup
 * 
 * Usage:
 *   node verify-paystack-setup.js
 *   node verify-paystack-setup.js --live  (to force live mode check)
 */

import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const args = process.argv.slice(2);
const forceLive = args.includes('--live');

console.log('╔════════════════════════════════════════════╗');
console.log('║   PAYSTACK CONFIGURATION VERIFIER          ║');
console.log('╚════════════════════════════════════════════╝\n');

// Check environment variables
console.log('📋 Checking Environment Variables...\n');

const requiredVars = {
  'NODE_ENV': process.env.NODE_ENV || 'NOT SET',
  'FORCE_LIVE_MODE': process.env.FORCE_LIVE_MODE || 'NOT SET',
  'PAYSTACK_SECRET_KEY': process.env.PAYSTACK_SECRET_KEY ? 
    process.env.PAYSTACK_SECRET_KEY.substring(0, 15) + '...' + process.env.PAYSTACK_SECRET_KEY.slice(-4) : 
    '❌ NOT SET',
  'PAYSTACK_PUBLIC_KEY': process.env.PAYSTACK_PUBLIC_KEY ? 
    process.env.PAYSTACK_PUBLIC_KEY.substring(0, 15) + '...' + process.env.PAYSTACK_PUBLIC_KEY.slice(-4) : 
    '❌ NOT SET',
  'PAYSTACK_TEST_SECRET_KEY': process.env.PAYSTACK_TEST_SECRET_KEY ? 
    process.env.PAYSTACK_TEST_SECRET_KEY.substring(0, 15) + '...' : 
    '⚠️ NOT SET (optional)',
  'PAYSTACK_TEST_PUBLIC_KEY': process.env.PAYSTACK_TEST_PUBLIC_KEY ? 
    process.env.PAYSTACK_TEST_PUBLIC_KEY.substring(0, 15) + '...' : 
    '⚠️ NOT SET (optional)',
};

Object.entries(requiredVars).forEach(([key, value]) => {
  console.log(`  ${key}: ${value}`);
});

// Determine which mode we're in
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const FORCE_LIVE_MODE = process.env.FORCE_LIVE_MODE === 'true' || forceLive;
const USE_LIVE_KEYS = IS_PRODUCTION || FORCE_LIVE_MODE;

console.log('\n📊 Configuration Analysis:\n');
console.log(`  Environment: ${IS_PRODUCTION ? '🔴 PRODUCTION' : '🟡 DEVELOPMENT'}`);
console.log(`  Force Live Mode: ${FORCE_LIVE_MODE ? '✅ ENABLED' : '❌ DISABLED'}`);
console.log(`  Using Keys: ${USE_LIVE_KEYS ? '🔴 LIVE KEYS' : '🟡 TEST KEYS'}`);

// Select the appropriate key
const LIVE_SECRET = process.env.PAYSTACK_SECRET_KEY;
const TEST_SECRET = process.env.PAYSTACK_TEST_SECRET_KEY;
const SECRET_KEY = USE_LIVE_KEYS ? LIVE_SECRET : TEST_SECRET;

console.log(`  Selected Key: ${SECRET_KEY ? SECRET_KEY.substring(0, 15) + '...' + SECRET_KEY.slice(-4) : '❌ NONE'}`);

// Validate key format
console.log('\n🔍 Validating Key Format...\n');

if (!SECRET_KEY) {
  console.log('  ❌ ERROR: No secret key found!');
  console.log('  💡 Set PAYSTACK_SECRET_KEY (live) or PAYSTACK_TEST_SECRET_KEY (test) in .env');
  process.exit(1);
}

if (!SECRET_KEY.startsWith('sk_')) {
  console.log('  ❌ ERROR: Invalid key format!');
  console.log(`  💡 Paystack secret keys must start with "sk_"`);
  console.log(`  💡 Your key starts with: ${SECRET_KEY.substring(0, 5)}`);
  process.exit(1);
}

if (USE_LIVE_KEYS && !SECRET_KEY.startsWith('sk_live_')) {
  console.log('  ⚠️ WARNING: Live mode enabled but key is not a live key!');
  console.log(`  💡 Key starts with: ${SECRET_KEY.substring(0, 10)}`);
  console.log(`  💡 Live keys start with: sk_live_`);
}

if (!USE_LIVE_KEYS && !SECRET_KEY.startsWith('sk_test_')) {
  console.log('  ⚠️ WARNING: Test mode enabled but key is not a test key!');
  console.log(`  💡 Key starts with: ${SECRET_KEY.substring(0, 10)}`);
  console.log(`  💡 Test keys start with: sk_test_`);
}

console.log('  ✅ Key format is valid');

// Test API connection
console.log('\n🌐 Testing Paystack API Connection...\n');

const testPaystackConnection = async () => {
  try {
    const response = await axios.get('https://api.paystack.co/bank?currency=NGN', {
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (response.data.status === true) {
      console.log('  ✅ Successfully connected to Paystack API');
      console.log(`  ✅ Key is valid and working`);
      console.log(`  ✅ Mode: ${USE_LIVE_KEYS ? 'LIVE 🔴' : 'TEST 🟡'}`);
      
      if (USE_LIVE_KEYS) {
        console.log('\n  ⚠️ WARNING: You are in LIVE mode!');
        console.log('  ⚠️ Real money will be charged!');
        console.log('  💡 To switch to test mode:');
        console.log('     - Set FORCE_LIVE_MODE=false in .env');
        console.log('     - Set NODE_ENV=development in .env');
      } else {
        console.log('\n  ✅ You are in TEST mode');
        console.log('  ✅ No real money will be charged');
        console.log('  💡 Use Paystack test cards for testing');
      }

      return true;
    } else {
      console.log('  ❌ API returned unsuccessful status');
      console.log('  Message:', response.data.message);
      return false;
    }
  } catch (error) {
    console.log('  ❌ Failed to connect to Paystack API');
    
    if (error.response) {
      console.log('\n  Error Details:');
      console.log('    Status:', error.response.status);
      console.log('    Message:', error.response.data?.message || 'Unknown error');
      
      if (error.response.status === 401) {
        console.log('\n  💡 Troubleshooting:');
        console.log('     1. Check if your key is correct');
        console.log('     2. Verify no extra spaces in .env file');
        console.log('     3. Make sure you\'re using the right key (live vs test)');
        console.log('     4. Try regenerating the key in Paystack dashboard');
      }
    } else {
      console.log('\n  Error:', error.message);
      console.log('  💡 Check your internet connection');
    }
    
    return false;
  }
};

const run = async () => {
  const success = await testPaystackConnection();
  
  console.log('\n╔════════════════════════════════════════════╗');
  if (success) {
    console.log('║   ✅ CONFIGURATION IS VALID                ║');
  } else {
    console.log('║   ❌ CONFIGURATION HAS ISSUES              ║');
  }
  console.log('╚════════════════════════════════════════════╝\n');

  if (success) {
    console.log('🎉 Your Paystack configuration is working correctly!\n');
    console.log('Next Steps:');
    console.log('  1. Review the PAYSTACK_TESTING_GUIDE.md');
    console.log('  2. Test payment initialization');
    console.log('  3. Test card charging');
    console.log('  4. Monitor your Paystack dashboard\n');
  } else {
    console.log('❌ Please fix the issues above and run this script again.\n');
    process.exit(1);
  }
};

run();