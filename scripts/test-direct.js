// test-direct.js
import axios from 'axios';

const testDirect = async () => {
  const SECRET_KEY = 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac';
  
  console.log('=== DIRECT PAYSTACK API TEST ===');
  console.log('Key:', SECRET_KEY.substring(0, 20) + '...');
  console.log('Key length:', SECRET_KEY.length);
  console.log('Testing with quotes:', `"${SECRET_KEY}"`);
  
  try {
    // Test 1: Simple bank list (should work if key is valid)
    console.log('\n📋 Test 1: Getting bank list...');
    const response1 = await axios.get('https://api.paystack.co/bank', {
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`
      },
      params: {
        country: 'nigeria',
        perPage: 1
      }
    });
    console.log('✅ Bank list test PASSED');
    console.log('Status:', response1.status);
    console.log('Data:', response1.data);
    
    // Test 2: Initialize transaction (what your app is doing)
    console.log('\n💰 Test 2: Initializing transaction...');
    const response2 = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: 'test@example.com',
        amount: 10000, // 100 Naira in kobo
        currency: 'NGN',
        reference: `TEST-${Date.now()}`
      },
      {
        headers: {
          'Authorization': `Bearer ${SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ Transaction test PASSED');
    console.log('Status:', response2.status);
    console.log('Data:', response2.data);
    
  } catch (error) {
    console.log('❌ Test FAILED');
    console.log('Error status:', error.response?.status);
    console.log('Error message:', error.response?.data?.message);
    console.log('Full error:', JSON.stringify(error.response?.data, null, 2));
    
    // Check for common issues
    if (error.response?.status === 401) {
      console.log('\n🔍 Possible issues:');
      console.log('1. Key has expired');
      console.log('2. Key has trailing spaces');
      console.log('3. Account not verified');
      console.log('4. IP restriction enabled');
    }
  }
};

testDirect();