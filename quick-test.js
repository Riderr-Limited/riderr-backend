// test-paystack-manual.js
import axios from 'axios';

const SECRET_KEY = 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac';

async function testManualConnection() {
  console.log('🔐 Testing MANUAL Paystack connection...');
  console.log('Using key:', SECRET_KEY.substring(0, 20) + '...');
  
  try {
    // Test 1: Simple API call
    console.log('\n1. Testing simple API call...');
    const response1 = await axios.get('https://api.paystack.co/bank', {
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      params: {
        country: 'nigeria',
        perPage: 1,
      },
    });
    
    console.log('✅ Simple test PASSED');
    console.log('Status:', response1.status);
    
    // Test 2: Transaction initialization
    console.log('\n2. Testing transaction initialization...');
    const response2 = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: 'test@example.com',
        amount: 10000, // 100 Naira in kobo
        currency: 'NGN',
        reference: `TEST-${Date.now()}`,
      },
      {
        headers: {
          'Authorization': `Bearer ${SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ Transaction test PASSED');
    console.log('Authorization URL:', response2.data.data.authorization_url);
    console.log('Reference:', response2.data.data.reference);
    
    return { success: true, data: response2.data };
    
  } catch (error) {
    console.log('❌ MANUAL test FAILED');
    console.log('Error status:', error.response?.status);
    console.log('Error message:', error.response?.data?.message);
    console.log('Full error:', error.response?.data);
    
    if (error.response?.data?.message?.includes('IP')) {
      console.log('\n⚠️ IP ADDRESS ISSUE DETECTED');
      console.log('Your IP is not whitelisted in Paystack.');
      console.log('\nSOLUTION:');
      console.log('1. Login to Paystack dashboard');
      console.log('2. Go to Settings → API & Webhooks');
      console.log('3. Add your IP to IP Whitelist');
      console.log('4. Or add "0.0.0.0" to allow all IPs');
      console.log('5. Save and wait 2 minutes');
    }
    
    return { success: false, error: error.response?.data };
  }
}

testManualConnection();