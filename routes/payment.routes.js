// routes/payment.routes.js
/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Payment processing & history
 */
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
  getPaymentForDelivery,
  verifyAccountNumber,
  getCompanyBankAccount,
  updateCompanyBankAccount,
  deleteCompanyBankAccount,
} from '../controllers/payment.controller.js';

const router = express.Router();

// ============================================================
// 1. WEBHOOK
// ============================================================
/**
 * @swagger
 * /payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Paystack webhook (public)
 *     security: []
 *     responses:
 *       200:
 *         description: Webhook received
 */
router.post('/webhook', handlePaystackWebhook);

// ============================================================
// 2. PUBLIC CALLBACKS
// ============================================================
/**
 * @swagger
 * /payments/mobile-callback:
 *   get:
 *     tags: [Payments]
 *     summary: Mobile payment callback
 *     security: []
 *     responses:
 *       200:
 *         description: Callback handled
 */
router.get('/mobile-callback', mobilePaymentCallback);

// ============================================================
// 3. CUSTOMER ROUTES
// ============================================================
/**
 * @swagger
 * /payments/initialize:
 *   post:
 *     tags: [Payments]
 *     summary: Initialize a delivery payment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deliveryId]
 *             properties:
 *               deliveryId: { type: string }
 *               paymentMethod: { type: string, enum: [card, bank_transfer] }
 *     responses:
 *       200:
 *         description: Payment initialized, returns authorization URL
 */
router.post('/initialize', authenticate, initializeDeliveryPayment);
router.post('/charge-card', authenticate, chargeCard);
router.post('/submit-otp', authenticate, submitOtp);
router.post('/submit-pin', authenticate, submitPin);
router.post('/initiate-bank-transfer', authenticate, initiateBankTransfer);
router.post('/verify-bank-transfer', authenticate, verifyBankTransferManually);

/**
 * @swagger
 * /payments/verify/{reference}:
 *   get:
 *     tags: [Payments]
 *     summary: Verify payment by reference
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment verified
 */
router.get('/verify/:reference', authenticate, verifyDeliveryPayment);
router.get('/status/:reference', authenticate, checkPaymentStatus);

/**
 * @swagger
 * /payments/my-payments:
 *   get:
 *     tags: [Payments]
 *     summary: Get my payment history
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Payment history
 */
router.get('/my-payments', authenticate, getMyPayments);

// ============================================================
// 4. COMPANY ROUTES
// ============================================================
/**
 * @swagger
 * /payments/company-payments:
 *   get:
 *     tags: [Payments]
 *     summary: Get company payments (company_admin)
 *     responses:
 *       200:
 *         description: Company payments
 */
router.get('/company-payments', authenticate, getCompanyPayments);
router.get('/company-settlements/:paymentId', authenticate, getCompanySettlementDetails);
router.get('/company-settlements/:paymentId/receipt', authenticate, downloadSettlementReceipt);
router.post('/complete-and-settle/:deliveryId', authenticate, completeAndSettlePayment);

// ============================================================
// 5. DRIVER ROUTES
// ============================================================
/**
 * @swagger
 * /payments/driver-payments:
 *   get:
 *     tags: [Payments]
 *     summary: Get driver payments
 *     responses:
 *       200:
 *         description: Driver payments
 */
router.get('/driver-payments', authenticate, getDriverPayments);
router.get('/driver-earnings', authenticate, getDriverEarningsSummary);
router.get('/driver-payments/:paymentId', authenticate, getDriverPaymentDetails);
router.post('/driver-payments/:paymentId/request-settlement', authenticate, requestCashSettlement);
router.post('/driver-payments/:paymentId/mark-settled', authenticate, markCashPaymentAsSettled);

// ============================================================
// 6. UTILITY ROUTES
// ============================================================
/**
 * @swagger
 * /payments/banks:
 *   get:
 *     tags: [Payments]
 *     summary: Get list of Nigerian banks
 *     security: []
 *     responses:
 *       200:
 *         description: Banks list
 */
router.get('/banks', getNigerianBanks);
router.get('/verify-account', authenticate, verifyAccountNumber);
router.get('/company/bank-account', authenticate, getCompanyBankAccount);
router.post('/company/setup-bank-account', authenticate, setupCompanyBankAccount);
router.put('/company/bank-account', authenticate, updateCompanyBankAccount);
router.delete('/company/bank-account', authenticate, deleteCompanyBankAccount);
router.get('/for-delivery/:deliveryId', authenticate, getPaymentForDelivery);

// ============================================================
// 7. DYNAMIC ROUTE — must be LAST
// ============================================================
/**
 * @swagger
 * /payments/{paymentId}:
 *   get:
 *     tags: [Payments]
 *     summary: Get payment details by ID
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment details
 *       404:
 *         description: Not found
 */
router.get('/:paymentId', authenticate, getPaymentDetails);



export default router;