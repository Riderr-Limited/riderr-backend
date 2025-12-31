// routes/driver.routes.js
import express from 'express';
import {
   updateDriverLocation,
  toggleDriverOnlineStatus,
  getDriverProfile,
  updateDriverProfile,
  uploadDriverDocuments,
  getCurrentDelivery,
  updateDriverAvailability
 } from '../controllers/driver.controller.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Driver   and location
 router.patch('/location', updateDriverLocation);
router.patch('/online-status', toggleDriverOnlineStatus);
router.post('/availability', updateDriverAvailability);
 
// Driver profile
router.get('/profile', getDriverProfile);
router.patch('/profile', updateDriverProfile);

// Driver documents
router.post('/documents', uploadDriverDocuments);

// Current delivery
router.get('/current-delivery', getCurrentDelivery);

export default router;