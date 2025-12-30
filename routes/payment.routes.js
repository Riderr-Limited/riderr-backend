// routes/payment.routes.js
import express from 'express';
import authenticate from '../middlewares/authenticate.js';
import {
  initializePayment,
  handlePaymentWebhook,
  verifyPayment,
  releaseEscrowFunds,
  refundEscrowFunds,
  raiseDispute,
  resolveDispute,
  getPaymentDetails,
  getMyPayments,
  createTransferRecipient
} from '../controllers/payment.controller.js';

const router = express.Router();

// Public webhook (no authentication for Paystack)
router.post('/webhook', handlePaymentWebhook);

// Customer routes
router.post('/initialize', authenticate, initializePayment);
router.get('/my', authenticate, getMyPayments);

// Delivery person routes
router.post('/transfer-recipient', authenticate, createTransferRecipient);

// Shared routes
router.get('/verify/:reference', authenticate, verifyPayment);
router.get('/:paymentId', authenticate, getPaymentDetails);
router.post('/:paymentId/dispute', authenticate, raiseDispute);

// Admin/Company admin routes
router.post('/:paymentId/release', authenticate, releaseEscrowFunds);
router.post('/:paymentId/refund', authenticate, refundEscrowFunds);
router.post('/:paymentId/dispute/resolve', authenticate, resolveDispute);

export default router;