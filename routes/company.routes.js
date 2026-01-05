// routes/company.routes.js
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
import upload, { handleUploadError, validateFile } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Protect all routes
router.use(protect);
router.use(authorize('company', 'company_admin'));

// Company profile management
router.get('/profile', getCompanyProfile);
router.put('/profile', updateCompanyProfile);
router.put('/settings', updateCompanySettings);

// Company documents upload
router.post('/documents',
  upload.singleDocument,
  handleUploadError,
  validateFile,
  manageCompanyDocuments
);

// Company drivers management
router.get('/drivers', getCompanyDrivers);
router.get('/driver-requests', getCompanyDriverRequests);
router.post('/drivers/:driverId/approve-document', approveDriverDocument);
router.post('/drivers/:driverId/suspend', suspendDriver);
router.post('/drivers/:driverId/activate', activateDriver);

// Company deliveries and operations
router.get('/deliveries', getCompanyDeliveries);
router.get('/statistics', getCompanyStatistics);
router.get('/earnings', getCompanyEarnings);
router.get('/transactions', getCompanyTransactions);

// Company notifications
router.get('/notifications', getCompanyNotifications);

export default router;