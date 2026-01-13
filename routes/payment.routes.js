// routes/payment.routes.js - SIMPLIFIED VERSION
import express from 'express';
import authenticate from '../middlewares/authenticate.js';
import authorize from '../middlewares/authorize.js';
import {
  // Available functions from your controller
  testPaystackConnection,
  initializePayment,
  verifyPayment,
  handlePaymentWebhook,
  getPaymentDetails,
  getMyPayments,
  getDriverPayments,
  getCompanyPayments,
  getPaymentStats,
  getPaymentHistory,
  checkPaystackConfig,
  // Placeholder functions (will be implemented later)
  releaseEscrowFunds,
  refundEscrowFunds,
  raiseDispute,
  resolveDispute,
  getCustomerPayments,
  getDisputes
} from '../controllers/payment.controller.js';
import verifyPaystackWebhook from '../middlewares/verifyPaysackWebhook.js';

const router = express.Router();

// ===== PUBLIC ROUTES =====
router.post('/webhook', verifyPaystackWebhook, handlePaymentWebhook);

// ===== CUSTOMER ROUTES =====
router.post('/initialize', authenticate, authorize(['customer']), initializePayment);
router.get('/my', authenticate, authorize(['customer']), getMyPayments);
router.get('/customer/history', authenticate, authorize(['customer']), getPaymentHistory);
router.get('/verify/:reference', authenticate, verifyPayment);
router.post('/:paymentId/customer/dispute', authenticate, authorize(['customer']), raiseDispute);

// ===== DRIVER ROUTES =====
router.get('/driver/my', authenticate, authorize(['driver', 'rider']), getDriverPayments);
router.post('/:paymentId/driver/dispute', authenticate, authorize(['driver', 'rider']), raiseDispute);

// ===== COMPANY ADMIN ROUTES =====
router.get('/company/:companyId', authenticate, authorize(['company_admin']), getCompanyPayments);
router.post('/:paymentId/release', authenticate, authorize(['company_admin']), releaseEscrowFunds);
router.post('/:paymentId/refund', authenticate, authorize(['company_admin']), refundEscrowFunds);
router.get('/check-config', authenticate, checkPaystackConfig);
// ===== ADMIN ROUTES =====
router.get('/admin/stats', authenticate, authorize(['admin']), getPaymentStats);
router.get('/admin/disputes', authenticate, authorize(['admin']), getDisputes);
router.get('/admin/all', authenticate, authorize(['admin']), getCustomerPayments);
router.post('/:paymentId/dispute/resolve', authenticate, authorize(['admin']), resolveDispute);
router.get('/test-connection', authenticate, authorize(['admin']), testPaystackConnection);

// ===== SHARED ROUTES =====
router.get('/:paymentId', authenticate, getPaymentDetails);

export default router;