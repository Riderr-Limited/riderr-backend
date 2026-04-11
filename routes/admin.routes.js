/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin-only management endpoints
 */
import express from "express";
import {
  // Dashboard & Analytics
  getDashboardOverview,
  getPlatformAnalytics,

  // User Management
  getAllUsers,
  getUserById,
  updateUser,
  suspendUser,
  deleteUser,
  resetUserPassword,

  // Driver Management
  getAllDrivers,
  getDriverById,
  updateDriver,
  approveDriver,
  deleteDriver,

  // Company Management
  getAllCompanies,
  getCompanyById,
  updateCompany,
  approveCompany,
  approveBankDetails,
  deleteCompany,

  // Delivery Management
  getAllDeliveries,
  getDeliveryById,
  updateDeliveryStatus,
  assignDriver,
  deleteDelivery,

  // Payment Management
  getAllPayments,
  getPaymentById,
  issueRefund,

  // Support Ticket Management
  getAllSupportTickets,
  getSupportTicketById,
  updateSupportTicket,

  // System Configuration
  getSystemStats,
  sendBulkNotification,
  exportData,
} from "../controllers/admin.controller.js";

// Import middleware - using correct function names from auth.middleware.js
import { protect, authorize } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(protect); // Authenticate user (protect is an alias for authenticate)
router.use(authorize("admin")); // Only admins can access these routes

/**
 * ========================================
 * DASHBOARD & ANALYTICS ROUTES
 * ========================================
 */

// GET /api/admin/dashboard
/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Get dashboard overview
 *     responses:
 *       200:
 *         description: Dashboard data
 */
router.get("/dashboard", getDashboardOverview);

/**
 * @swagger
 * /admin/analytics:
 *   get:
 *     tags: [Admin]
 *     summary: Get platform analytics
 *     responses:
 *       200:
 *         description: Analytics data
 */
router.get("/analytics", getPlatformAnalytics);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Get all users
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [customer, driver, company_admin, admin] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Users list
 */
router.get("/users", getAllUsers);
router.get("/users/:userId", getUserById);
router.put("/users/:userId", updateUser);
router.put("/users/:userId/suspend", suspendUser);
router.delete("/users/:userId", deleteUser);
router.post("/users/:userId/reset-password", resetUserPassword);

/**
 * @swagger
 * /admin/drivers:
 *   get:
 *     tags: [Admin]
 *     summary: Get all drivers
 *     responses:
 *       200:
 *         description: Drivers list
 */
router.get("/drivers", getAllDrivers);
router.get("/drivers/:driverId", getDriverById);
router.put("/drivers/:driverId", updateDriver);
router.put("/drivers/:driverId/approve", approveDriver);
router.delete("/drivers/:driverId", deleteDriver);

/**
 * @swagger
 * /admin/companies:
 *   get:
 *     tags: [Admin]
 *     summary: Get all companies
 *     responses:
 *       200:
 *         description: Companies list
 */
router.get("/companies", getAllCompanies);
router.get("/companies/:companyId", getCompanyById);
router.put("/companies/:companyId", updateCompany);
router.put("/companies/:companyId/approve", approveCompany);
router.put("/companies/:companyId/bank-details/approve", approveBankDetails);
router.delete("/companies/:companyId", deleteCompany);

/**
 * @swagger
 * /admin/deliveries:
 *   get:
 *     tags: [Admin]
 *     summary: Get all deliveries
 *     responses:
 *       200:
 *         description: Deliveries list
 */
router.get("/deliveries", getAllDeliveries);
router.get("/deliveries/:deliveryId", getDeliveryById);
router.put("/deliveries/:deliveryId/status", updateDeliveryStatus);
router.put("/deliveries/:deliveryId/assign-driver", assignDriver);
router.delete("/deliveries/:deliveryId", deleteDelivery);

/**
 * @swagger
 * /admin/payments:
 *   get:
 *     tags: [Admin]
 *     summary: Get all payments
 *     responses:
 *       200:
 *         description: Payments list
 */
router.get("/payments", getAllPayments);
router.get("/payments/:paymentId", getPaymentById);
router.post("/payments/:paymentId/refund", issueRefund);

/**
 * @swagger
 * /admin/support-tickets:
 *   get:
 *     tags: [Admin]
 *     summary: Get all support tickets
 *     responses:
 *       200:
 *         description: Support tickets
 */
router.get("/support-tickets", getAllSupportTickets);
router.get("/support-tickets/:ticketId", getSupportTicketById);
router.put("/support-tickets/:ticketId", updateSupportTicket);

/**
 * @swagger
 * /admin/system/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Get system statistics
 *     responses:
 *       200:
 *         description: System stats
 */
router.get("/system/stats", getSystemStats);

/**
 * @swagger
 * /admin/notifications/bulk:
 *   post:
 *     tags: [Admin]
 *     summary: Send bulk notification to users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, message, targetRole]
 *             properties:
 *               title: { type: string }
 *               message: { type: string }
 *               targetRole: { type: string, enum: [all, customer, driver, company_admin] }
 *     responses:
 *       200:
 *         description: Notifications sent
 */
router.post("/notifications/bulk", sendBulkNotification);

/**
 * @swagger
 * /admin/export/{dataType}:
 *   get:
 *     tags: [Admin]
 *     summary: Export data as CSV/JSON
 *     parameters:
 *       - in: path
 *         name: dataType
 *         required: true
 *         schema: { type: string, enum: [users, drivers, deliveries, payments] }
 *     responses:
 *       200:
 *         description: Exported data
 */
router.get("/export/:dataType", exportData);

export default router;