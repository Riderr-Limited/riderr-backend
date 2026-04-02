import axios from "axios";
import crypto from "crypto";

const getSecretKey = () => process.env.FLW_SECRET_KEY;
const getClientId = () => process.env.FLW_CLIENT_ID;
const getClientSecret = () => process.env.FLW_CLIENT_SECRET;
const FLW_PUBLIC_KEY = process.env.FLW_PUBLIC_KEY;
const BACKEND_URL = process.env.BACKEND_URL || "https://riderr-backend.onrender.com";
const MOBILE_CALLBACK_URL = `${BACKEND_URL}/api/payments/mobile-callback`;

// Detect which auth mode to use
const isV4 = () => !!(process.env.FLW_CLIENT_ID && process.env.FLW_CLIENT_SECRET);

if (!process.env.FLW_SECRET_KEY && !process.env.FLW_CLIENT_SECRET) {
  console.warn("⚠️  No Flutterwave credentials set — API calls will fail");
}

const flwAxios = axios.create({
  baseURL: "https://api.flutterwave.com/v3",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

// V4 token cache
let v4TokenCache = { token: null, expiresAt: 0 };

async function getV4Token() {
  if (v4TokenCache.token && Date.now() < v4TokenCache.expiresAt) {
    return v4TokenCache.token;
  }
  const res = await axios.post("https://auth.flutterwave.com/v1/token", {
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: "client_credentials",
  });
  v4TokenCache.token = res.data.data?.access_token || res.data.access_token;
  v4TokenCache.expiresAt = Date.now() + (res.data.data?.expires_in || 3600) * 1000 - 60000;
  return v4TokenCache.token;
}

flwAxios.interceptors.request.use(async (config) => {
  if (isV4()) {
    const token = await getV4Token();
    config.headers['Authorization'] = `Bearer ${token}`;
  } else {
    config.headers['Authorization'] = `Bearer ${getSecretKey()}`;
  }
  console.log(`📤 Flutterwave → ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

flwAxios.interceptors.response.use(
  (response) => {
    console.log(`📥 Flutterwave ← ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error("❌ Flutterwave error:", error.response?.data || error.message);
    return Promise.reject(error);
  },
);

// ─────────────────────────────────────────────────────────────
// PAYMENT INITIALIZATION  (returns a hosted-payment link)
// ─────────────────────────────────────────────────────────────
export const initializePayment = async (paymentData) => {
  try {
    const txRef =
      paymentData.reference ||
      `RIDERR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const response = await flwAxios.post("/payments", {
      tx_ref: txRef,
      amount: paymentData.amount,
      currency: paymentData.currency || "NGN",
      redirect_url: paymentData.callback_url || MOBILE_CALLBACK_URL,
      payment_options: paymentData.channels?.join(",") || "card,banktransfer",
      customer: {
        email: paymentData.email,
        name: (paymentData.metadata?.customerName || paymentData.customerName || "").trim(),
        phonenumber: paymentData.metadata?.customerPhone || paymentData.customerPhone || "",
      },
      meta: paymentData.metadata || {},
      customizations: {
        title: "Riderr Payment",
        logo: process.env.APP_LOGO_URL || "",
        ...paymentData.customizations,
      },
    });

    if (response.data.status === "success") {
      return {
        success: true,
        message: "Payment initialized",
        data: {
          authorization_url: response.data.data.link,
          access_code: txRef,
          reference: txRef,
          link: response.data.data.link,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || "Flutterwave initialization failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// VERIFY PAYMENT  (by tx_ref)
// ─────────────────────────────────────────────────────────────
export const verifyPayment = async (txRef) => {
  try {
    const response = await flwAxios.get(
      `/transactions/verify_by_reference?tx_ref=${txRef}`,
    );

    if (response.data.status === "success") {
      const d = response.data.data;
      // Normalise to the shape the controller expects
      return {
        success: true,
        message: "Payment verified",
        data: {
          status: d.status === "successful" ? "success" : d.status,
          amount: d.amount,
          currency: d.currency,
          reference: d.tx_ref,
          flw_ref: d.flw_ref,
          gateway_response: d.processor_response,
          channel: d.payment_type,
          authorization: {
            card_type: d.card?.type,
            bank: d.card?.issuer,
            last4: d.card?.last_4digits,
          },
          customer: d.customer,
          raw: d,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || "Verification failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// CHARGE CARD  (direct / inline charge)
// ─────────────────────────────────────────────────────────────
export const chargeCard = async (chargeData) => {
  try {
    const txRef =
      chargeData.metadata?.reference ||
      `RIDERR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const payload = {
      card_number: chargeData.card.number,
      cvv: chargeData.card.cvv,
      expiry_month: chargeData.card.expiry_month,
      expiry_year: chargeData.card.expiry_year,
      currency: chargeData.currency || "NGN",
      amount: chargeData.amount,
      email: chargeData.email,
      fullname: chargeData.metadata?.customerName || chargeData.customerName || "",
      tx_ref: txRef,
      redirect_url: chargeData.callback_url || MOBILE_CALLBACK_URL,
      meta: chargeData.metadata || {},
    };

    // Include PIN if provided (Nigerian cards)
    if (chargeData.card.pin) {
      payload.authorization = { mode: "pin", pin: chargeData.card.pin };
    }

    const response = await flwAxios.post("/charges?type=card", payload);

    if (response.data.status === "success") {
      const d = response.data.data;
      const meta = response.data.meta || {};

      // PIN required
      if (d.status === "pending" && meta.authorization?.mode === "pin") {
        return {
          success: true,
          requiresPin: true,
          message: "Card PIN required",
          paystackReference: txRef, // controller uses this field name
          data: { ...d, status: "send_pin" },
        };
      }

      // OTP / AVS required
      if (
        d.status === "pending" &&
        (meta.authorization?.mode === "otp" || meta.authorization?.mode === "avs_noauth")
      ) {
        return {
          success: true,
          requiresOtp: true,
          message: meta.authorization?.validate_instructions || "OTP sent to your phone",
          paystackReference: txRef,
          data: { ...d, status: "send_otp", flw_ref: d.flw_ref },
        };
      }

      // Immediate success
      if (d.status === "successful") {
        return {
          success: true,
          requiresOtp: false,
          message: "Payment successful",
          paystackReference: txRef,
          data: { ...d, status: "success" },
        };
      }

      return {
        success: false,
        message: d.processor_response || `Unexpected status: ${d.status}`,
        error: d,
      };
    }

    return {
      success: false,
      message: response.data.message || "Card charge failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// SUBMIT PIN
// ─────────────────────────────────────────────────────────────
export const submitPin = async (pinData) => {
  try {
    const response = await flwAxios.post("/charges?type=card", {
      authorization: { mode: "pin", pin: pinData.pin },
      flw_ref: pinData.reference,
    });

    if (response.data.status === "success") {
      const d = response.data.data;
      const meta = response.data.meta || {};

      if (
        d.status === "pending" &&
        (meta.authorization?.mode === "otp" || meta.authorization?.mode === "avs_noauth")
      ) {
        return {
          success: true,
          requiresOtp: true,
          message: "OTP sent to your phone",
          data: { ...d, status: "send_otp" },
        };
      }

      if (d.status === "successful") {
        return { success: true, message: "Payment successful", data: { ...d, status: "success" } };
      }
    }

    return {
      success: false,
      message: response.data.message || "PIN submission failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// SUBMIT OTP
// ─────────────────────────────────────────────────────────────
export const submitOtp = async (otpData) => {
  try {
    const response = await flwAxios.post("/validate-charge", {
      otp: otpData.otp,
      flw_ref: otpData.reference,
      type: "card",
    });

    if (response.data.status === "success") {
      const d = response.data.data;
      if (d.status === "successful") {
        return { success: true, message: "Payment successful", data: { ...d, status: "success" } };
      }
      return {
        success: false,
        message: d.processor_response || "OTP validation failed",
        error: d,
      };
    }

    return {
      success: false,
      message: response.data.message || "OTP validation failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// VIRTUAL ACCOUNT  (for bank-transfer payments)
// ─────────────────────────────────────────────────────────────
export const createDedicatedVirtualAccount = async (accountData) => {
  try {
    const txRef =
      accountData.metadata?.reference ||
      `RIDERR-VA-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const response = await flwAxios.post("/virtual-account-numbers", {
      email: accountData.email,
      is_permanent: false,
      bvn: accountData.bvn || process.env.PLATFORM_BVN || "",
      tx_ref: txRef,
      amount: accountData.amount || accountData.metadata?.amount,
      narration: `Riderr Payment`,
    });

    if (response.data.status === "success") {
      const d = response.data.data;
      return {
        success: true,
        data: {
          accountNumber: d.account_number,
          accountName: process.env.PLATFORM_ACCOUNT_NAME || "RIDERR TECHNOLOGIES LTD",
          bankName: d.bank_name,
          bankCode: "",
          reference: txRef,
          expiresAt: d.expiry_date,
          dedicatedAccountId: d.order_ref,
          customerCode: txRef,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || "Failed to create virtual account",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// TRANSFER RECIPIENT  (create beneficiary)
// ─────────────────────────────────────────────────────────────
export const createTransferRecipient = async ({ accountName, accountNumber, bankCode }) => {
  try {
    const response = await flwAxios.post("/beneficiaries", {
      account_bank: bankCode,
      account_number: accountNumber,
      beneficiary_name: accountName,
      currency: "NGN",
    });

    if (response.data.status === "success") {
      const d = response.data.data;
      return {
        success: true,
        data: {
          recipientCode: String(d.id), // Flutterwave uses numeric ID
          bankName: d.bank_name,
          bankCode: d.bank_code,
          accountName: d.account_name || accountName,
          accountNumber: d.account_number || accountNumber,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || "Failed to create beneficiary",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// INITIATE TRANSFER  (payout to company)
// ─────────────────────────────────────────────────────────────
export const initiateTransfer = async (transferData) => {
  try {
    const response = await flwAxios.post("/transfers", {
      account_bank: transferData.accountBank,
      account_number: transferData.accountNumber,
      amount: transferData.amount,
      narration: transferData.reason || "Riderr settlement",
      currency: "NGN",
      reference: transferData.reference,
      beneficiary_name: transferData.beneficiaryName,
      callback_url: transferData.callback_url,
    });

    if (response.data.status === "success") {
      const d = response.data.data;
      return {
        success: true,
        data: {
          transferCode: String(d.id),
          reference: d.reference,
          amount: d.amount,
          status: d.status,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || "Transfer failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// REFUND
// ─────────────────────────────────────────────────────────────
export const initiateRefund = async ({ flwRef, amount, comments }) => {
  try {
    const response = await flwAxios.post(`/transactions/${flwRef}/refund`, {
      amount,
      comments: comments || "Delivery cancelled",
    });

    if (response.data.status === "success") {
      const d = response.data.data;
      return {
        success: true,
        data: {
          refundId: String(d.id),
          amount: d.amount_refunded,
          status: d.status,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || "Refund failed",
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// GET BANK LIST
// ─────────────────────────────────────────────────────────────
export const getBankList = async () => {
  try {
    const response = await flwAxios.get("/banks/NG");

    if (response.data.status === "success") {
      return {
        success: true,
        data: response.data.data.map((b) => ({
          name: b.name,
          code: b.code,
          slug: b.name.toLowerCase().replace(/\s+/g, "-"),
          country: "Nigeria",
          currency: "NGN",
          type: "nuban",
        })),
      };
    }

    return { success: false, message: "Failed to get bank list" };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// RESOLVE ACCOUNT NUMBER
// ─────────────────────────────────────────────────────────────
export const resolveAccountNumber = async (accountNumber, bankCode) => {
  try {
    const response = await flwAxios.post("/accounts/resolve", {
      account_number: accountNumber,
      account_bank: bankCode,
    });

    if (response.data.status === "success") {
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
      message: response.data.message || "Account resolution failed",
    };
  } catch (error) {
    return {
      success: false,
      message: error.response?.data?.message || error.message,
      error: error.response?.data || error.message,
    };
  }
};

// ─────────────────────────────────────────────────────────────
// WEBHOOK SIGNATURE VERIFICATION
// Flutterwave sends verif-hash header — plain string comparison
// ─────────────────────────────────────────────────────────────
export const verifyWebhookSignature = (body, signature) => {
  if (!process.env.FLW_SECRET_HASH) {
    console.warn("⚠️  FLW_SECRET_HASH not set — skipping webhook verification");
    return true;
  }
  return signature === process.env.FLW_SECRET_HASH;
};

export const getPublicKey = () => FLW_PUBLIC_KEY;

export default {
  initializePayment,
  verifyPayment,
  chargeCard,
  submitOtp,
  submitPin,
  createDedicatedVirtualAccount,
  createTransferRecipient,
  initiateTransfer,
  initiateRefund,
  getBankList,
  resolveAccountNumber,
  verifyWebhookSignature,
  getPublicKey,
};
