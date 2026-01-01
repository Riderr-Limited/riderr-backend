// driver.routes.js
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
  getDriverDeliveries,  // From driver.controller.js
  getDeliveryRequests,
  updateDriverSettings,
  acceptDelivery,        // From driver.controller.js  
  startDelivery,         // From driver.controller.js
  completeDelivery       // From driver.controller.js
} from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('driver'));

// Driver profile
router.get('/profile', getDriverProfile);
router.put('/profile', updateDriverProfile);
router.post('/documents', uploadDriverDocuments);

// Driver status and location
router.post('/location', updateDriverLocation);
router.post('/online-status', toggleDriverOnlineStatus);
router.post('/availability', updateDriverAvailability);

// Driver deliveries (ALL delivery-related endpoints)
router.get('/deliveries', getDriverDeliveries);               // GET /api/driver/deliveries
router.get('/current-delivery', getCurrentDelivery);          // GET /api/driver/current-delivery
router.get('/requests', getDeliveryRequests);                 // GET /api/driver/requests
router.post('/deliveries/accept/:deliveryId', acceptDelivery);   // POST /api/driver/deliveries/accept/:id
router.post('/deliveries/start/:deliveryId', startDelivery);     // POST /api/driver/deliveries/start/:id
router.post('/deliveries/complete/:deliveryId', completeDelivery); // POST /api/driver/deliveries/complete/:id

// Driver earnings and stats
router.get('/earnings', getDriverEarnings);
router.get('/stats', getDriverStats);

// Driver settings
router.put('/settings', updateDriverSettings);

export default router;