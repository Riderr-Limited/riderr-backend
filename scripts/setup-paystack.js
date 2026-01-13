#!/usr/bin/env node

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

async function testPaystackConnection() {
  console.log('🔗 Testing Paystack connection...\n');
  
  if (!PAYSTACK_SECRET_KEY) {
    console.error('❌ ERROR: PAYSTACK_SECRET_KEY is not set in .env file');
    console.log('\n📝 Please add the following to your .env file:');
    console.log('PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx');
    console.log('PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx');
    return false;
  }
  
  console.log(`✅ PAYSTACK_SECRET_KEY found: ${PAYSTACK_SECRET_KEY.substring(0, 10)}...`);
  console.log(`   Length: ${PAYSTACK_SECRET_KEY.length} characters`);
  
  // Check key format
  if (!PAYSTACK_SECRET_KEY.startsWith('sk_')) {
    console.error('❌ ERROR: PAYSTACK_SECRET_KEY should start with "sk_"');
    console.log('   Test keys start with "sk_test_"');
    console.log('   Live keys start with "sk_live_"');
    return false;
  }
  
  // Test the connection
  try {
    const response = await axios.get('https://api.paystack.co/transaction/totals', {
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    console.log('\n✅ SUCCESS: Paystack connection established!');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Message: ${response.data.message}`);
    
    if (response.data.data) {
      console.log('\n📊 Account Information:');
      console.log(`   Total Transactions: ${response.data.data.total_transactions}`);
      console.log(`   Total Volume: ₦${(response.data.data.total_volume / 100).toLocaleString()}`);
      console.log(`   Total Volume by Currency:`, response.data.data.total_volume_by_currency);
    }
    
    return true;
  } catch (error) {
    console.error('\n❌ ERROR: Failed to connect to Paystack');
    
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Message: ${error.response.data?.message || 'No message'}`);
      
      if (error.response.status === 401) {
        console.log('\n🔑 Possible issues:');
        console.log('   1. Invalid API key');
        console.log('   2. Expired API key');
        console.log('   3. Incorrect key format');
        console.log('\n💡 Solution:');
        console.log('   - Get your API keys from: https://dashboard.paystack.com/#/settings/developers');
        console.log('   - Test keys start with "sk_test_"');
        console.log('   - Live keys start with "sk_live_"');
      }
    } else if (error.request) {
      console.log('   No response received. Check your internet connection.');
    } else {
      console.log('   Error:', error.message);
    }
    
    return false;
  }
}

async function initializeTestPayment() {
  console.log('\n💰 Testing payment initialization...\n');
  
  const testData = {
    email: 'test@example.com',
    amount: 1000, // ₦10
    reference: `TEST-${Date.now()}`,
    metadata: {
      test: true,
      timestamp: new Date().toISOString(),
    },
  };
  
  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      testData,
      {
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (response.data.status === true) {
      console.log('✅ Payment initialization successful!');
      console.log(`   Reference: ${response.data.data.reference}`);
      console.log(`   Authorization URL: ${response.data.data.authorization_url}`);
      console.log(`   Access Code: ${response.data.data.access_code}`);
      
      console.log('\n📝 To test payment verification:');
      console.log(`   curl -H "Authorization: Bearer ${PAYSTACK_SECRET_KEY.substring(0, 10)}..." \\
        https://api.paystack.co/transaction/verify/${response.data.data.reference}`);
      
      return true;
    } else {
      console.error('❌ Payment initialization failed');
      console.log(`   Message: ${response.data.message}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Payment initialization error:', error.response?.data?.message || error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Paystack Setup & Test Script\n');
  console.log('='.repeat(50));
  
  const connected = await testPaystackConnection();
  
  if (connected) {
    console.log('\n' + '='.repeat(50));
    await initializeTestPayment();
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📚 Next steps:');
  console.log('   1. Visit: https://dashboard.paystack.com/#/settings/developers');
  console.log('   2. Copy your test/live API keys');
  console.log('   3. Add them to your .env file');
  console.log('   4. Restart your application');
  
  // Check if .env file exists
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    if (!envContent.includes('PAYSTACK_SECRET_KEY=')) {
      console.log('\n📄 Your .env file should contain:');
      console.log(`
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxx
      `.trim());
    }
  } else {
    console.log('\n📄 Create a .env file with:');
    console.log(`
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxx
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/yourdb
      `.trim());
  }
  
  console.log('\n✅ Script completed');
}

main().catch(console.error);