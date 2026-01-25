// routes/payment.routes.js
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
} from '../controllers/payment.controller.js';

const router = express.Router();

// ============ CUSTOMER PAYMENT ROUTES ============
router.post('/initialize', authenticate, initializeDeliveryPayment);
router.get('/verify/:reference', authenticate, verifyDeliveryPayment);
router.get('/my-payments', authenticate, getMyPayments);
router.get('/:paymentId', authenticate, getPaymentDetails);

// ============ MOBILE-SPECIFIC ROUTES ============
router.get('/mobile-callback', mobilePaymentCallback);  
router.get('/status/:reference', authenticate, checkPaymentStatus);

// ============ WEBHOOK ROUTES ============
router.post('/webhook', handlePaystackWebhook);

export default router;