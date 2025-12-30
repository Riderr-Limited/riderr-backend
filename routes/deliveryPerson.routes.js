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

 

 

router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const deliveryPerson = await DeliveryPerson.findOne({ userId })
      .populate('userId', 'name email phone avatarUrl');
    
    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: 'Delivery person not found'
      });
    }
    
    res.json({
      success: true,
      deliveryPerson
    });
  } catch (error) {
    console.error('Error fetching delivery person:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;