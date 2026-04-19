 import express from 'express';
import {
  createDeliveryRequest,
  getNearbyDrivers, 
  getMyDeliveries,
  getCustomerActiveDelivery,
  calculateDeliveryFare,
  getNearbyDeliveryRequests,
  acceptDelivery,
  rejectDelivery,
  startDelivery,
  completeDelivery,
  getDriverActiveDelivery,
  getDriverDeliveries,
  getDriverDeliveryStats,
  getDeliveryDetails,
  trackDelivery,
  cancelDeliveryWithRefund,  
  rateDelivery,
  getDeliveryUpdates,
  getCompanyDeliveries,
  deleteDelivery,
} from '../controllers/delivery.controller.js';
import { updateDriverLocation } from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Deliveries
 *   description: Delivery request lifecycle
 */

/**
 * @swagger
 * /deliveries/request:
 *   post:
 *     tags: [Deliveries]
 *     summary: Create a delivery request (customer)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, dropoff, itemDetails, vehicleType]
 *             properties:
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
 *         description: Delivery request created
 */
router.post('/request', protect, authorize('customer'), createDeliveryRequest);

/**
 * @swagger
 * /deliveries/nearby-drivers:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get nearby available drivers (customer)
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number }
 *       - in: query
 *         name: vehicleType
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of nearby drivers
 */
router.get('/nearby-drivers', protect, authorize('customer'), getNearbyDrivers);

/**
 * @swagger
 * /deliveries/my:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get my deliveries (customer)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Customer deliveries
 */
router.get('/my', protect, authorize('customer'), getMyDeliveries);
router.get('/customer/active', protect, authorize('customer'), getCustomerActiveDelivery);

/**
 * @swagger
 * /deliveries/calculate-fare:
 *   post:
 *     tags: [Deliveries]
 *     summary: Calculate delivery fare before booking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, dropoff, vehicleType]
 *             properties:
 *               pickup:
 *                 type: object
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               dropoff:
 *                 type: object
 *                 properties:
 *                   lat: { type: number }
 *                   lng: { type: number }
 *               vehicleType: { type: string, enum: [bike, car, van, truck] }
 *     responses:
 *       200:
 *         description: Fare estimate
 */
router.post('/calculate-fare', protect, authorize('customer'), calculateDeliveryFare);

/**
 * @swagger
 * /deliveries/driver/nearby:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get nearby delivery requests (driver)
 *     responses:
 *       200:
 *         description: Nearby delivery requests
 */
router.get('/driver/nearby', protect, authorize('driver'), getNearbyDeliveryRequests);
router.get('/driver/active', protect, authorize('driver'), getDriverActiveDelivery);
router.get('/driver/my-deliveries', protect, authorize('driver'), getDriverDeliveries);
router.get('/driver/stats', protect, authorize('driver'), getDriverDeliveryStats);
router.post('/driver/location', protect, authorize('driver'), updateDriverLocation);

/**
 * @swagger
 * /deliveries/company/deliveries:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get all deliveries for a company (company_admin)
 *     responses:
 *       200:
 *         description: Company deliveries
 */
router.get('/company/deliveries', protect, authorize('company_admin'), getCompanyDeliveries);

/**
 * @swagger
 * /deliveries/{deliveryId}/accept:
 *   post:
 *     tags: [Deliveries]
 *     summary: Accept a delivery (driver)
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery accepted
 */
router.post('/:deliveryId/accept', protect, authorize('driver'), acceptDelivery);

/**
 * @swagger
 * /deliveries/{deliveryId}/reject:
 *   post:
 *     tags: [Deliveries]
 *     summary: Reject a delivery (driver)
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery rejected
 */
router.post('/:deliveryId/reject', protect, authorize('driver'), rejectDelivery);
router.post('/:deliveryId/start', protect, authorize('driver'), startDelivery);
router.post('/:deliveryId/complete', protect, authorize('driver'), completeDelivery);

/**
 * @swagger
 * /deliveries/{deliveryId}:
 *   get:
 *     tags: [Deliveries]
 *     summary: Get delivery details
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Delivery details
 *       404:
 *         description: Not found
 */
router.get('/:deliveryId', protect, getDeliveryDetails);
router.get('/:deliveryId/track', protect, trackDelivery);
router.get('/:deliveryId/updates', protect, getDeliveryUpdates);
<<<<<<< Updated upstream
=======
router.post('/:deliveryId/cancel', protect, cancelDeliveryWithRefund); // ✅ Single route
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);
router.delete('/:deliveryId', protect, authorize('customer'), deleteDelivery);
>>>>>>> Stashed changes

/**
 * @swagger
 * /deliveries/{deliveryId}/cancel:
 *   post:
 *     tags: [Deliveries]
 *     summary: Cancel a delivery with refund
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Delivery cancelled
 */
router.post('/:deliveryId/cancel', protect, cancelDeliveryWithRefund);

/**
 * @swagger
 * /deliveries/{deliveryId}/rate:
 *   post:
 *     tags: [Deliveries]
 *     summary: Rate a completed delivery (customer)
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               review: { type: string }
 *     responses:
 *       200:
 *         description: Rating submitted
 */
router.post('/:deliveryId/rate', protect, authorize('customer'), rateDelivery);


