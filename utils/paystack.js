// utils/paystack.js - FORCE LIVE MODE
import axios from 'axios';

// ===== FORCE LIVE MODE FOR TESTING =====
const IS_PRODUCTION = true; // ✅ FORCE PRODUCTION MODE
// OR
// process.env.NODE_ENV = 'production'; // Uncomment to force

// Live Keys ONLY
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY_LIVE || 'sk_live_d68be4ae85980a9c4c319edf02dc2db4aca8cbdd';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY_LIVE || 'pk_live_3b52907c8d7a45ff0d023758e4a810bec5e2fc8a';

// URLs - MUST use HTTPS (Paystack requirement for live)
const BACKEND_URL = process.env.BACKEND_URL || 'https://riderr-backend.onrender.com';
const MOBILE_CALLBACK_URL = `${BACKEND_URL}/api/payments/mobile-callback`;

console.log('🔴🔴🔴 LIVE MODE FORCED - REAL MONEY 🔴🔴🔴');
console.log('Environment: PRODUCTION (LIVE KEYS)');
console.log('Secret Key:', PAYSTACK_SECRET_KEY.substring(0, 10) + '...');
console.log('⚠️  WARNING: This will charge REAL bank cards!');

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
  if (!IS_PRODUCTION) {
    console.log('📤 Paystack Request:', config.method?.toUpperCase(), config.url);
  }
  return config;
}, (error) => {
  console.error('❌ Request Error:', error);
  return Promise.reject(error);
});

// Add response interceptor for logging
paystackAxios.interceptors.response.use((response) => {
  if (!IS_PRODUCTION) {
    console.log('📥 Paystack Response:', response.status, response.config.url);
  }
  return response;
}, (error) => {
  console.error('❌ Response Error:', error.response?.status, error.response?.data);
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
    console.log('Environment:', IS_PRODUCTION ? 'LIVE' : 'TEST');
    
    // Convert to kobo (Paystack uses kobo, not naira)
    const amountInKobo = Math.round(paymentData.amount * 100);
    
    // Build payload
    const payload = {
      email: paymentData.email,
      amount: amountInKobo,
      currency: 'NGN',
      metadata: {
        ...paymentData.metadata,
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
    
    // Make request to Paystack
    const response = await paystackAxios.post('/transaction/initialize', payload);

    if (response.data.status === true) {
      console.log('✅ Payment initialized successfully');
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
    });
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment initialization failed',
      error: error.response?.data || error.message,
    };
  }
};

/**
 * Verify payment with Paystack
 */
export const verifyPayment = async (reference) => {
  try {
    console.log('🔍 Verifying payment:', reference);
    
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
    
    const payload = {
      email: chargeData.email,
      amount: Math.round(chargeData.amount * 100), // Convert to kobo
      card: {
        number: chargeData.card.number,
        cvv: chargeData.card.cvv,
        expiry_month: chargeData.card.expiry_month,
        expiry_year: chargeData.card.expiry_year,
      },
      metadata: chargeData.metadata || {},
    };

    // Add PIN if provided (for Nigerian cards)
    if (chargeData.card.pin) {
      payload.pin = chargeData.card.pin;
    }

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
    console.error('❌ Card charge error:', error.response?.data || error.message);
    
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
        environment: IS_PRODUCTION ? 'production' : 'development',
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
};