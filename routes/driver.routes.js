/**
 * @swagger
 * tags:
 *   name: Driver
 *   description: Driver profile, status, deliveries & earnings
 */
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
  getNearbyDeliveryRequests,
  acceptDelivery,
  startDelivery,
  completeDelivery,
  rejectDelivery,
} from '../controllers/driver.controller.js';

import { protect, authorize } from '../middlewares/auth.middleware.js';
import upload, { handleUploadError } from '../middlewares/upload.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('driver'));

/**
 * @swagger
 * /driver/profile:
 *   get:
 *     tags: [Driver]
 *     summary: Get driver profile
 *     responses:
 *       200:
 *         description: Driver profile
 *   put:
 *     tags: [Driver]
 *     summary: Update driver profile
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               vehicleType: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.get('/profile', getDriverProfile);
router.put('/profile', updateDriverProfile);

/**
 * @swagger
 * /driver/documents:
 *   post:
 *     tags: [Driver]
 *     summary: Upload driver documents
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document: { type: string, format: binary }
 *               documentType: { type: string }
 *     responses:
 *       200:
 *         description: Documents uploaded
 */
router.post('/documents', handleUploadError, uploadDriverDocuments);

/**
 * @swagger
 * /driver/location:
 *   post:
 *     tags: [Driver]
 *     summary: Update driver location
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number }
 *               lng: { type: number }
 *     responses:
 *       200:
 *         description: Location updated
 */
router.post('/location', updateDriverLocation);

/**
 * @swagger
 * /driver/online-status:
 *   post:
 *     tags: [Driver]
 *     summary: Toggle online/offline status
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isOnline: { type: boolean }
 *     responses:
 *       200:
 *         description: Status updated
 */
router.post('/online-status', toggleDriverOnlineStatus);
router.post('/availability', updateDriverAvailability);

/**
 * @swagger
 * /driver/deliveries:
 *   get:
 *     tags: [Driver]
 *     summary: Get driver delivery history
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Driver deliveries
 */
router.get('/deliveries', getDriverDeliveries);
router.get('/current-delivery', getCurrentDelivery);
router.get('/requests', getDeliveryRequests);
router.get('/nearby-requests', getNearbyDeliveryRequests);
router.post('/deliveries/accept/:deliveryId', acceptDelivery);
router.post('/deliveries/start/:deliveryId', startDelivery);
router.post('/deliveries/complete/:deliveryId', completeDelivery);
router.post('/deliveries/reject/:deliveryId', rejectDelivery);

/**
 * @swagger
 * /driver/earnings:
 *   get:
 *     tags: [Driver]
 *     summary: Get driver earnings
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [today, week, month, all] }
 *     responses:
 *       200:
 *         description: Earnings data
 */
router.get('/earnings', getDriverEarnings);
router.get('/stats', getDriverStats);
router.put('/settings', updateDriverSettings);

export default router;