router.get('/debug/all-drivers', protect, async (req, res) => {
  try {
    const allDrivers = await Driver.find({}).lean();
    
    console.log('📊 TOTAL DRIVERS IN DATABASE:', allDrivers.length);
    
    const analysis = allDrivers.map(driver => ({
      _id: driver._id,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      isActive: driver.isActive,
      approvalStatus: driver.approvalStatus,
      currentDeliveryId: driver.currentDeliveryId || 'none',
      
      // Location data analysis
      hasCurrentLocation: !!driver.currentLocation,
      currentLocationData: driver.currentLocation,
      
      hasGeoJSONLocation: !!driver.location,
      geoJSONLocationData: driver.location,
      
      // Check if would pass each condition
      passesOnline: driver.isOnline === true,
      passesAvailable: driver.isAvailable === true,
      passesActive: driver.isActive === true,
      passesApproval: driver.approvalStatus === 'approved',
      passesNoDelivery: !driver.currentDeliveryId,
      
      // Check location validity
      hasValidCurrentLocation: 
        driver.currentLocation?.lat && 
        driver.currentLocation?.lng &&
        typeof driver.currentLocation.lat === 'number' &&
        typeof driver.currentLocation.lng === 'number' &&
        driver.currentLocation.lat !== 0 &&
        driver.currentLocation.lng !== 0,
        
      hasValidGeoJSON:
        driver.location?.coordinates &&
        Array.isArray(driver.location.coordinates) &&
        driver.location.coordinates.length >= 2 &&
        driver.location.coordinates[0] !== 0 &&
        driver.location.coordinates[1] !== 0,
    }));
    
    const passesAll = analysis.filter(d => 
      d.passesOnline && 
      d.passesAvailable && 
      d.passesActive && 
      d.passesApproval && 
      d.passesNoDelivery &&
      (d.hasValidCurrentLocation || d.hasValidGeoJSON)
    );
    
    res.json({
      success: true,
      totalDrivers: allDrivers.length,
      driversPassingAllChecks: passesAll.length,
      analysis: analysis,
      passesAll: passesAll.map(d => d._id),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 2. ADD THIS TEST QUERY ENDPOINT
// ============================================================================
router.get('/debug/test-query', protect, async (req, res) => {
  try {
    console.log('🧪 TESTING DIFFERENT QUERY VARIATIONS...\n');
    
    // Query 1: Just isOnline
    const q1 = await Driver.find({ isOnline: true }).lean();
    console.log(`Query 1 (isOnline: true): ${q1.length} results`);
    
    // Query 2: isOnline AND isAvailable
    const q2 = await Driver.find({ 
      isOnline: true,
      isAvailable: true 
    }).lean();
    console.log(`Query 2 (isOnline + isAvailable): ${q2.length} results`);
    
    // Query 3: Add isActive
    const q3 = await Driver.find({ 
      isOnline: true,
      isAvailable: true,
      isActive: true
    }).lean();
    console.log(`Query 3 (+ isActive): ${q3.length} results`);
    
    // Query 4: Add approvalStatus
    const q4 = await Driver.find({ 
      isOnline: true,
      isAvailable: true,
      isActive: true,
      approvalStatus: 'approved'
    }).lean();
    console.log(`Query 4 (+ approvalStatus): ${q4.length} results`);
    
    // Query 5: Your CURRENT query (BROKEN - double $or)
    const q5 = await Driver.find({
      isOnline: true,
      isAvailable: true,
      isActive: true,
      approvalStatus: 'approved',
      $or: [
        { currentDeliveryId: { $exists: false } },
        { currentDeliveryId: null }
      ],
      $or: [  // ← This overwrites the previous $or!
        { 'location.coordinates': { $exists: true, $ne: [0, 0] } },
        { 'currentLocation.lat': { $exists: true } },
      ],
    }).lean();
    console.log(`Query 5 (BROKEN - double $or): ${q5.length} results`);
    
    // Query 6: FIXED - using $and
    const q6 = await Driver.find({
      $and: [
        { isOnline: true },
        { isAvailable: true },
        { isActive: true },
        { approvalStatus: 'approved' },
        {
          $or: [
            { currentDeliveryId: { $exists: false } },
            { currentDeliveryId: null }
          ]
        },
        {
          $or: [
            { 'location.coordinates': { $exists: true, $ne: [0, 0] } },
            { 'currentLocation.lat': { $exists: true } },
          ]
        }
      ]
    }).lean();
    console.log(`Query 6 (FIXED - $and): ${q6.length} results`);
    
    // Query 7: Even simpler - just check for any location
    const q7 = await Driver.find({
      isOnline: true,
      isAvailable: true,
      isActive: true,
      approvalStatus: 'approved',
      currentDeliveryId: null,
    }).lean();
    console.log(`Query 7 (No location check): ${q7.length} results`);
    
    res.json({
      success: true,
      results: {
        justOnline: q1.length,
        onlineAndAvailable: q2.length,
        withActive: q3.length,
        withApproval: q4.length,
        brokenDoubleOr: q5.length,
        fixedWithAnd: q6.length,
        noLocationCheck: q7.length,
      },
      drivers: {
        q1: q1.map(d => d._id),
        q2: q2.map(d => d._id),
        q3: q3.map(d => d._id),
        q4: q4.map(d => d._id),
        q5: q5.map(d => d._id),
        q6: q6.map(d => d._id),
        q7: q7.map(d => d._id),
      },
      recommendation: 'Compare the results to see where drivers are being filtered out'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;