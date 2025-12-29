// routes/delivery.routes.js
import express from 'express';
import authenticate from '../middlewares/authenticate.js';
import {
  createDelivery,
  getMyDeliveries,
  getDeliveryPersonDeliveries, // ✅ This is the correct name
  getDeliveryById,              // ✅ Fixed typo
  getAllDeliveries,
  assignDelivery,
  updateDeliveryStatus,
  getNearbyRidersForDelivery
} from '../controllers/delivery.controller.js';

const router = express.Router();

// Get nearby delivery persons for delivery
router.get('/nearby-riders', authenticate, getNearbyRidersForDelivery);

// Create a new delivery (with optional delivery person selection)
router.post('/', authenticate, createDelivery);

// Get my deliveries (Customer)
router.get('/my', authenticate, getMyDeliveries);

// Get delivery person's deliveries (Delivery Person)
router.get('/delivery-person', authenticate, getDeliveryPersonDeliveries); // ✅ Use correct name

// Get company deliveries (Company Admin)
// Note: This function doesn't exist in your controller! You need to add it
router.get('/company/:companyId', authenticate, (req, res) => {
  res.status(501).json({ 
    success: false, 
    message: "Company deliveries endpoint not implemented yet" 
  });
});

// Get all deliveries (Admin)
router.get('/', authenticate, getAllDeliveries);

// Get delivery by ID
router.get('/:deliveryId', authenticate, getDeliveryById);

// Assign delivery to delivery person (Company Admin)
router.patch('/:deliveryId/assign', authenticate, assignDelivery);

// Update delivery status (Delivery Person)
router.patch('/:deliveryId/status', authenticate, updateDeliveryStatus);

export default router;