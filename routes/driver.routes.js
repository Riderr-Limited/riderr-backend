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
  getDeliveryRequests,
  updateDriverSettings
} from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('driver'));

// Driver profile
router.get('/profile', getDriverProfile);
router.put('/profile', updateDriverProfile);
router.post('/documents', uploadDriverDocuments);

// Driver status and location
router.post('/location', updateDriverLocation);
router.post('/online-status', toggleDriverOnlineStatus);
router.post('/availability', updateDriverAvailability);

// Driver deliveries
router.get('/current-delivery', getCurrentDelivery);
router.get('/requests', getDeliveryRequests); // For socket/notification based requests

// Driver earnings and stats
router.get('/earnings', getDriverEarnings);
router.get('/stats', getDriverStats);

// Driver settings
router.put('/settings', updateDriverSettings);

export default router;