import express from "express";
import { protect, authorize } from '../middlewares/auth.middleware.js';
import {
  requestDriverHelp,
  getCompanyRescueRequests,
  reassignDelivery,
  getAvailableDriversForReassignment,
  dismissRescueRequest,
  getRescueRequestStatus,
} from "../controllers/rescue.controller.js";

const router = express.Router();

// All routes require authentication
 
// ─── DRIVER ROUTES ────────────────────────────────────────────────────────────

/**
 * @route   POST /api/deliveries/:deliveryId/request-help
 * @desc    Driver requests rescue (tire broke, accident, etc.)
 * @access  Private (Driver)
 * @body    { reason, details, currentLat, currentLng }
 */
router.post(
  "/deliveries/:deliveryId/request-help",
protect, authorize("driver"),
  requestDriverHelp
);

/**
 * @route   GET /api/deliveries/:deliveryId/rescue-status
 * @desc    Driver polls the status of their rescue request
 * @access  Private (Driver)
 */
router.get(
  "/deliveries/:deliveryId/rescue-status",
   protect,authorize("driver"),
  getRescueRequestStatus
);

// ─── COMPANY ROUTES ───────────────────────────────────────────────────────────

/**
 * @route   GET /api/company/rescue-requests
 * @desc    Company gets all pending rescue requests from their drivers
 * @access  Private (Company, Company Admin)
 */
router.get(
  "/company/rescue-requests",
  protect, authorize("company", "company_admin"),
  getCompanyRescueRequests
);

/**
 * @route   GET /api/company/available-drivers
 * @desc    Get available drivers for reassignment (optionally sorted by proximity to deliveryId)
 * @access  Private (Company, Company Admin)
 * @query   ?deliveryId=xxx
 */
router.get(
  "/company/available-drivers",
   protect, authorize("company", "company_admin"),
  getAvailableDriversForReassignment
);

/**
 * @route   POST /api/company/deliveries/:deliveryId/reassign
 * @desc    Company reassigns a delivery to a different driver
 * @access  Private (Company, Company Admin)
 * @body    { newDriverId, note }
 */
router.post(
  "/company/deliveries/:deliveryId/reassign",
  protect, authorize("company", "company_admin"),
  reassignDelivery
);

/**
 * @route   POST /api/company/deliveries/:deliveryId/dismiss-rescue
 * @desc    Company dismisses rescue request (driver continues)
 * @access  Private (Company, Company Admin)
 * @body    { note }
 */
router.post(
  "/company/deliveries/:deliveryId/dismiss-rescue",
  protect, authorize("company", "company_admin"),
  dismissRescueRequest
);

export default router;