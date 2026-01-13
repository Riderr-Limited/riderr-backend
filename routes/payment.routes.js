import express from 'express';
import authenticate from '../middlewares/authenticate.js';
import authorize from '../middlewares/authorize.js';
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
  getPaymentStats,
  getCustomerPayments,
  getDriverPayments,
  getCompanyPayments,
  getPaymentHistory,
  getDisputes,
  // Test endpoints
  testInitializePayment,
  testWebhookSimulation
} from '../controllers/payment.controller.js';
import verifyPaystackWebhook from '../middlewares/verifyPaystackWebhook.js';

const router = express.Router();

// ===== PAYSTACK WEBHOOK =====
router.post('/webhook', verifyPaystackWebhook, handlePaymentWebhook);

// ===== CUSTOMER ROUTES =====
router.post('/initialize', authenticate, authorize(['customer']), initializePayment);
router.get('/my', authenticate, authorize(['customer']), getMyPayments);
router.get('/customer/history', authenticate, authorize(['customer']), getPaymentHistory);
router.post('/:paymentId/dispute', authenticate, authorize(['customer']), raiseDispute);

// ===== DRIVER/RIDER ROUTES =====
router.get('/driver/my', authenticate, authorize(['driver', 'rider']), getDriverPayments);
router.post('/:paymentId/dispute', authenticate, authorize(['driver', 'rider']), raiseDispute);

// ===== COMPANY ADMIN ROUTES =====
router.get('/company/:companyId', authenticate, authorize(['company_admin']), getCompanyPayments);
router.post('/:paymentId/release', authenticate, authorize(['company_admin']), releaseEscrowFunds);
router.post('/:paymentId/refund', authenticate, authorize(['company_admin']), refundEscrowFunds);

// ===== ADMIN ROUTES =====
router.get('/admin/stats', authenticate, authorize(['admin']), getPaymentStats);
router.get('/admin/disputes', authenticate, authorize(['admin']), getDisputes);
router.get('/admin/all', authenticate, authorize(['admin']), getCustomerPayments);
router.post('/:paymentId/dispute/resolve', authenticate, authorize(['admin']), resolveDispute);

// ===== TESTING ENDPOINTS (Only in development) =====
if (process.env.NODE_ENV === 'development') {
  router.post('/test/initialize', authenticate, authorize(['customer']), testInitializePayment);
  router.post('/test/webhook-simulate', authenticate, authorize(['admin']), testWebhookSimulation);
}

// ===== SHARED ROUTES =====
router.get('/verify/:reference', authenticate, verifyPayment);
router.get('/:paymentId', authenticate, getPaymentDetails);

export default router;