// routes/rider.routes.js
import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  getNearbyRiders,
  getNearbyDrivers,
  updateRiderLocation,
  updateDriverLocation,
  toggleRiderOnlineStatus,
  toggleDriverOnlineStatus,
  getRiderProfile
} from '../controllers/rider.controller.js';
import { validateObjectIds } from "../middlewares/validateObjectIds.js";

const router = express.Router();
validateObjectIds(router);

// Apply authentication to all routes. (This used to be `router.use(authorize)`:
// authorize is a factory, so every request hung and no login was checked.)
router.use(authenticate);

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