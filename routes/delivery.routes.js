import express from "express";
import {
  createDelivery,
  getMyDeliveries,
  getCompanyDeliveries,
  assignDelivery,
  updateDeliveryStatus,
  getRiderDeliveries,
  getDeliveryById,
  getAllDeliveries
} from "../controllers/delivery.controller.js";
import authorize from "../middlewares/authorize.js";
import authorizeRole from "../middlewares/authorizeRole.js";

const router = express.Router();

// Apply authorization to all routes
router.use(authorize);

// ================== CUSTOMER ROUTES ==================

/**
 * @route   POST /api/deliveries
 * @desc    Create a new delivery
 * @access  Private (customer only)
 */
router.post("/", authorizeRole(["customer"]), createDelivery);

/**
 * @route   GET /api/deliveries/my
 * @desc    Get customer's deliveries
 * @access  Private (customer only)
 */
router.get("/my", authorizeRole(["customer"]), getMyDeliveries);

// ================== RIDER ROUTES ==================

/**
 * @route   GET /api/deliveries/rider
 * @desc    Get rider's assigned deliveries
 * @access  Private (rider only)
 */
router.get("/rider", authorizeRole(["rider"]), getRiderDeliveries);

/**
 * @route   PATCH /api/deliveries/:deliveryId/status
 * @desc    Update delivery status (rider workflow)
 * @access  Private (rider only)
 */
router.patch("/:deliveryId/status", authorizeRole(["rider"]), updateDeliveryStatus);

// ================== COMPANY ADMIN ROUTES ==================

/**
 * @route   GET /api/deliveries/company/:companyId
 * @desc    Get company's deliveries
 * @access  Private (company_admin only)
 */
router.get("/company/:companyId", authorizeRole(["company_admin"]), getCompanyDeliveries);

/**
 * @route   PATCH /api/deliveries/:deliveryId/assign
 * @desc    Assign delivery to rider
 * @access  Private (company_admin only)
 */
router.patch("/:deliveryId/assign", authorizeRole(["company_admin"]), assignDelivery);

/**
 * @route   PATCH /api/deliveries/:deliveryId/cancel
 * @desc    Cancel delivery
 * @access  Private (customer, company_admin, admin)
 */
router.patch("/:deliveryId/cancel", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Cancel delivery endpoint - to be implemented"
  });
});

/**
 * @route   PATCH /api/deliveries/:deliveryId/match
 * @desc    Match delivery to company
 * @access  Private (admin only)
 */
router.patch("/:deliveryId/match", authorizeRole(["admin"]), (req, res) => {
  res.status(200).json({
    success: true,
    message: "Match delivery endpoint - to be implemented"
  });
});

/**
 * @route   POST /api/deliveries/:deliveryId/rating
 * @desc    Rate delivery (customer rates rider/company)
 * @access  Private (customer only)
 */
router.post("/:deliveryId/rating", authorizeRole(["customer"]), (req, res) => {
  res.status(200).json({
    success: true,
    message: "Rate delivery endpoint - to be implemented"
  });
});

// ================== ADMIN ROUTES ==================

/**
 * @route   GET /api/deliveries
 * @desc    Get all deliveries (admin dashboard)
 * @access  Private (admin only)
 */
router.get("/", authorizeRole(["admin"]), getAllDeliveries);

// ================== SHARED ROUTES ==================

/**
 * @route   GET /api/deliveries/:deliveryId
 * @desc    Get delivery by ID
 * @access  Private (customer, rider, company_admin, admin)
 */
router.get("/:deliveryId", getDeliveryById);

export default router;