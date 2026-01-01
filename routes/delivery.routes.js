// delivery.routes.js - KEEP ONLY:
import express from 'express';
import {
  // Customer endpoints ONLY
  createDeliveryRequest,
  getNearbyDrivers,
  getMyDeliveries,
  
  // Shared endpoints
  getDeliveryDetails,
  cancelDelivery,
  rateDelivery,
  trackDelivery,
} from '../controllers/delivery.controller.js';
import { getDriverDeliveries } from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Customer routes ONLY
router.post('/request', protect, authorize('customer'), createDeliveryRequest);
router.get('/nearby-drivers', protect, authorize('customer'), getNearbyDrivers);
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.get("/driver/my-deliveries", protect, authorize("driver"), getDriverDeliveries);
// Shared routes
router.get('/:deliveryId', protect, getDeliveryDetails);
router.post('/:deliveryId/cancel', protect, cancelDelivery);
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);
router.get('/:deliveryId/track', protect, trackDelivery);

export default router;