/**
 * @swagger
 * tags:
 *   name: Deliveries (v2)
 *   description: Delivery management (mounted at /api/deliveries)
 */
import express from 'express';
import {
  createDelivery,
  acceptDelivery,
  pickupDelivery,
  completeDelivery,
  cancelDelivery,
  trackDelivery,
  getDeliveryByReference,
  getCustomerDeliveries,
  getDriverActiveDelivery,
  rateDelivery,
  addTip,
  getNearbyDrivers
} from '../controllers/newDelivery.controller.js';

const router = express.Router();

// ========== CREATE DELIVERY ==========

/**
 * @swagger
 * /deliveries:
 *   post:
 *     tags: [Deliveries (v2)]
 *     summary: Create a new delivery
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, companyId, pickup, dropoff, itemDetails, vehicleType]
 *             properties:
 *               customerId: { type: string }
 *               companyId: { type: string }
 *               customerName: { type: string }
 *               customerPhone: { type: string }
 *               recipientName: { type: string }
 *               recipientPhone: { type: string }
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
 *         description: Delivery created
 */
router.post('/', createDelivery);
router.post('/:deliveryId/accept', acceptDelivery);
router.post('/:deliveryId/pickup', pickupDelivery);
router.post('/:deliveryId/complete', completeDelivery);
router.post('/:deliveryId/cancel', cancelDelivery);
router.get('/:deliveryId/track', trackDelivery);
router.get('/reference/:referenceId', getDeliveryByReference);
router.get('/customer/:customerId', getCustomerDeliveries);
router.get('/driver/:driverId/active', getDriverActiveDelivery);
router.post('/:deliveryId/rate', rateDelivery);
router.post('/:deliveryId/tip', addTip);
router.get('/nearby-drivers', getNearbyDrivers);

export default router;