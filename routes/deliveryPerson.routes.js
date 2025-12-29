// routes/deliveryPerson.routes.js
import express from 'express';
import authenticate from '../middlewares/authenticate.js';
import {
  getNearbyDeliveryPersons,
  updateLocation,
  toggleOnlineStatus,
  getProfile,
  updateServices
} from '../controllers/deliveryPerson.controller.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get nearby delivery persons
router.get('/nearby', getNearbyDeliveryPersons);

// Get profile
router.get('/profile', getProfile);

// Update location
router.patch('/location', updateLocation);

// Toggle online status
router.patch('/online-status', toggleOnlineStatus);

// Update services
router.patch('/services', updateServices);

export default router;