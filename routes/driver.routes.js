// routes/driver.routes.js
import express from 'express';
import {
  getNearbyDrivers,
  updateDriverLocation,
  toggleDriverOnlineStatus,
  getDriverProfile,
  updateDriverProfile,
  uploadDriverDocuments,
  getCurrentDelivery,
  updateAvailability
} from '../controllers/driver.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Driver   and location
router.get('/nearby', getNearbyDrivers);
router.patch('/location', updateDriverLocation);
router.patch('/online-status', toggleDriverOnlineStatus);
router.patch('/availability', updateAvailability);

// Driver profile
router.get('/profile', getDriverProfile);
router.patch('/profile', updateDriverProfile);

// Driver documents
router.post('/documents', uploadDriverDocuments);

// Current delivery
router.get('/current-delivery', getCurrentDelivery);

export default router;