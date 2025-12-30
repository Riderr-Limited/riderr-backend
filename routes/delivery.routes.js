// routes/delivery.routes.js
import express from "express";
import {
  createDeliveryRequest,
  getNearbyDrivers,
  acceptDelivery,
  rejectDelivery,
  startDelivery,
  updateDeliveryLocation,
  completeDelivery,
  cancelDelivery,
  getDeliveryDetails,
  rateDelivery,
  getMyDeliveries,
  getDriverDeliveries,
  trackDelivery,
  generateDeliveryOTP,
  getAllDeliveries,
  getCompanyDeliveries
} from "../controllers/delivery.controller.js";
import { protect, authorize, companyAdminOnly, adminOnly } from "../middlewares/auth.middleware.js";
import {
  validateCreateDelivery,
  validateRateDelivery,
  validateIdParam,
  validatePagination,
  validateDeliveryQuery,
  validateNearbyDrivers,
  validateUpdateLocation,
  validateOTPGeneration,
  validateCancelDelivery,
  validateStartDelivery,
  validateCompleteDelivery
} from "../middlewares/validation.middleware.js";

const router = express.Router();

// ==================== PROTECTED ROUTES ====================
// All routes require authentication
router.use(protect);

// ==================== CUSTOMER ROUTES ====================
router.post("/request", 
  authorize('customer'),
  validateCreateDelivery,
  createDeliveryRequest
);

router.get("/nearby-drivers", 
  authorize('customer'),
  validateNearbyDrivers,
  getNearbyDrivers
);

router.get("/my",
  authorize('customer'),
  validatePagination,
  validateDeliveryQuery,
  getMyDeliveries
);

router.post("/:deliveryId/generate-otp",
  authorize('customer'),
  validateIdParam,
  validateOTPGeneration,
  generateDeliveryOTP
);

router.post("/:deliveryId/rate",
  authorize('customer'),
  validateIdParam,
  validateRateDelivery,
  rateDelivery
);

router.post("/:deliveryId/cancel",
  authorize('customer', 'driver', 'admin'),
  validateIdParam,
  validateCancelDelivery,
  cancelDelivery
);

// ==================== DRIVER ROUTES ====================
router.post("/:deliveryId/accept",
  authorize('driver'),
  validateIdParam,
  acceptDelivery
);

router.post("/:deliveryId/reject",
  authorize('driver'),
  validateIdParam,
  rejectDelivery
);

router.post("/:deliveryId/start",
  authorize('driver'),
  validateIdParam,
  validateStartDelivery,
  startDelivery
);

router.post("/:deliveryId/complete",
  authorize('driver'),
  validateIdParam,
  validateCompleteDelivery,
  completeDelivery
);

router.post("/:deliveryId/location",
  authorize('driver'),
  validateIdParam,
  validateUpdateLocation,
  updateDeliveryLocation
);

router.get("/driver/my",
  authorize('driver'),
  validatePagination,
  validateDeliveryQuery,
  getDriverDeliveries
);

// ==================== SHARED ROUTES (Customer/Driver/Admin) ====================
router.get("/:deliveryId",
  validateIdParam,
  getDeliveryDetails
);

router.get("/:deliveryId/track",
  validateIdParam,
  trackDelivery
);

// ==================== COMPANY ADMIN ROUTES ====================
router.get("/company/:companyId/deliveries",
  companyAdminOnly,
  validateIdParam,
  validatePagination,
  validateDeliveryQuery,
  getCompanyDeliveries
);

// ==================== ADMIN ROUTES ====================
router.get("/",
  adminOnly,
  validatePagination,
  validateDeliveryQuery,
  getAllDeliveries
);

export default router;