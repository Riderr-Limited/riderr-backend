import express from 'express';
import {
  // Customer endpoints
  createDeliveryRequest,
  getNearbyDrivers,
  getMyDeliveries,
  getCustomerActiveDelivery,
  
  // Driver endpoints
  getNearbyDeliveryRequests,
  acceptDelivery,
  rejectDelivery,
  startDelivery,
  completeDelivery,
  getDriverActiveDelivery,
  getDriverDeliveries,
  getDriverDeliveryStats,
  
  // Shared endpoints
  getDeliveryDetails,
  trackDelivery,
  cancelDelivery,
  rateDelivery,
  getDeliveryUpdates,
} from '../controllers/delivery.controller.js';

import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// ============ CUSTOMER ROUTES ============
router.post('/request', protect, authorize('customer'), createDeliveryRequest);
router.get('/nearby-drivers', protect, authorize('customer'), getNearbyDrivers);
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.get('/customer/active', protect, authorize('customer'), getCustomerActiveDelivery);

// ============ DRIVER ROUTES ============
router.get('/driver/nearby', protect, authorize('driver'), getNearbyDeliveryRequests);
router.get('/driver/active', protect, authorize('driver'), getDriverActiveDelivery);
router.get('/driver/my-deliveries', protect, authorize('driver'), getDriverDeliveries);
router.get('/driver/stats', protect, authorize('driver'), getDriverDeliveryStats);

router.post('/:deliveryId/accept', protect, authorize('driver'), acceptDelivery);
router.post('/:deliveryId/reject', protect, authorize('driver'), rejectDelivery);
router.post('/:deliveryId/start', protect, authorize('driver'), startDelivery);
router.post('/:deliveryId/complete', protect, authorize('driver'), completeDelivery);

// ============ SHARED ROUTES ============
router.get('/:deliveryId', protect, getDeliveryDetails);
router.get('/:deliveryId/track', protect, trackDelivery);
router.get('/:deliveryId/updates', protect, getDeliveryUpdates);
router.post('/:deliveryId/cancel', protect, cancelDelivery);
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);

export default router;