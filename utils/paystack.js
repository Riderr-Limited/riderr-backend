// utils/paystack.js - FIXED: Correct Paystack API endpoints
import axios from 'axios';

// ===== ENVIRONMENT CONFIGURATION =====
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Keys — env vars take priority, hardcoded values are fallback
const LIVE_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_d68be4ae85980a9c4c319edf02dc2db4aca8cbdd';
const LIVE_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || 'pk_live_3b52907c8d7a45ff0d023758e4a810bec5e2fc8a';
const TEST_SECRET_KEY = process.env.PAYSTACK_TEST_SECRET_KEY || 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac';
const TEST_PUBLIC_KEY = process.env.PAYSTACK_TEST_PUBLIC_KEY || 'pk_test_5240eb0402f627e4bdc37a9971c35a20ed27a0f0';

// Always use live keys
const PAYSTACK_SECRET_KEY = LIVE_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = LIVE_PUBLIC_KEY;
const USE_LIVE_KEYS = true;

// ✅ FIX: BACKEND_URL must NOT include /api — it's appended in MOBILE_CALLBACK_URL
const BACKEND_URL = process.env.BACKEND_URL || 'https://riderr-backend.onrender.com';
const MOBILE_CALLBACK_URL = `${BACKEND_URL}/api/payments/mobile-callback`;

// Log config on startup
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔧 Paystack Configuration:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Environment    :', IS_PRODUCTION ? '🔴 PRODUCTION' : '🟡 DEVELOPMENT');
console.log('Using Keys     :', USE_LIVE_KEYS ? '🔴 LIVE KEYS' : '🟡 TEST KEYS');
console.log('Secret Key     :', PAYSTACK_SECRET_KEY.substring(0, 15) + '...' + PAYSTACK_SECRET_KEY.slice(-4));
console.log('Public Key     :', PAYSTACK_PUBLIC_KEY.substring(0, 15) + '...' + PAYSTACK_PUBLIC_KEY.slice(-4));
console.log('Callback URL   :', MOBILE_CALLBACK_URL);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Validate key format
if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY.length < 20) {
  throw new Error('❌ PAYSTACK_SECRET_KEY is missing or too short');
}
if (!PAYSTACK_SECRET_KEY.startsWith('sk_')) {
  throw new Error('❌ PAYSTACK_SECRET_KEY must start with "sk_"');
}

// Axios instance pointed at Paystack's real API
const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request logger
paystackAxios.interceptors.request.use(
  (config) => {
    console.log(`📤 Paystack → ${config.method?.toUpperCase()} ${config.url}`);
    console.log('   Auth prefix:', config.headers.Authorization.substring(0, 25) + '...');
    return config;
  },
  (error) => {
    console.error('❌ Paystack request setup error:', error.message);
    return Promise.reject(error);
  }
);

// Response logger
paystackAxios.interceptors.response.use(
  (response) => {
    console.log(`📥 Paystack ← ${response.status} ${response.config.url} | status: ${response.data.status}`);
    return response;
  },
  (error) => {
    console.error(`❌ Paystack error: ${error.response?.status} ${error.config?.url}`);
    if (error.response?.data) {
      console.error('   Details:', JSON.stringify(error.response.data, null, 2));
    }
    return Promise.reject(error);
  }
);


/**
 * Initialize a payment transaction
 * Correct endpoint: POST /transaction/initialize
 */
