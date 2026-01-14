import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  initializeDeliveryPayment,
  verifyDeliveryPayment,
  handlePaystackWebhook,
  getPaymentDetails,
  getMyPayments,
} from '../controllers/payment.controller.js';

const router = express.Router();

// ============ CUSTOMER PAYMENT ROUTES ============
router.post('/initialize', authenticate, initializeDeliveryPayment);
router.get('/verify/:reference', authenticate, verifyDeliveryPayment);
router.get('/my-payments', authenticate, getMyPayments);
router.get('/:paymentId', authenticate, getPaymentDetails);

// ============ WEBHOOK ROUTES (No authentication) ============
router.post('/webhook', handlePaystackWebhook);

export default router;
