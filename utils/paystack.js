// utils/paystack.js - FIXED VERSION WITH PROPER KEY HANDLING
import axios from 'axios';

// ===== ENVIRONMENT-BASED CONFIGURATION =====
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// 🔴 FORCE LIVE MODE - Set to true to use live keys even in development
// Set this via environment variable: FORCE_LIVE_MODE=true
const FORCE_LIVE_MODE = true

// Live Keys (for production and when forced)
const LIVE_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_d68be4ae85980a9c4c319edf02dc2db4aca8cbdd';
const LIVE_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || 'pk_live_3b52907c8d7a45ff0d023758e4a810bec5e2fc8a';

// Test Keys (for development/testing)
const TEST_SECRET_KEY = process.env.PAYSTACK_TEST_SECRET_KEY || 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac';
const TEST_PUBLIC_KEY = process.env.PAYSTACK_TEST_PUBLIC_KEY || 'pk_test_5240eb0402f627e4bdc37a9971c35a20ed27a0f0';

// ✅ ALWAYS USE LIVE KEYS
const PAYSTACK_SECRET_KEY = LIVE_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = LIVE_PUBLIC_KEY;
const USE_LIVE_KEYS = true; 

// URLs
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://riderr.ng';
const BACKEND_URL = process.env.BACKEND_URL || 'https://api.riderrapp.com';
const MOBILE_CALLBACK_URL = `${BACKEND_URL}/api/payments/mobile-callback`;

// ✅ Log configuration (without exposing full keys)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔧 Paystack Configuration:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Environment:', IS_PRODUCTION ? '🔴 PRODUCTION' : '🟡 DEVELOPMENT');
console.log('Force Live Mode:', FORCE_LIVE_MODE ? '✅ ENABLED' : '❌ DISABLED');
console.log('Using Keys:', USE_LIVE_KEYS ? '🔴 LIVE KEYS' : '🟡 TEST KEYS');
console.log('Secret Key:', PAYSTACK_SECRET_KEY.substring(0, 15) + '...' + PAYSTACK_SECRET_KEY.slice(-4));
console.log('Public Key:', PAYSTACK_PUBLIC_KEY.substring(0, 15) + '...' + PAYSTACK_PUBLIC_KEY.slice(-4));
console.log('Callback URL:', MOBILE_CALLBACK_URL);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ✅ Validate keys
if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY.length < 20) {
  console.error('❌ ERROR: Invalid or missing Paystack secret key!');
  console.error('Current key:', PAYSTACK_SECRET_KEY?.substring(0, 15) || 'NONE');
  throw new Error('Invalid Paystack secret key');
}

if (!PAYSTACK_SECRET_KEY.startsWith('sk_')) {
  console.error('❌ ERROR: Paystack secret key must start with "sk_"');
  console.error('Current key starts with:', PAYSTACK_SECRET_KEY.substring(0, 5));
  throw new Error('Invalid Paystack secret key format');
}

// Create axios instance
const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Add request interceptor for logging
paystackAxios.interceptors.request.use((config) => {
  if (!IS_PRODUCTION || FORCE_LIVE_MODE) {
    console.log('📤 Paystack Request:', config.method?.toUpperCase(), config.url);
    console.log('   Auth:', config.headers.Authorization.substring(0, 30) + '...');
  }
  return config;
}, (error) => {
  console.error('❌ Request Error:', error);
  return Promise.reject(error);
});

// Add response interceptor for logging
paystackAxios.interceptors.response.use((response) => {
  if (!IS_PRODUCTION || FORCE_LIVE_MODE) {
    console.log('📥 Paystack Response:', response.status, response.config.url);
    console.log('   Status:', response.data.status);
  }
  return response;
}, (error) => {
  console.error('❌ Response Error:', error.response?.status, error.response?.data);
  
  // Log more details about the error
  if (error.response?.data) {
    console.error('   Error Details:', JSON.stringify(error.response.data, null, 2));
  }
  
  return Promise.reject(error);
});