export const initializePayment = async (paymentData) => {
  try {
    const amountInKobo = Math.round(paymentData.amount * 100);

    const payload = {
      email: paymentData.email,
      amount: amountInKobo,
      currency: 'NGN',
      reference: paymentData.reference || `RIDERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      callback_url: paymentData.callback_url || MOBILE_CALLBACK_URL,
      channels: paymentData.channels || ['card', 'bank', 'ussd', 'qr'],
      metadata: {
        ...paymentData.metadata,
        environment: USE_LIVE_KEYS ? 'live' : 'test',
      },
    };

    if (paymentData.subaccount) {
      payload.subaccount = paymentData.subaccount;
      payload.bearer = paymentData.bearer || 'account';
      if (paymentData.transaction_charge) {
        payload.transaction_charge = Math.round(paymentData.transaction_charge * 100);
      }
    }

    // ✅ CORRECT endpoint
    const response = await paystackAxios.post('/transaction/initialize', payload);

    if (response.data.status === true) {
      return { success: true, message: 'Payment initialized', data: response.data.data };
    }
    return { success: false, message: response.data.message || 'Initialization failed', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Payment initialization failed',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Verify a payment by reference
 * Correct endpoint: GET /transaction/verify/:reference
 */
export const verifyPayment = async (reference) => {
  try {
    // ✅ CORRECT endpoint (was wrongly set to /payments/verify/:reference)
    const response = await paystackAxios.get(`/transaction/verify/${reference}`);

    if (response.data.status === true) {
      return { success: true, message: 'Payment verified', data: response.data.data };
    }
    return { success: false, message: response.data.message || 'Verification failed', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Payment verification failed',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Charge a card directly (in-app)
 * Correct endpoint: POST /charge  (NOT /transaction/charge, NOT /payments/charge-card)
 */
export const chargeCardViaPaystack = async (chargeData) => {
  try {
    console.log('💳 Charging card | email:', chargeData.email, '| amount:', chargeData.amount, 'NGN');

    const payload = {
      email: chargeData.email,
      amount: Math.round(chargeData.amount * 100), // kobo
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

    // PIN is sent at the top level, not inside card object
    if (chargeData.card.pin) {
      payload.pin = chargeData.card.pin;
      console.log('🔐 PIN included');
    }

    // ✅ CORRECT endpoint (was wrongly set to /payments/charge-card)
    const response = await paystackAxios.post('/charge', payload);

    if (response.data.status === true) {
      const data = response.data.data;

      if (data.status === 'send_otp') {
        return { success: true, requiresOtp: true, message: 'OTP sent to your phone', data };
      }
      if (data.status === 'send_pin') {
        return { success: true, requiresPin: true, message: 'Card PIN required', data };
      }
      if (data.status === 'success') {
        return { success: true, requiresOtp: false, message: 'Payment successful', data };
      }

      // Unexpected status
      return { success: false, message: data.gateway_response || `Unexpected status: ${data.status}`, error: data };
    }

    return { success: false, message: response.data.message || 'Card charge failed', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Card charge failed',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Submit OTP for a pending charge
 * Correct endpoint: POST /charge/submit_otp
 */
export const submitOtpToPaystack = async (otpData) => {
  try {
    // ✅ CORRECT endpoint (was /transaction/submit_otp)
    const response = await paystackAxios.post('/charge/submit_otp', {
      otp: otpData.otp,
      reference: otpData.reference,
    });

    if (response.data.status === true) {
      const data = response.data.data;
      if (data.status === 'success') {
        return { success: true, message: 'Payment successful', data };
      }
      return { success: false, message: data.gateway_response || 'Invalid OTP', error: data };
    }

    return { success: false, message: response.data.message || 'OTP submission failed', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Invalid OTP',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Submit PIN for a pending charge
 * Correct endpoint: POST /charge/submit_pin
 */
export const submitPinToPaystack = async (pinData) => {
  try {
    const response = await paystackAxios.post('/charge/submit_pin', {
      pin: pinData.pin,
      reference: pinData.reference,
    });

    if (response.data.status === true) {
      const data = response.data.data;
      if (data.status === 'send_otp') {
        return { success: true, requiresOtp: true, message: 'OTP sent to your phone', data };
      }
      if (data.status === 'success') {
        return { success: true, message: 'Payment successful', data };
      }
      return { success: false, message: data.gateway_response || `Status: ${data.status}`, error: data };
    }

    return { success: false, message: response.data.message || 'PIN submission failed', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'PIN submission failed',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Create a dedicated virtual account for bank transfers
 * Correct endpoint: POST /dedicated_account
 */
export const createDedicatedVirtualAccount = async (accountData) => {
  try {
    const response = await paystackAxios.post('/dedicated_account', {
      email: accountData.email,
      first_name: accountData.first_name,
      last_name: accountData.last_name,
      phone: accountData.phone,
      preferred_bank: accountData.preferred_bank || 'wema-bank',
      metadata: accountData.metadata || {},
    });

    if (response.data.status === true) {
      const data = response.data.data;
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

    return { success: false, message: response.data.message || 'Failed to create virtual account', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to create virtual account',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Create a subaccount for a company
 * Correct endpoint: POST /subaccount
 */
export const createSubaccount = async (companyData) => {
  try {
    const response = await paystackAxios.post('/subaccount', {
      business_name: companyData.businessName,
      settlement_bank: companyData.bankCode,
      account_number: companyData.accountNumber,
      percentage_charge: 10,
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

    return { success: false, message: response.data.message || 'Failed to create subaccount', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Subaccount creation failed',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Update a subaccount
 * Correct endpoint: PUT /subaccount/:code
 */
export const updateSubaccount = async (subaccountCode, updateData) => {
  try {
    const response = await paystackAxios.put(`/subaccount/${subaccountCode}`, {
      business_name: updateData.businessName,
      settlement_bank: updateData.bankCode,
      account_number: updateData.accountNumber,
      active: updateData.active !== undefined ? updateData.active : true,
      percentage_charge: updateData.percentageCharge || 10,
      description: updateData.description,
    });

    if (response.data.status === true) {
      return { success: true, message: 'Subaccount updated', data: response.data.data };
    }
    return { success: false, message: response.data.message || 'Failed to update subaccount', error: response.data };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Subaccount update failed',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Get list of Nigerian banks
 * Correct endpoint: GET /bank?currency=NGN
 */
export const getBankList = async () => {
  try {
    const response = await paystackAxios.get('/bank?currency=NGN');
    if (response.data.status === true) {
      return { success: true, data: response.data.data };
    }
    return { success: false, message: 'Failed to get bank list' };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to get bank list',
      error: error.response?.data || error.message,
    };
  }
};


/**
 * Resolve / verify a bank account number
 * Correct endpoint: GET /bank/resolve
 */
export const resolveAccountNumber = async (accountNumber, bankCode) => {
  try {
    const response = await paystackAxios.get('/bank/resolve', {
      params: { account_number: accountNumber, bank_code: bankCode },
    });

    if (response.data.status === true) {
      return {
        success: true,
        data: {
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
        },
      };
    }
    return { success: false, message: response.data.message || 'Account resolution failed' };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || 'Account resolution failed',
      error: error.response?.data || error.message,
    };
  }
};


// Helpers
export const getPublicKey = () => PAYSTACK_PUBLIC_KEY;
export const isUsingLiveKeys = () => USE_LIVE_KEYS;
export const isProduction = () => IS_PRODUCTION;

export default {
  initializePayment,
  verifyPayment,
  chargeCardViaPaystack,
  submitOtpToPaystack,
  submitPinToPaystack,
  createDedicatedVirtualAccount,
  createSubaccount,
  updateSubaccount,
  getBankList,
  resolveAccountNumber,
  getPublicKey,
  isProduction,
  isUsingLiveKeys,
};