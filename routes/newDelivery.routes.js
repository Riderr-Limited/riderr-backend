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
  addTip
} from '../controllers/newDelivery.controller.js';

const router = express.Router();

// ========== CREATE DELIVERY ==========

// Create new delivery (Customer)
// POST /api/deliveries
// Body: { customerId, companyId, customerName, customerPhone, recipientName, recipientPhone, pickup, dropoff, itemDetails, vehicleType, paymentMethod }
router.post('/', createDelivery);

// ========== DRIVER ACTIONS ==========

// Accept delivery (Driver)
// POST /api/deliveries/:deliveryId/accept
// Body: { driverId }
router.post('/:deliveryId/accept', acceptDelivery);

// Mark delivery as picked up (Driver)
// POST /api/deliveries/:deliveryId/pickup
// Body: { driverId }
router.post('/:deliveryId/pickup', pickupDelivery);

// Complete delivery (Driver)
// POST /api/deliveries/:deliveryId/complete
// Body: { driverId, proofOfDelivery }
router.post('/:deliveryId/complete', completeDelivery);

// Cancel delivery (Customer or Driver)
// POST /api/deliveries/:deliveryId/cancel
// Body: { cancelledBy, reason }
router.post('/:deliveryId/cancel', cancelDelivery);

// ========== TRACKING & QUERIES ==========

// Track delivery with real-time driver location (Customer)
// GET /api/deliveries/:deliveryId/track
router.get('/:deliveryId/track', trackDelivery);

// Get delivery by reference ID
// GET /api/deliveries/reference/:referenceId
router.get('/reference/:referenceId', getDeliveryByReference);

// Get customer's deliveries
// GET /api/deliveries/customer/:customerId?status=delivered&limit=50&page=1
router.get('/customer/:customerId', getCustomerDeliveries);

// Get driver's active delivery
// GET /api/deliveries/driver/:driverId/active
router.get('/driver/:driverId/active', getDriverActiveDelivery);

// ========== RATING & REVIEW ==========

// Rate delivery (Customer)
// POST /api/deliveries/:deliveryId/rate
// Body: { rating, review }
router.post('/:deliveryId/rate', rateDelivery);

// Add tip to delivery (Customer)
// POST /api/deliveries/:deliveryId/tip
// Body: { amount }
router.post('/:deliveryId/tip', addTip);

export default router;