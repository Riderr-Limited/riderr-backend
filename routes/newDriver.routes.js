import express from 'express';
import {
  updateLocation,
  goOnline,
  goOffline,
  getDriverProfile,
  getNearbyDrivers,
  getDriverStats,
  getCompanyDrivers,
  getPendingDrivers,
  updateDriverProfile,
  suspendDriver,
  getDriverDeliveries
} from '../controllers/newDriver.controller.js';

const router = express.Router();

// ========== DRIVER STATUS & LOCATION ==========

// Update driver location
// POST /api/drivers/:driverId/location
router.post('/:driverId/location', updateLocation);

// Go online
// POST /api/drivers/:driverId/online
router.post('/:driverId/online', goOnline);

// Go offline
// POST /api/drivers/:driverId/offline
router.post('/:driverId/offline', goOffline);

// ========== DRIVER QUERIES ==========

// Get driver profile
// GET /api/drivers/:driverId
router.get('/:driverId', getDriverProfile);

// Get driver statistics
// GET /api/drivers/:driverId/stats
router.get('/:driverId/stats', getDriverStats);

// Get driver's delivery history
// GET /api/drivers/:driverId/deliveries?status=completed&limit=50
router.get('/:driverId/deliveries', getDriverDeliveries);

// Get available drivers near location
// GET /api/drivers/nearby?longitude=3.3792&latitude=6.5244&vehicleType=bike&maxDistance=5000
router.get('/search/nearby', getNearbyDrivers);

// Get drivers by company
// GET /api/drivers/company/:companyId?status=online&isOnline=true&approvalStatus=approved
router.get('/company/:companyId', getCompanyDrivers);

// Get pending approval drivers
// GET /api/drivers/pending?companyId=123
router.get('/pending/list', getPendingDrivers);

// ========== DRIVER MANAGEMENT ==========

// Update driver profile
// PUT /api/drivers/:driverId
router.put('/:driverId', updateDriverProfile);

// Suspend driver
// POST /api/drivers/:driverId/suspend
router.post('/:driverId/suspend', suspendDriver);

export default router;