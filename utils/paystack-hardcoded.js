// utils/paystack-hardcoded.js
import axios from 'axios';

// ===== HARDCODED CONFIGURATION =====
const PAYSTACK_SECRET_KEY = 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac';
const PAYSTACK_PUBLIC_KEY = 'pk_test_5240eb0402f627e4bdc37a9971c35a20ed27a0f0';
const FRONTEND_URL = 'http://localhost:3000';

console.log('🔧 Using HARDCODED Paystack configuration');
console.log('Key:', PAYSTACK_SECRET_KEY.substring(0, 15) + '...');

const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

/**
 * Initialize payment with Paystack
 */
export const initializePayment = async (paymentData) => {
  try {
    console.log('💰 Initializing HARDCODED payment...');
    console.log('Email:', paymentData.email);
    console.log('Amount:', paymentData.amount);
    
    // Convert to kobo
    const amountInKobo = Math.round(paymentData.amount * 100);
    
    // Make the request
    const response = await paystackAxios.post('/transaction/initialize', {
      email: paymentData.email,
      amount: amountInKobo,
      currency: 'NGN',
      metadata: paymentData.metadata || {},
      callback_url: paymentData.callback_url || `${FRONTEND_URL}/payment/verify`,
      reference: `RIDERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });

    console.log('✅ Paystack response received');
    
    if (response.data.status === true) {
      return {
        success: true,
        message: 'Payment initialized successfully',
        data: response.data.data,
      };
    } else {
      return {
        success: false,
        message: response.data.message || 'Failed to initialize payment',
        error: response.data,
      };
    }
  } catch (error) {
    console.error('❌ HARDCODED Paystack error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      headers: error.config?.headers,
    });
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment initialization failed',
      error: error.response?.data,
    };
  }
};

/**
 * Verify payment with Paystack
 */
export const verifyPayment = async (reference) => {
  try {
    console.log('🔍 Verifying HARDCODED payment:', reference);
    
    const response = await paystackAxios.get(`/transaction/verify/${reference}`);
    
    if (response.data.status === true) {
      return {
        success: true,
        message: 'Payment verified successfully',
        data: response.data.data,
      };
    } else {
      return {
        success: false,
        message: response.data.message || 'Payment verification failed',
        error: response.data,
      };
    }
  } catch (error) {
    console.error('❌ HARDCODED verification error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment verification failed',
      error: error.response?.data,
    };
  }
};

export default {
  initializePayment,
  verifyPayment,
};