/**
 * Initialize payment with Paystack
 * Supports: Card, Bank Transfer, USSD, QR
 */
export const initializePayment = async (paymentData) => {
  try {
    console.log('💰 Initializing payment...');
    console.log('Email:', paymentData.email);
    console.log('Amount:', paymentData.amount);
    console.log('Using:', USE_LIVE_KEYS ? 'LIVE KEYS 🔴' : 'TEST KEYS 🟡');
    
    // Convert to kobo (Paystack uses kobo, not naira)
    const amountInKobo = Math.round(paymentData.amount * 100);
    
    // Build payload
    const payload = {
      email: paymentData.email,
      amount: amountInKobo,
      currency: 'NGN',
      metadata: {
        ...paymentData.metadata,
        environment: USE_LIVE_KEYS ? 'live' : 'test',
        isProduction: IS_PRODUCTION,
        forceLiveMode: FORCE_LIVE_MODE,
      },
      reference: paymentData.reference || `RIDERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      channels: paymentData.channels || ['card', 'bank', 'ussd', 'qr'], // All supported channels
    };

    // Set callback URL
    payload.callback_url = paymentData.callback_url || MOBILE_CALLBACK_URL;

    // Add split payment (escrow) if subaccount provided
    if (paymentData.subaccount) {
      payload.subaccount = paymentData.subaccount;
      
      // Platform fee (10%)
      if (paymentData.transaction_charge) {
        payload.transaction_charge = Math.round(paymentData.transaction_charge * 100);
      }
      
      // Who pays Paystack fees
      payload.bearer = paymentData.bearer || 'account'; // Company pays fees
      
      console.log('🏦 ESCROW MODE: Split payment enabled');
      console.log('Platform Fee:', payload.transaction_charge / 100, 'NGN');
    }
    
    console.log('📤 Sending request to Paystack...');
    
    // Make request to Paystack
    const response = await paystackAxios.post('/transaction/initialize', payload);

    if (response.data.status === true) {
      console.log('✅ Payment initialized successfully');
      console.log('   Reference:', response.data.data.reference);
      console.log('   Access Code:', response.data.data.access_code);
      
      return {
        success: true,
        message: 'Payment initialized successfully',
        data: response.data.data,
      };
    } else {
      console.error('❌ Paystack initialization failed:', response.data.message);
      return {
        success: false,
        message: response.data.message || 'Failed to initialize payment',
        error: response.data,
      };
    }
  } catch (error) {
    console.error('❌ Payment initialization error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        authHeader: error.config?.headers?.Authorization?.substring(0, 30) + '...',
      }
    });
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment initialization failed',
      error: error.response?.data || error.message,
      keyInfo: {
        usingLiveKeys: USE_LIVE_KEYS,
        keyPrefix: PAYSTACK_SECRET_KEY.substring(0, 10),
        keyLength: PAYSTACK_SECRET_KEY.length,
      }
    };
  }
};

/**
 * Verify payment with Paystack
 */
export const verifyPayment = async (reference) => {
  try {
    console.log('🔍 Verifying payment:', reference);
    console.log('Using:', USE_LIVE_KEYS ? 'LIVE KEYS 🔴' : 'TEST KEYS 🟡');
    
    const response = await paystackAxios.get(`/transaction/verify/${reference}`);
    
    if (response.data.status === true) {
      const data = response.data.data;
      
      // Log split payment details
      if (data.subaccount) {
        console.log('💰 Split Payment Detected:');
        console.log('Total Amount:', data.amount / 100, 'NGN');
        console.log('Company Amount:', data.subaccount?.share / 100, 'NGN');
        console.log('Platform Fee:', (data.amount - data.subaccount?.share) / 100, 'NGN');
      }
      
      console.log('✅ Payment verified:', data.status);
      
      return {
        success: true,
        message: 'Payment verified successfully',
        data: data,
      };
    } else {
      console.error('❌ Verification failed:', response.data.message);
      return {
        success: false,
        message: response.data.message || 'Payment verification failed',
        error: response.data,
      };
    }
  } catch (error) {
    console.error('❌ Verification error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment verification failed',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Charge card directly (for in-app payments)
 */
export const chargeCardViaPaystack = async (chargeData) => {
  try {
    console.log('💳 Charging card directly...');
    console.log('Using:', USE_LIVE_KEYS ? 'LIVE KEYS 🔴' : 'TEST KEYS 🟡');
    console.log('Email:', chargeData.email);
    console.log('Amount:', chargeData.amount, 'NGN');
    console.log('Card ending:', chargeData.card.number.slice(-4));
    
    const payload = {
      email: chargeData.email,
      amount: Math.round(chargeData.amount * 100), // Convert to kobo
      card: {
        number: chargeData.card.number,
        cvv: chargeData.card.cvv,
        expiry_month: chargeData.card.expiry_month,
        expiry_year: chargeData.card.expiry_year,
      },
      metadata: {
        ...chargeData.metadata,
        environment: USE_LIVE_KEYS ? 'live' : 'test',
      },
    };

    // Add PIN if provided (for Nigerian cards)
    if (chargeData.card.pin) {
      payload.pin = chargeData.card.pin;
      console.log('🔐 PIN provided for Nigerian card');
    }

    console.log('📤 Sending charge request to Paystack...');
    const response = await paystackAxios.post('/transaction/charge', payload);

    if (response.data.status === true) {
      const data = response.data.data;
      
      // Handle different charge statuses
      if (data.status === 'send_otp') {
        console.log('🔐 OTP required');
        return {
          success: true,
          requiresOtp: true,
          message: 'OTP sent to your phone',
          data: data,
        };
      }
      
      if (data.status === 'send_pin') {
        console.log('🔐 PIN required');
        return {
          success: true,
          requiresPin: true,
          message: 'Card PIN required',
          data: data,
        };
      }
      
      if (data.status === 'success') {
        console.log('✅ Card charged successfully');
        return {
          success: true,
          requiresOtp: false,
          message: 'Payment successful',
          data: data,
        };
      }
      
      console.warn('⚠️ Unexpected charge status:', data.status);
      return {
        success: false,
        message: data.gateway_response || 'Payment failed',
        error: data,
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Card charge failed',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Card charge error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    
    return {
      success: false,
      message: error.response?.data?.message || 'Card charge failed',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Submit OTP for pending charge
 */
export const submitOtpToPaystack = async (otpData) => {
  try {
    console.log('🔐 Submitting OTP...');
    console.log('Reference:', otpData.reference);
    
    const response = await paystackAxios.post('/transaction/submit_otp', {
      otp: otpData.otp,
      reference: otpData.reference,
    });

    if (response.data.status === true) {
      const data = response.data.data;
      
      if (data.status === 'success') {
        console.log('✅ OTP verified, payment successful');
        return {
          success: true,
          message: 'Payment successful',
          data: data,
        };
      }
      
      console.error('❌ OTP verification failed:', data.gateway_response);
      return {
        success: false,
        message: data.gateway_response || 'Invalid OTP',
        error: data,
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'OTP submission failed',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ OTP submission error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Invalid OTP',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Create dedicated virtual account for bank transfer
 */
export const createDedicatedVirtualAccount = async (accountData) => {
  try {
    console.log('🏦 Creating dedicated virtual account...');
    console.log('Using:', USE_LIVE_KEYS ? 'LIVE KEYS 🔴' : 'TEST KEYS 🟡');
    
    const response = await paystackAxios.post('/dedicated_account', {
      email: accountData.email,
      first_name: accountData.first_name,
      last_name: accountData.last_name,
      phone: accountData.phone,
      preferred_bank: accountData.preferred_bank || 'wema-bank', // or 'titan-paystack'
      metadata: accountData.metadata || {},
    });

    if (response.data.status === true) {
      const data = response.data.data;
      console.log('✅ Virtual account created:', data.account_number);
      
      return {
        success: true,
        message: 'Virtual account created',
        data: {
          accountNumber: data.account_number,
          accountName: data.account_name,
          bankName: data.bank.name,
          bankCode: data.bank.id,
          customerId: data.customer.id,
          customerCode: data.customer.customer_code,
          dedicated: true,
        },
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Failed to create virtual account',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Virtual account creation error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to create virtual account',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Create subaccount for company (for escrow payments)
 */
export const createSubaccount = async (companyData) => {
  try {
    console.log('🏦 Creating subaccount for:', companyData.businessName);
    
    const response = await paystackAxios.post('/subaccount', {
      business_name: companyData.businessName,
      settlement_bank: companyData.bankCode,
      account_number: companyData.accountNumber,
      percentage_charge: 10, // Platform takes 10%
      description: `Riderr Logistics - ${companyData.businessName}`,
      primary_contact_email: companyData.email,
      primary_contact_name: companyData.ownerName,
      primary_contact_phone: companyData.phone,
      metadata: {
        companyId: companyData.companyId,
        platform: 'riderr',
        environment: USE_LIVE_KEYS ? 'live' : 'test',
      },
    });

    if (response.data.status === true) {
      const data = response.data.data;
      console.log('✅ Subaccount created:', data.subaccount_code);
      
      return {
        success: true,
        message: 'Subaccount created successfully',
        data: {
          subaccountCode: data.subaccount_code,
          accountNumber: data.account_number,
          bankName: data.settlement_bank,
          businessName: data.business_name,
          percentageCharge: data.percentage_charge,
          active: data.active,
        },
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Failed to create subaccount',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Subaccount creation error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Subaccount creation failed',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Update subaccount
 */
export const updateSubaccount = async (subaccountCode, updateData) => {
  try {
    console.log('📝 Updating subaccount:', subaccountCode);
    
    const response = await paystackAxios.put(`/subaccount/${subaccountCode}`, {
      business_name: updateData.businessName,
      settlement_bank: updateData.bankCode,
      account_number: updateData.accountNumber,
      active: updateData.active !== undefined ? updateData.active : true,
      percentage_charge: updateData.percentageCharge || 10,
      description: updateData.description,
    });

    if (response.data.status === true) {
      console.log('✅ Subaccount updated');
      return {
        success: true,
        message: 'Subaccount updated successfully',
        data: response.data.data,
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Failed to update subaccount',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Subaccount update error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Subaccount update failed',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Get list of Nigerian banks
 */
export const getBankList = async () => {
  try {
    const response = await paystackAxios.get('/bank?currency=NGN');
    
    if (response.data.status === true) {
      return {
        success: true,
        data: response.data.data,
      };
    }
    
    return {
      success: false,
      message: 'Failed to get bank list',
    };
  } catch (error) {
    console.error('❌ Get banks error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: 'Failed to get bank list',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Resolve and verify bank account
 */
export const resolveAccountNumber = async (accountNumber, bankCode) => {
  try {
    console.log('🔍 Resolving account:', accountNumber);
    
    const response = await paystackAxios.get('/bank/resolve', {
      params: {
        account_number: accountNumber,
        bank_code: bankCode,
      },
    });

    if (response.data.status === true) {
      console.log('✅ Account resolved:', response.data.data.account_name);
      
      return {
        success: true,
        data: {
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
        },
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Account resolution failed',
    };
  } catch (error) {
    console.error('❌ Account resolution error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Account resolution failed',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Get public key for frontend
 */
export const getPublicKey = () => {
  return PAYSTACK_PUBLIC_KEY;
};

/**
 * Check if using live keys
 */
export const isUsingLiveKeys = () => {
  return USE_LIVE_KEYS;
};

/**
 * Check if in production mode
 */
export const isProduction = () => {
  return IS_PRODUCTION;
};

// Export all functions
export default {
  initializePayment,
  verifyPayment,
  chargeCardViaPaystack,
  submitOtpToPaystack,
  createDedicatedVirtualAccount,
  createSubaccount,
  updateSubaccount,
  getBankList,
  resolveAccountNumber,
  getPublicKey,
  isProduction,
  isUsingLiveKeys,
};