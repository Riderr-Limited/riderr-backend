// utils/paystack-hardcoded.js - MOBILE OPTIMIZED
import axios from 'axios';

// ===== HARDCODED CONFIGURATION =====
const PAYSTACK_SECRET_KEY = 'sk_live_d68be4ae85980a9c4c319edf02dc2db4aca8cbdd';
const PAYSTACK_PUBLIC_KEY = 'pk_live_3b52907c8d7a45ff0d023758e4a810bec5e2fc8a';
const FRONTEND_URL = 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const MOBILE_CALLBACK_URL = `${BACKEND_URL}/api/payments/mobile-callback`;

console.log('🔧 Using MOBILE-OPTIMIZED Paystack configuration');
console.log('Mobile Callback URL:', MOBILE_CALLBACK_URL);

const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

/**
 * Initialize payment with Paystack (Mobile & Web)
 * @param {Object} paymentData - Payment initialization data
 * @param {string} paymentData.paymentChannel - 'card' or 'bank' (user's selection)
 */
export const initializePayment = async (paymentData) => {
  try {
    console.log('💰 Initializing payment...');
    console.log('Email:', paymentData.email);
    console.log('Amount:', paymentData.amount);
    console.log('Payment Channel:', paymentData.paymentChannel || 'card'); // Default to card
    console.log('Subaccount:', paymentData.subaccount || 'None');
    console.log('Is Mobile:', paymentData.metadata?.isMobile || false);
    
    // Convert to kobo
    const amountInKobo = Math.round(paymentData.amount * 100);
    
    // Build request payload
    const payload = {
      email: paymentData.email,
      amount: amountInKobo,
      currency: 'NGN',
      metadata: paymentData.metadata || {},
      reference: paymentData.reference || `RIDERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      // ✅ LIMIT PAYMENT CHANNELS TO CARD AND BANK TRANSFER ONLY
      channels: paymentData.paymentChannel 
        ? [paymentData.paymentChannel] // Use user's selection
        : ['card', 'bank'], // Default: show both options
    };

    // Set callback URL
    if (paymentData.metadata?.isMobile) {
      payload.callback_url = MOBILE_CALLBACK_URL;
    } else {
      payload.callback_url = paymentData.callback_url || `${FRONTEND_URL}/payment/verify`;
    }

    // Add split payment details if subaccount is provided
    if (paymentData.subaccount) {
      payload.subaccount = paymentData.subaccount;
      
      // Set platform fee
      if (paymentData.transaction_charge) {
        payload.transaction_charge = Math.round(paymentData.transaction_charge * 100);
      }
      
      // Set who bears the transaction fee
      payload.bearer = paymentData.bearer || 'account';
      
      console.log('🏦 ESCROW MODE: Payment will split to subaccount');
    }
    
    console.log('📋 Payment channels:', payload.channels);
    
    // Make the request
    const response = await paystackAxios.post('/transaction/initialize', payload);

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
    console.error('❌ Paystack initialization error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment initialization failed',
      error: error.response?.data,
    };
  }
};

// utils/paystack-hardcoded.js - ADD THESE FUNCTIONS

/**
 * Charge card directly via Paystack
 */
export const chargeCardViaPaystack = async (chargeData) => {
  try {
    console.log('💳 Charging card via Paystack...');
    
    const amountInKobo = Math.round(chargeData.amount * 100);
    
    const payload = {
      email: chargeData.email,
      amount: amountInKobo,
      card: {
        number: chargeData.cardDetails.number,
        cvv: chargeData.cardDetails.cvv,
        expiry_month: chargeData.cardDetails.expiry_month,
        expiry_year: chargeData.cardDetails.expiry_year,
      },
      metadata: chargeData.metadata || {},
      reference: chargeData.reference,
    };

    const response = await paystackAxios.post('/transaction/charge', payload);

    if (response.data.status === true) {
      const data = response.data.data;
      
      // Check if OTP is required
      if (data.status === 'send_otp' || data.status === 'pending') {
        return {
          success: true,
          requiresOtp: true,
          message: 'OTP required',
          otpReference: data.reference,
          displayMessage: data.display_text || 'Please enter the OTP sent to your phone',
          data: data,
        };
      }
      
      // Payment successful
      if (data.status === 'success') {
        return {
          success: true,
          requiresOtp: false,
          message: 'Payment successful',
          data: data,
        };
      }
      
      // Payment failed
      return {
        success: false,
        message: data.gateway_response || 'Payment failed',
        error: data,
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Charge failed',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Charge card error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Card charge failed',
      error: error.response?.data,
    };
  }
};

/**
 * Submit OTP for pending charge
 */
export const submitOtpToPaystack = async (otpData) => {
  try {
    console.log('🔐 Submitting OTP to Paystack...');
    
    const payload = {
      otp: otpData.otp,
      reference: otpData.reference,
    };

    const response = await paystackAxios.post('/transaction/submit_otp', payload);

    if (response.data.status === true) {
      const data = response.data.data;
      
      if (data.status === 'success') {
        return {
          success: true,
          message: 'Payment successful',
          data: data,
        };
      }
      
      return {
        success: false,
        message: data.gateway_response || 'OTP verification failed',
        error: data,
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'OTP submission failed',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Submit OTP error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Invalid OTP',
      error: error.response?.data,
    };
  }
};

/**
 * Create dedicated virtual account for bank transfer
 */
export const createDedicatedVirtualAccount = async (accountData) => {
  try {
    console.log('🏦 Creating dedicated virtual account...');
    
    const amountInKobo = Math.round(accountData.amount * 100);
    
    const payload = {
      email: accountData.email,
      amount: amountInKobo,
      currency: 'NGN',
      preferred_bank: 'wema-bank', // You can make this configurable
      reference: accountData.reference,
    };

    const response = await paystackAxios.post('/dedicated_account', payload);

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
          reference: data.reference,
          amount: accountData.amount,
          expiresAt: data.expires_at,
        },
      };
    }
    
    return {
      success: false,
      message: response.data.message || 'Failed to create virtual account',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Create virtual account error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to create virtual account',
      error: error.response?.data,
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
      // Log split payment details if available
      if (response.data.data.subaccount) {
        console.log('💰 Split Payment Details:');
        console.log('Subaccount Amount:', response.data.data.subaccount.amount / 100, 'NGN');
        console.log('Platform Fees:', response.data.data.fees / 100, 'NGN');
      }
      
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
    console.error('❌ Verification error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Payment verification failed',
      error: error.response?.data,
    };
  }
};

/**
 * Create a subaccount for a company
 */
export const createSubaccount = async (companyData) => {
  try {
    console.log('🏦 Creating Paystack subaccount for company:', companyData.businessName);
    
    const response = await paystackAxios.post('/subaccount', {
      business_name: companyData.businessName,
      settlement_bank: companyData.bankCode,
      account_number: companyData.accountNumber,
      percentage_charge: 10,
      description: `Subaccount for ${companyData.businessName}`,
      primary_contact_email: companyData.email,
      primary_contact_name: companyData.ownerName,
      primary_contact_phone: companyData.phone,
      metadata: {
        companyId: companyData.companyId,
        platform: 'riderr-app',
      },
    });

    if (response.data.status === true) {
      console.log('✅ Subaccount created:', response.data.data.subaccount_code);
      return {
        success: true,
        message: 'Subaccount created successfully',
        data: {
          subaccountCode: response.data.data.subaccount_code,
          accountNumber: response.data.data.account_number,
          bankName: response.data.data.settlement_bank,
          businessName: response.data.data.business_name,
          active: response.data.data.active,
        },
      };
    } else {
      return {
        success: false,
        message: response.data.message || 'Failed to create subaccount',
        error: response.data,
      };
    }
  } catch (error) {
    console.error('❌ Create subaccount error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Subaccount creation failed',
      error: error.response?.data,
    };
  }
};

/**
 * Get list of banks
 */
export const getBankList = async () => {
  try {
    const response = await paystackAxios.get('/bank');
    
    if (response.data.status === true) {
      return {
        success: true,
        data: response.data.data,
      };
    } else {
      return {
        success: false,
        message: 'Failed to get bank list',
      };
    }
  } catch (error) {
    console.error('❌ Get banks error:', error.response?.data || error.message);
    return {
      success: false,
      message: 'Failed to get bank list',
      error: error.response?.data,
    };
  }
};

/**
 * Resolve account number
 */
export const resolveAccountNumber = async (accountNumber, bankCode) => {
  try {
    console.log('🔍 Resolving account:', accountNumber, 'Bank:', bankCode);
    
    const response = await paystackAxios.get('/bank/resolve', {
      params: {
        account_number: accountNumber,
        bank_code: bankCode,
      },
    });

    if (response.data.status === true) {
      return {
        success: true,
        data: {
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
        },
      };
    } else {
      return {
        success: false,
        message: response.data.message || 'Account resolution failed',
      };
    }
  } catch (error) {
    console.error('❌ Resolve account error:', error.response?.data || error.message);
    
    return {
      success: false,
      message: error.response?.data?.message || 'Account resolution failed',
      error: error.response?.data,
    };
  }
};

export default {
  initializePayment,
  verifyPayment,
  createSubaccount,
  getBankList,
  resolveAccountNumber,
};