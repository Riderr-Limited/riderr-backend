// utils/paymentGateway.js — Flutterwave only
import {
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
} from "./flutterwave.js";

export {
  initializePayment,
  verifyPayment,
  chargeCard as gatewayChargeCard,
  submitOtp as gatewaySubmitOtp,
  submitPin as gatewaySubmitPin,
  createDedicatedVirtualAccount,
  createTransferRecipient,
  initiateTransfer,
  initiateRefund,
  getBankList,
  resolveAccountNumber,
  verifyWebhookSignature,
  getPublicKey,
};

// Keep these named exports so the controller imports don't break
export { chargeCard, submitOtp, submitPin };

export const getGatewayProvider = () => "flutterwave";

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
  getGatewayProvider,
};
