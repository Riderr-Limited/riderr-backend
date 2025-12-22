import express from 'express';
import {
  createRide,
  getMyRides,
  getActiveRide,
  assignRideToDriver,
  acceptRide,
  arriveAtPickup,
  startRide,
  completeRide,
  cancelRide,
  rateRide,
  getCompanyRides,
  getDriverRides,
  getRideById,
  getAllRides,
  getRideStatistics
} from '../controllers/ride.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Customer ride routes
 */

// @route   POST /api/rides
// @desc    Create ride request
// @access  Private (Customer)
router.post(
  '/',
  authenticate,
  authorize('customer'),
  createRide
);

// @route   GET /api/rides/my-rides
// @desc    Get my rides
// @access  Private (Customer)
router.get(
  '/my-rides',
  authenticate,
  authorize('customer'),
  getMyRides
);

// @route   GET /api/rides/active
// @desc    Get active ride
// @access  Private (Customer, Driver)
router.get(
  '/active',
  authenticate,
  authorize('customer', 'driver'),
  getActiveRide
);

// @route   GET /api/rides/statistics
// @desc    Get ride statistics
// @access  Private
router.get(
  '/statistics',
  authenticate,
  getRideStatistics
);

/**
 * Driver ride routes
 */

// @route   GET /api/rides/driver/my-rides
// @desc    Get driver rides
// @access  Private (Driver)
router.get(
  '/driver/my-rides',
  authenticate,
  authorize('driver'),
  getDriverRides
);

// @route   POST /api/rides/:rideId/accept
// @desc    Accept assigned ride
// @access  Private (Driver)
router.post(
  '/:rideId/accept',
  authenticate,
  authorize('driver'),
  acceptRide
);

// @route   POST /api/rides/:rideId/arrive
// @desc    Mark arrival at pickup
// @access  Private (Driver)
router.post(
  '/:rideId/arrive',
  authenticate,
  authorize('driver'),
  arriveAtPickup
);

// @route   POST /api/rides/:rideId/start
// @desc    Start ride
// @access  Private (Driver)
router.post(
  '/:rideId/start',
  authenticate,
  authorize('driver'),
  startRide
);

// @route   POST /api/rides/:rideId/complete
// @desc    Complete ride
// @access  Private (Driver)
router.post(
  '/:rideId/complete',
  authenticate,
  authorize('driver'),
  completeRide
);

/**
 * Shared ride actions
 */

// @route   POST /api/rides/:rideId/cancel
// @desc    Cancel ride
// @access  Private (Customer, Driver)
router.post(
  '/:rideId/cancel',
  authenticate,
  authorize('customer', 'driver'),
  cancelRide
);

// @route   POST /api/rides/:rideId/rate
// @desc    Rate ride
// @access  Private (Customer)
router.post(
  '/:rideId/rate',
  authenticate,
  authorize('customer'),
  rateRide
);

/**
 * Company admin routes
 */

// @route   GET /api/rides/companies/:companyId/rides
// @desc    Get company rides
// @access  Private (Company Admin, Admin)
router.get(
  '/companies/:companyId/rides',
  authenticate,
  authorize('company_admin', 'admin'),
  getCompanyRides
);

/**
 * System/Admin routes
 */

// @route   POST /api/rides/:rideId/assign
// @desc    Assign ride to driver
// @access  Private (System/Admin)
router.post(
  '/:rideId/assign',
  authenticate,
  authorize('admin', 'company_admin'),
  assignRideToDriver
);

// @route   GET /api/rides/admin/all
// @desc    Get all rides
// @access  Private (Admin)
router.get(
  '/admin/all',
  authenticate,
  authorize('admin'),
  getAllRides
);

/**
 * General ride routes
 */

// @route   GET /api/rides/:rideId
// @desc    Get ride by ID
// @access  Private
router.get('/:rideId', authenticate, getRideById);

export default router;