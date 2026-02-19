// routes/payment.routes.js - FIXED: Route ordering (dynamic /:id must be LAST)
import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  initializeDeliveryPayment,
  verifyDeliveryPayment,
  handlePaystackWebhook,
  getPaymentDetails,
  getMyPayments,
  mobilePaymentCallback,
  checkPaymentStatus,
  completeAndSettlePayment,
  getCompanyPayments,
  getCompanySettlementDetails,
  downloadSettlementReceipt,
  chargeCard,
  submitOtp,
  submitPin,
  initiateBankTransfer,
  verifyBankTransferManually,
  getDriverPayments,
  getDriverPaymentDetails,
  requestCashSettlement,
  markCashPaymentAsSettled,
  getDriverEarningsSummary,
  getNigerianBanks,
  setupCompanyBankAccount,
} from '../controllers/payment.controller.js';

const router = express.Router();

// ============================================================
// 1. WEBHOOK (public, no auth — must be before everything)
// ============================================================
router.post('/webhook', handlePaystackWebhook);

// ============================================================
// 2. PUBLIC CALLBACKS
// ============================================================
router.get('/mobile-callback', mobilePaymentCallback);

// ============================================================
// 3. CUSTOMER ROUTES
// ============================================================
router.post('/initialize',           authenticate, initializeDeliveryPayment);
router.post('/charge-card',          authenticate, chargeCard);
router.post('/submit-otp',           authenticate, submitOtp);
router.post('/submit-pin',           authenticate, submitPin);
router.post('/initiate-bank-transfer', authenticate, initiateBankTransfer);
router.post('/verify-bank-transfer', authenticate, verifyBankTransferManually); // kept from controller

router.get('/verify/:reference',     authenticate, verifyDeliveryPayment);
router.get('/status/:reference',     authenticate, checkPaymentStatus);
router.get('/my-payments',           authenticate, getMyPayments);

// ============================================================
// 4. COMPANY ROUTES
// ============================================================
router.get('/company-payments',                              authenticate, getCompanyPayments);
router.get('/company-settlements/:paymentId',               authenticate, getCompanySettlementDetails);
router.get('/company-settlements/:paymentId/receipt',       authenticate, downloadSettlementReceipt);
router.post('/complete-and-settle/:deliveryId',             authenticate, completeAndSettlePayment);

// ============================================================
// 5. DRIVER ROUTES
// ============================================================
router.get('/driver-payments',                                        authenticate, getDriverPayments);
router.get('/driver-earnings',                                        authenticate, getDriverEarningsSummary);
router.get('/driver-payments/:paymentId',                             authenticate, getDriverPaymentDetails);
router.post('/driver-payments/:paymentId/request-settlement',        authenticate, requestCashSettlement);
router.post('/driver-payments/:paymentId/mark-settled',              authenticate, markCashPaymentAsSettled);

// ============================================================
// 6. DYNAMIC ROUTE — /:paymentId must ALWAYS be last
//    (otherwise it swallows the named routes above)
// ============================================================
router.get('/:paymentId', authenticate, getPaymentDetails);
router.get('/banks', getNigerianBanks); 
router.post('/company/setup-bank-account', authenticate, setupCompanyBankAccount);



export default router;