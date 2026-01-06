import express from 'express';
import {
  getCompanyProfile,
  updateCompanyProfile,
  getCompanyDrivers,
  getCompanyStatistics,
  getCompanyDeliveries,
  getCompanyEarnings,
  updateCompanySettings,
  manageCompanyDocuments,
  getCompanyDriverRequests,
  approveDriverDocument,
  suspendDriver,
  activateDriver,
  getCompanyNotifications,
  getCompanyTransactions
} from '../controllers/driver.controller.js';
import { protect, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('company_admin'));

// Company profile management
router.route('/profile')
  .get(getCompanyProfile)
  .put(updateCompanyProfile);

// Company drivers management
router.get('/drivers', getCompanyDrivers);
router.get('/driver-requests', getCompanyDriverRequests);

// Company driver actions
router.post('/drivers/:driverId/approve-document', approveDriverDocument);
router.post('/drivers/:driverId/suspend', suspendDriver);
router.post('/drivers/:driverId/activate', activateDriver);

// Company statistics and data
router.get('/statistics', getCompanyStatistics);
router.get('/deliveries', getCompanyDeliveries);
router.get('/earnings', getCompanyEarnings);
router.get('/transactions', getCompanyTransactions);

// Company settings
router.put('/settings', updateCompanySettings);

// Company documents
router.post('/documents', manageCompanyDocuments);

// Company notifications
router.get('/notifications', getCompanyNotifications);

export default router;