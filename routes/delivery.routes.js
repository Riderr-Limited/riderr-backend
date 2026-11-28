 import express from 'express';
import {
  createDeliveryRequest,
  getNearbyDrivers, 
  getMyDeliveries,
  getCustomerActiveDelivery,
  calculateDeliveryFare,
  getNearbyDeliveryRequests,
  acceptDelivery,
  rejectDelivery,
  startDelivery,
  completeDelivery,
  getDriverActiveDelivery,
  getDriverDeliveries,
  getDriverDeliveryStats,
  getDeliveryDetails,
  trackDelivery,
  cancelDeliveryWithRefund,  
  rateDelivery,
  getDeliveryUpdates,
  getCompanyDeliveries,
  deleteDelivery,
  assignCompanyToDelivery,
} from '../controllers/delivery.controller.js';
import { updateDriverLocation } from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';
import { validateObjectIds } from "../middlewares/validateObjectIds.js";

const router = express.Router();
validateObjectIds(router);

/**
 * @swagger
 * tags:
 *   name: Deliveries
 *   description: Delivery request lifecycle
 */

/**
 * @swagger
 * /deliveries/request:
 *   post:
 *     tags: [Deliveries]
 *     summary: Create a delivery request (customer)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, dropoff, itemDetails, vehicleType]
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
 *               itemDetails: { type: string }
 *               vehicleType: { type: string, enum: [bike, car, van, truck] }
 *               paymentMethod: { type: string, enum: [cash, card, wallet] }
 *     responses:
 *       201:
 *         description: Delivery request created
 */
router.post('/request', protect, authorize('customer'), createDeliveryRequest);
router.patch('/:deliveryId/assign-company', protect, authorize('customer'), assignCompanyToDelivery);

/**
 * @swagger
 * /deliveries/nearby-drivers:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get nearby available drivers (customer)
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: vehicleType
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of nearby drivers
 */
router.get('/nearby-drivers', protect, authorize('customer'), getNearbyDrivers);

/**
 * @swagger
 * /deliveries/my:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get my deliveries (customer)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Customer deliveries
 */
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.get('/customer/active', protect, authorize('customer'), getCustomerActiveDelivery);

/**
 * @swagger
 * /deliveries/calculate-fare:
 *   post:
 *     tags: [Deliveries]
 *     summary: Calculate delivery fare before booking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, dropoff, vehicleType]
 *             properties:
 *               pickup:
 *                 type: object
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               dropoff:
 *                 type: object
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               vehicleType: { type: string, enum: [bike, car, van, truck] }
 *     responses:
 *       200:
 *         description: Fare estimate
 */
router.post('/calculate-fare', protect, authorize('customer'), calculateDeliveryFare);

/**
 * @swagger
 * /deliveries/driver/nearby:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get nearby delivery requests (driver)
 *     responses:
 *       200:
 *         description: Nearby delivery requests
 */
router.get('/driver/nearby', protect, authorize('driver'), getNearbyDeliveryRequests);
router.get('/driver/active', protect, authorize('driver'), getDriverActiveDelivery);
router.get('/driver/my-deliveries', protect, authorize('driver'), getDriverDeliveries);
router.get('/driver/stats', protect, authorize('driver'), getDriverDeliveryStats);
router.post('/driver/location', protect, authorize('driver'), updateDriverLocation);

/**
 * @swagger
 * /deliveries/company/deliveries:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get all deliveries for a company (company_admin)
 *     responses:
 *       200:
 *         description: Company deliveries
 */
router.get('/company/deliveries', protect, authorize('company_admin'), getCompanyDeliveries);

/**
 * @swagger
 * /deliveries/{deliveryId}/accept:
 *   post:
 *     tags: [Deliveries]
 *     summary: Accept a delivery (driver)
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery accepted
 */
router.post('/:deliveryId/accept', protect, authorize('driver'), acceptDelivery);

/**
 * @swagger
 * /deliveries/{deliveryId}/reject:
 *   post:
 *     tags: [Deliveries]
 *     summary: Reject a delivery (driver)
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery rejected
 */
router.post('/:deliveryId/reject', protect, authorize('driver'), rejectDelivery);
router.post('/:deliveryId/start', protect, authorize('driver'), startDelivery);
router.post('/:deliveryId/complete', protect, authorize('driver'), completeDelivery);

/**
 * @swagger
 * /deliveries/{deliveryId}:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get delivery details
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery details
 *       404:
 *         description: Not found
 */
router.get('/:deliveryId', protect, getDeliveryDetails);
router.get('/:deliveryId/track', protect, trackDelivery);
router.get('/:deliveryId/updates', protect, getDeliveryUpdates);
router.post('/:deliveryId/cancel', protect, cancelDeliveryWithRefund); //  Single route
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);
router.delete('/:deliveryId', protect, authorize('customer'), deleteDelivery);

/**
 * @swagger
 * /deliveries/{deliveryId}/cancel:
 *   post:
 *     tags: [Deliveries]
 *     summary: Cancel a delivery with refund
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Delivery cancelled
 */
router.post('/:deliveryId/cancel', protect, cancelDeliveryWithRefund);

/**
 * @swagger
 * /deliveries/{deliveryId}/rate:
 *   post:
 *     tags: [Deliveries]
 *     summary: Rate a completed delivery (customer)
 *     parameters:
 *       - in: path
 *         name: deliveryId
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
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);



export default router;