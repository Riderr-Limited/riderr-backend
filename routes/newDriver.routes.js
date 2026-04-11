/**
 * @swagger
 * tags:
 *   name: Drivers (v2)
 *   description: Driver management (mounted at /api/drivers)
 */
import express from 'express';
import {
  updateLocation,
  goOnline,
  goOffline,
  getDriverProfile,
  getNearbyDrivers,
  getDriverStats,
  getCompanyDrivers,
  getPendingDrivers,
  updateDriverProfile,
  suspendDriver,
  getDriverDeliveries
} from '../controllers/newDriver.controller.js';

const router = express.Router();

// ========== DRIVER STATUS & LOCATION ==========

/**
 * @swagger
 * /drivers/{driverId}/location:
 *   post:
 *     tags: [Drivers (v2)]
 *     summary: Update driver location
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200:
 *         description: Location updated
 */
router.post('/:driverId/location', updateLocation);
router.post('/:driverId/online', goOnline);
router.post('/:driverId/offline', goOffline);

/**
 * @swagger
 * /drivers/{driverId}:
 *   get:
 *     tags: [Drivers (v2)]
 *     summary: Get driver profile
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Driver profile
 *   put:
 *     tags: [Drivers (v2)]
 *     summary: Update driver profile
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.get('/:driverId', getDriverProfile);
router.get('/:driverId/stats', getDriverStats);
router.get('/:driverId/deliveries', getDriverDeliveries);
router.get('/search/nearby', getNearbyDrivers);
router.get('/company/:companyId', getCompanyDrivers);
router.get('/pending/list', getPendingDrivers);
router.put('/:driverId', updateDriverProfile);
router.post('/:driverId/suspend', suspendDriver);

export default router;