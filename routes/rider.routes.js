// routes/rider.routes.js
import express from 'express';
import authorize from '../middlewares/authorize.js'; // Default import
import {
  getNearbyRiders,
  getNearbyDrivers,
  updateRiderLocation,
  updateDriverLocation,
  toggleRiderOnlineStatus,
  toggleDriverOnlineStatus,
  getRiderProfile
} from '../controllers/rider.controller.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authorize);

// ================== PROFILE ROUTES ==================
router.get('/profile', getRiderProfile);

// ================== DELIVERY RIDER ROUTES ==================
router.get('/nearby', getNearbyRiders);
router.patch('/location', updateRiderLocation);
router.patch('/online-status', toggleRiderOnlineStatus);

// ================== RIDE DRIVER ROUTES ==================
router.get('/drivers/nearby', getNearbyDrivers);
router.patch('/drivers/location', updateDriverLocation);
router.patch('/drivers/online-status', toggleDriverOnlineStatus); // Keep this for /api/rider/drivers/online-status



export default router;