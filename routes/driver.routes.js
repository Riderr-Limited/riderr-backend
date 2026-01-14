import express from 'express';
import {
  getDriverProfile,
  updateDriverProfile,
  uploadDriverDocuments,
  updateDriverLocation,
  toggleDriverOnlineStatus,
  updateDriverAvailability,
  getCurrentDelivery,
  getDriverEarnings,
  getDriverStats,
  getDriverDeliveries,
  getDeliveryRequests,
  updateDriverSettings,
  getNearbyDeliveryRequests,
  acceptDelivery,
  startDelivery,
  completeDelivery,
  rejectDelivery,
} from '../controllers/driver.controller.js';

import { protect, authorize } from '../middlewares/auth.middleware.js';
import upload, { handleUploadError } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Protect all routes - only drivers can access
router.use(protect);
router.use(authorize('driver'));

// ============ DRIVER PROFILE ============
router.get('/profile', getDriverProfile);
router.put('/profile', updateDriverProfile);

// ============ DRIVER DOCUMENTS ============
router.post('/documents',handleUploadError, uploadDriverDocuments);

// ============ DRIVER STATUS & LOCATION ============
router.post('/location', updateDriverLocation);
router.post('/online-status', toggleDriverOnlineStatus);
router.post('/availability', updateDriverAvailability);

// ============ DRIVER DELIVERIES ============
router.get('/deliveries', getDriverDeliveries);
router.get('/current-delivery', getCurrentDelivery);
router.get('/requests', getDeliveryRequests);
router.get('/nearby-requests', getNearbyDeliveryRequests);

// Delivery actions (also in delivery.routes.js)
router.post('/deliveries/accept/:deliveryId', acceptDelivery);
router.post('/deliveries/start/:deliveryId', startDelivery);
router.post('/deliveries/complete/:deliveryId', completeDelivery);
router.post('/deliveries/reject/:deliveryId', rejectDelivery);

// ============ DRIVER EARNINGS & STATS ============
router.get('/earnings', getDriverEarnings);
router.get('/stats', getDriverStats);

// ============ DRIVER SETTINGS ============
router.put('/settings', updateDriverSettings);

export default router;