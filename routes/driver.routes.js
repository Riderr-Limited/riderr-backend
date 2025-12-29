// routes/drivers.routes.js
import express from 'express';
import authorize from '../middlewares/authorize.js'; // Default import
import {
  updateDriverLocation,
  toggleDriverOnlineStatus,
  getRiderProfile
} from '../controllers/rider.controller.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authorize); // Use the correct middleware

/**
 * @route   GET /api/drivers/profile
 * @desc    Get driver profile
 * @access  Private (driver only)
 */
router.get('/profile', getRiderProfile);

/**
 * @route   PATCH /api/drivers/online-status
 * @desc    Toggle driver online status
 * @access  Private (driver only)
 */
router.patch('/online-status', toggleDriverOnlineStatus);

/**
 * @route   PATCH /api/drivers/location
 * @desc    Update driver location
 * @access  Private (driver only)
 */
router.patch('/location', updateDriverLocation);

export default router;