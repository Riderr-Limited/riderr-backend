// routes/payment.routes.js
//import express from 'express';
//import authenticate from '../middlewares/authenticate.js';
//import authorize from '../middlewares/authorize.js';
//import {
//  initializePayment,
//  handlePaymentWebhook,
//  verifyPayment,
//  releaseEscrowFunds,
//  refundEscrowFunds,
//  raiseDispute,
//  resolveDispute,
//  getPaymentDetails,
//  getMyPayments,
//  createTransferRecipient,
//  getPaymentStats,
//  getCustomerPayments,
//  getDriverPayments,
// // getCompanyPayments,
// // cancelPayment,
//  getPaymentHistory,
//  getDisputes
//} from '../controllers/payment.controller.js';
//import verifyPaystackWebhook from '../middlewares/verifyPaysackWebhook.js';
//
//
//const router = express.Router();
//
//router.post('/webhook', verifyPaystackWebhook, handlePaymentWebhook);
//
//
//// ===== CUSTOMER ROUTES =====
//router.post('/initialize', authenticate, authorize(['customer']), initializePayment);
//router.get('/my', authenticate, authorize(['customer']), getMyPayments);
//router.get('/customer/history', authenticate, authorize(['customer']), getPaymentHistory);
//router.post('/:paymentId/dispute', authenticate, authorize(['customer']), raiseDispute);
////router.post('/:paymentId/cancel', authenticate, authorize(['customer']), cancelPayment);
//
//// ===== DRIVER/RIDER ROUTES =====
//router.post('/transfer-recipient', authenticate, authorize(['driver', 'rider']), createTransferRecipient);
//router.get('/driver/my', authenticate, authorize(['driver', 'rider']), getDriverPayments);
//router.post('/:paymentId/dispute', authenticate, authorize(['driver', 'rider']), raiseDispute);
//
//// ===== COMPANY ADMIN ROUTES =====
//router.get('/company/:companyId', authenticate, authorize(['company_admin']), getCompanyPayments);
//router.post('/:paymentId/release', authenticate, authorize(['company_admin']), releaseEscrowFunds);
//router.post('/:paymentId/refund', authenticate, authorize(['company_admin']), refundEscrowFunds);
//
//// ===== ADMIN ROUTES =====
//router.get('/admin/stats', authenticate, authorize(['admin']), getPaymentStats);
//router.get('/admin/disputes', authenticate, authorize(['admin']), getDisputes);
//router.get('/admin/all', authenticate, authorize(['admin']), getCustomerPayments);
//router.post('/:paymentId/release', authenticate, authorize(['admin']), releaseEscrowFunds);
//router.post('/:paymentId/refund', authenticate, authorize(['admin']), refundEscrowFunds);
//router.post('/:paymentId/dispute/resolve', authenticate, authorize(['admin']), resolveDispute);
//
//// ===== SHARED ROUTES (All authenticated users) =====
//router.get('/verify/:reference', authenticate, verifyPayment);
////router.get('/:paymentId', authenticate, getPaymentDetails);
//
//export default router;