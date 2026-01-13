// utils/paystack-no-ip.js
import axios from 'axios';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY?.trim();

// Create axios instance with proper error handling
const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Riderr-Delivery-App/1.0'
  },
  timeout: 30000,
});

// Add response interceptor for better error handling
paystackAxios.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('Paystack API Error:', {
      status: error.response?.status,
      message: error.response?.data?.message,
      url: error.config?.url,
      method: error.config?.method,
    });
    
    // Handle IP restriction error specifically
    if (error.response?.data?.message?.includes('IP address is not allowed')) {
      console.error('💡 IP RESTRICTION DETECTED!');
      console.error('Please add your IP to Paystack whitelist:');
      console.error('1. Go to Paystack Dashboard');
      console.error('2. Settings → API & Webhooks');
      console.error('3. Add your IP to IP Whitelist');
      console.error('4. Or use 0.0.0.0 to allow all IPs');
    }
    
    return Promise.reject(error);
  }
);

export const initializePayment = async (paymentData) => {
  try {
    console.log('Initializing payment...');
    
    // For development/testing with IP restriction issues
    if (process.env.NODE_ENV === 'development' && 
        PAYSTACK_SECRET_KEY?.includes('test')) {
      
      // Check if we should use mock for IP issues
      const shouldMock = process.env.USE_MOCK_PAYSTACK === 'true';
      
      if (shouldMock) {
        console.log('⚠️ Using mock payment due to IP restrictions');
        return {
          success: true,
          message: 'Mock payment (development mode)',
          data: {
            authorization_url: `http://localhost:3000/payment/mock?amount=${paymentData.amount}&reference=DEV-${Date.now()}`,
            access_code: 'dev-access-code',
            reference: `DEV-${Date.now()}`,
          }
        };
      }
    }
    
    const amountInKobo = Math.round(paymentData.amount * 100);
    
    const response = await paystackAxios.post('/transaction/initialize', {
      email: paymentData.email,
      amount: amountInKobo,
      currency: paymentData.currency || 'NGN',
      metadata: paymentData.metadata || {},
      callback_url: paymentData.callback_url,
      reference: paymentData.reference || `RIDERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    });
    
    if (response.data.status === true) {
      return {
        success: true,
        message: 'Payment initialized successfully',
        data: response.data.data,
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Payment initialization failed',
      error: response.data,
    };
    
  } catch (error) {
    // If IP restriction error, provide helpful message
    if (error.response?.data?.message?.includes('IP address is not allowed')) {
      return {
        success: false,
        message: 'IP address not whitelisted. Please contact admin or use mock payment for development.',
        error: error.response.data,
        help: 'Add your IP to Paystack whitelist or use 0.0.0.0 for testing',
      };
    }
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment initialization failed',
      error: error.response?.data,
    };
  }
};