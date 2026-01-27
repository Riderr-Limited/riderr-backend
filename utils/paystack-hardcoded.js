// utils/paystack-hardcoded.js - MOBILE OPTIMIZED
import axios from 'axios';

// ===== HARDCODED CONFIGURATION =====
const PAYSTACK_SECRET_KEY = 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac';
const PAYSTACK_PUBLIC_KEY = 'pk_test_5240eb0402f627e4bdc37a9971c35a20ed27a0f0';
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
 */
export const initializePayment = async (paymentData) => {
  try {
    console.log('💰 Initializing payment...');
    console.log('Email:', paymentData.email);
    console.log('Amount:', paymentData.amount);
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