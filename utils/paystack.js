// utils/paystack.js
import axios from 'axios';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;

// Log key for debugging (only in development)
if (process.env.NODE_ENV === 'development') {
  console.log('Paystack Secret Key loaded:', 
    PAYSTACK_SECRET_KEY ? `${PAYSTACK_SECRET_KEY.substring(0, 15)}...` : 'NOT FOUND');
}

const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

/**
 * Initialize payment with Paystack
 */
export const initializePayment = async (paymentData) => {
  try {
    console.log('🔐 Initializing Paystack payment...');
    console.log('Using key:', `${PAYSTACK_SECRET_KEY?.substring(0, 15)}...`);
    console.log('Payment data:', {
      email: paymentData.email,
      amount: paymentData.amount,
      currency: paymentData.currency || 'NGN'
    });

    // Validate amount (minimum 100 kobo = 1 Naira)
    const amountInKobo = Math.round(paymentData.amount * 100);
    if (amountInKobo < 100) {
      throw new Error('Amount must be at least ₦1 (100 kobo)');
    }

    const response = await paystackAxios.post('/transaction/initialize', {
      email: paymentData.email,
      amount: amountInKobo,
      currency: paymentData.currency || 'NGN',
      metadata: paymentData.metadata || {},
      callback_url: paymentData.callback_url,
      reference: paymentData.reference || `RIDERR-${Date.now()}`,
      channels: paymentData.channels || ['card', 'bank', 'ussd', 'mobile_money'],
    });

    console.log('✅ Paystack response received:', {
      status: response.data.status,
      message: response.data.message,
      reference: response.data.data?.reference
    });

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
    console.error('❌ Paystack initialization error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        headers: {
          authorization: error.config?.headers?.Authorization?.substring(0, 30) + '...'
        }
      }
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
    console.log('🔍 Verifying payment reference:', reference);

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
    console.error('❌ Paystack verification error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    return {
      success: false,
      message: error.response?.data?.message || 'Payment verification failed',
      error: error.response?.data,
    };
  }
};

/**
 * Verify webhook signature
 */
export const verifyWebhookSignature = (payload, signature) => {
  try {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET || '')
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
  } catch (error) {
    console.error('❌ Webhook signature verification error:', error);
    return false;
  }
};

export default {
  initializePayment,
  verifyPayment,
  verifyWebhookSignature,
};