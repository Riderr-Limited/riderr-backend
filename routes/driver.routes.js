// routes/driver.routes.js
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
  acceptDelivery,
  startDelivery,
  completeDelivery
} from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';
import upload, { handleUploadError } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('driver'));

// Driver profile
router.get('/profile', getDriverProfile);
router.put('/profile', updateDriverProfile);

// Driver documents upload
router.post('/documents',
  upload.multipleDocuments,
  handleUploadError,
  uploadDriverDocuments
);

// Driver status and location
router.post('/location', updateDriverLocation);
router.post('/online-status', toggleDriverOnlineStatus);
router.post('/availability', updateDriverAvailability);

// Driver deliveries
router.get('/deliveries', getDriverDeliveries);
router.get('/current-delivery', getCurrentDelivery);
router.get('/requests', getDeliveryRequests);
router.post('/deliveries/accept/:deliveryId', acceptDelivery);
router.post('/deliveries/start/:deliveryId', startDelivery);
router.post('/deliveries/complete/:deliveryId', completeDelivery);

// Driver earnings and stats
router.get('/earnings', getDriverEarnings);
router.get('/stats', getDriverStats);

// Driver settings
router.put('/settings', updateDriverSettings);

export default router;