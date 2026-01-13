// delivery.routes.js - Add these endpoints
import express from 'express';
import {
  // Customer endpoints
  createDeliveryRequest,
  getNearbyDrivers,
  getMyDeliveries,
  getCustomerActiveDelivery, // ADD THIS
  
  // Driver endpoints (remove from here)
  
  // Shared endpoints
  getDeliveryDetails,
  cancelDelivery,
  rateDelivery,
  trackDelivery,
} from '../controllers/delivery.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Customer routes  
router.post('/request', protect, authorize('customer'), createDeliveryRequest);
router.get('/nearby-drivers', protect, authorize('customer'), getNearbyDrivers);
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.get('/customer/active', protect, authorize('customer'), getCustomerActiveDelivery);  

// Shared routes
router.get('/:deliveryId', protect, getDeliveryDetails);
router.post('/:deliveryId/cancel', protect, cancelDelivery);
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);
router.get('/:deliveryId/track', protect, trackDelivery);

export default router;