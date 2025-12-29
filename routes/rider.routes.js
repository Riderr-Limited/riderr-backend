// routes/rider.routes.js
import express from 'express';
import {
  getNearbyRiders,
  getNearbyDrivers,
  updateRiderLocation,
  updateDriverLocation,
  toggleRiderOnlineStatus,
  toggleDriverOnlineStatus,
  getRiderProfile
} from '../controllers/rider.controller.js';
//import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();

// Rider routes
router.get('/nearby', getNearbyRiders);
router.patch('/location', updateRiderLocation);
router.patch('/online-status', toggleRiderOnlineStatus);
// Driver routes (for rides)
router.get('/drivers/nearby', getNearbyDrivers);
router.patch('/drivers/location', updateDriverLocation);
router.patch('/drivers/online-status', toggleDriverOnlineStatus);

export default router;