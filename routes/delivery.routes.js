import express from 'express';
import {
  // Customer endpoints
  createDeliveryRequest,
  getNearbyDrivers,
  getMyDeliveries,
  generateDeliveryOTP,
  
  // Driver endpoints
  getNearbyDeliveryRequests,
  acceptDelivery,
  rejectDelivery,
  getDriverActiveDelivery,
  getDriverDeliveries,
  startDelivery,
  completeDelivery,
  updateDeliveryLocation,
  
  // Shared endpoints
  getDeliveryDetails,
  cancelDelivery,
  rateDelivery,
  trackDelivery,
  
  // Admin endpoints
  getAllDeliveries,
  getCompanyDeliveries
} from '../controllers/delivery.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';
import { 
  validateCreateDelivery,
  validateNearbyDrivers,
  validateNearbyDeliveryRequests,
  validateAcceptDelivery,
  validateRejectDelivery,
  validateStartDelivery,
  validateCompleteDelivery,
  validateUpdateLocation,
  validateOTPGeneration,
  validateCancelDelivery,
  validateRateDelivery,
  validateDeliveryQuery,
  validateIdParam
} from '../middlewares/validation.middleware.js';

const router = express.Router();

// Customer routes
router.post('/request', protect, authorize('customer'), validateCreateDelivery, createDeliveryRequest);
router.get('/nearby-drivers', protect, authorize('customer'), validateNearbyDrivers, getNearbyDrivers);
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.post('/:deliveryId/generate-otp', protect, authorize('customer'), validateIdParam, validateOTPGeneration, generateDeliveryOTP);

// Driver routes
router.get('/driver/nearby', protect, authorize('driver'), validateNearbyDeliveryRequests, getNearbyDeliveryRequests);
router.get('/driver/active', protect, authorize('driver'), getDriverActiveDelivery);
router.get('/driver/my-deliveries', protect, authorize('driver'), getDriverDeliveries);
router.post('/:deliveryId/accept', protect, authorize('driver'), validateIdParam, validateAcceptDelivery, acceptDelivery);
router.post('/:deliveryId/reject', protect, authorize('driver'), validateIdParam, validateRejectDelivery, rejectDelivery);
router.post('/:deliveryId/start', protect, authorize('driver'), validateIdParam, validateStartDelivery, startDelivery);
router.post('/:deliveryId/complete', protect, authorize('driver'), validateIdParam, validateCompleteDelivery, completeDelivery);
router.post('/:deliveryId/location', protect, authorize('driver'), validateIdParam, validateUpdateLocation, updateDeliveryLocation);

// Shared routes
router.get('/:deliveryId', protect, validateIdParam, getDeliveryDetails);
router.post('/:deliveryId/cancel', protect, validateIdParam, validateCancelDelivery, cancelDelivery);
router.post('/:deliveryId/rate', protect, authorize('customer'), validateIdParam, validateRateDelivery, rateDelivery);
router.get('/:deliveryId/track', protect, validateIdParam, trackDelivery);

// Admin routes
router.get('/', protect, authorize('admin'), validateDeliveryQuery, getAllDeliveries);
router.get('/company/:companyId/deliveries', protect, authorize('company_admin', 'admin'), validateIdParam, getCompanyDeliveries);

export default router;