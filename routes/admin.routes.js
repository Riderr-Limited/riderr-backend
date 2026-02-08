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

  // Company Management
  getAllCompanies,
  getCompanyById,
  updateCompany,
  approveCompany,

  // Delivery Management
  getAllDeliveries,
  getDeliveryById,
  updateDeliveryStatus,
  assignDriver,

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
import { protect, authorize } from "../middleware/auth.middleware.js";

const router = express.Router();

// Apply authentication middleware to all routes
router.use(protect); // Authenticate user (protect is an alias for authenticate)
router.use(authorize("admin")); // Only admins can access these routes

/**
 * ========================================
 * DASHBOARD & ANALYTICS ROUTES
 * ========================================
 */

// GET /api/admin/dashboard - Get dashboard overview
router.get("/dashboard", getDashboardOverview);

// GET /api/admin/analytics - Get platform analytics
router.get("/analytics", getPlatformAnalytics);

/**
 * ========================================
 * USER MANAGEMENT ROUTES
 * ========================================
 */

// GET /api/admin/users - Get all users with filtering
router.get("/users", getAllUsers);

// GET /api/admin/users/:userId - Get user details
router.get("/users/:userId", getUserById);

// PUT /api/admin/users/:userId - Update user
router.put("/users/:userId", updateUser);

// PUT /api/admin/users/:userId/suspend - Suspend/Unsuspend user
router.put("/users/:userId/suspend", suspendUser);

// DELETE /api/admin/users/:userId - Delete user
router.delete("/users/:userId", deleteUser);

// POST /api/admin/users/:userId/reset-password - Reset user password
router.post("/users/:userId/reset-password", resetUserPassword);

/**
 * ========================================
 * DRIVER MANAGEMENT ROUTES
 * ========================================
 */

// GET /api/admin/drivers - Get all drivers
router.get("/drivers", getAllDrivers);

// GET /api/admin/drivers/:driverId - Get driver details
router.get("/drivers/:driverId", getDriverById);

// PUT /api/admin/drivers/:driverId - Update driver
router.put("/drivers/:driverId", updateDriver);

// PUT /api/admin/drivers/:driverId/approve - Approve/Reject driver
router.put("/drivers/:driverId/approve", approveDriver);

/**
 * ========================================
 * COMPANY MANAGEMENT ROUTES
 * ========================================
 */

// GET /api/admin/companies - Get all companies
router.get("/companies", getAllCompanies);

// GET /api/admin/companies/:companyId - Get company details
router.get("/companies/:companyId", getCompanyById);

// PUT /api/admin/companies/:companyId - Update company
router.put("/companies/:companyId", updateCompany);

// PUT /api/admin/companies/:companyId/approve - Approve/Reject company
router.put("/companies/:companyId/approve", approveCompany);

/**
 * ========================================
 * DELIVERY MANAGEMENT ROUTES
 * ========================================
 */

// GET /api/admin/deliveries - Get all deliveries
router.get("/deliveries", getAllDeliveries);

// GET /api/admin/deliveries/:deliveryId - Get delivery details
router.get("/deliveries/:deliveryId", getDeliveryById);

// PUT /api/admin/deliveries/:deliveryId/status - Update delivery status
router.put("/deliveries/:deliveryId/status", updateDeliveryStatus);

// PUT /api/admin/deliveries/:deliveryId/assign-driver - Assign driver
router.put("/deliveries/:deliveryId/assign-driver", assignDriver);

/**
 * ========================================
 * PAYMENT MANAGEMENT ROUTES
 * ========================================
 */

// GET /api/admin/payments - Get all payments
router.get("/payments", getAllPayments);

// GET /api/admin/payments/:paymentId - Get payment details
router.get("/payments/:paymentId", getPaymentById);

// POST /api/admin/payments/:paymentId/refund - Issue refund
router.post("/payments/:paymentId/refund", issueRefund);

/**
 * ========================================
 * SUPPORT TICKET MANAGEMENT ROUTES
 * ========================================
 */

// GET /api/admin/support-tickets - Get all support tickets
router.get("/support-tickets", getAllSupportTickets);

// GET /api/admin/support-tickets/:ticketId - Get ticket details
router.get("/support-tickets/:ticketId", getSupportTicketById);

// PUT /api/admin/support-tickets/:ticketId - Update ticket
router.put("/support-tickets/:ticketId", updateSupportTicket);

/**
 * ========================================
 * SYSTEM CONFIGURATION ROUTES
 * ========================================
 */

// GET /api/admin/system/stats - Get system statistics
router.get("/system/stats", getSystemStats);

// POST /api/admin/notifications/bulk - Send bulk notification
router.post("/notifications/bulk", sendBulkNotification);

// GET /api/admin/export/:dataType - Export data
router.get("/export/:dataType", exportData);

export default router;