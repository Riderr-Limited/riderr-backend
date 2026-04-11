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
 * @swagger
 * tags:
 *   name: Rides
 *   description: Ride booking & management
 */

/**
 * @swagger
 * /rides:
 *   post:
 *     tags: [Rides]
 *     summary: Create a ride request (customer)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, dropoff]
 *             properties:
 *               pickup:
 *                 type: object
 *                 properties:
 *                   address: { type: string }
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               dropoff:
 *                 type: object
 *                 properties:
 *                   address: { type: string }
 *                   lat: { type: number }
 *                   lng: { type: number }
 *     responses:
 *       201:
 *         description: Ride created
 */
router.post('/', authenticate, authorize('customer'), createRide);

/**
 * @swagger
 * /rides/my-rides:
 *   get:
 *     tags: [Rides]
 *     summary: Get my rides (customer)
 *     responses:
 *       200:
 *         description: List of rides
 */
router.get('/my-rides', authenticate, authorize('customer'), getMyRides);

/**
 * @swagger
 * /rides/active:
 *   get:
 *     tags: [Rides]
 *     summary: Get active ride (customer or driver)
 *     responses:
 *       200:
 *         description: Active ride
 */
router.get('/active', authenticate, authorize('customer', 'driver'), getActiveRide);
router.get('/statistics', authenticate, getRideStatistics);
router.get('/driver/my-rides', authenticate, authorize('driver'), getDriverRides);
router.get('/admin/all', authenticate, authorize('admin'), getAllRides);

/**
 * @swagger
 * /rides/companies/{companyId}/rides:
 *   get:
 *     tags: [Rides]
 *     summary: Get company rides (company_admin)
 *     parameters:
 *       - in: path
 *         name: companyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Company rides
 */
router.get('/companies/:companyId/rides', authenticate, authorize('company_admin', 'admin'), getCompanyRides);

/**
 * @swagger
 * /rides/{rideId}/accept:
 *   post:
 *     tags: [Rides]
 *     summary: Accept a ride (driver)
 *     parameters:
 *       - in: path
 *         name: rideId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ride accepted
 */
router.post('/:rideId/accept', authenticate, authorize('driver'), acceptRide);
router.post('/:rideId/arrive', authenticate, authorize('driver'), arriveAtPickup);
router.post('/:rideId/start', authenticate, authorize('driver'), startRide);
router.post('/:rideId/complete', authenticate, authorize('driver'), completeRide);
router.post('/:rideId/cancel', authenticate, authorize('customer', 'driver'), cancelRide);
router.post('/:rideId/assign', authenticate, authorize('admin', 'company_admin'), assignRideToDriver);

/**
 * @swagger
 * /rides/{rideId}/rate:
 *   post:
 *     tags: [Rides]
 *     summary: Rate a completed ride (customer)
 *     parameters:
 *       - in: path
 *         name: rideId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               review: { type: string }
 *     responses:
 *       200:
 *         description: Rating submitted
 */
router.post('/:rideId/rate', authenticate, authorize('customer'), rateRide);

/**
 * @swagger
 * /rides/{rideId}:
 *   get:
 *     tags: [Rides]
 *     summary: Get ride by ID
 *     parameters:
 *       - in: path
 *         name: rideId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ride details
 *       404:
 *         description: Not found
 */
router.get('/:rideId', authenticate, getRideById);

export default router;