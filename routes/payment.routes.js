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
  completeAndSettlePayment,
  getCompanyPayments,
   chargeCard, 
  submitOtp, 
  initiateBankTransfer, 
} from '../controllers/payment.controller.js';

const router = express.Router();

// ============ WEBHOOK ROUTES (Public - must be first) ============
router.post('/webhook', handlePaystackWebhook);

// ============ MOBILE-SPECIFIC ROUTES ============
router.get('/mobile-callback', mobilePaymentCallback);  


// ============ IN-APP PAYMENT ROUTES ✅ NEW ============
router.post('/charge-card', authenticate, chargeCard);
router.post('/submit-otp', authenticate, submitOtp);
router.post('/initiate-bank-transfer', authenticate, initiateBankTransfer);


// ============ CUSTOMER PAYMENT ROUTES ============
router.post('/initialize', authenticate, initializeDeliveryPayment);
router.get('/verify/:reference', authenticate, verifyDeliveryPayment);
router.get('/my-payments', authenticate, getMyPayments);
router.get('/status/:reference', authenticate, checkPaymentStatus);

// ============ COMPANY ROUTES (Must come before /:paymentId) ============
router.get('/company-payments', authenticate, getCompanyPayments);
router.post('/complete-and-settle/:deliveryId', authenticate, completeAndSettlePayment);

// ============ DYNAMIC ROUTES (Must be last) ============
router.get('/:paymentId', authenticate, getPaymentDetails);




export default router;