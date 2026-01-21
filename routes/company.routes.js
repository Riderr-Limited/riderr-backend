 
import express from 'express';
import {
  getCompanyProfile,
 // updateCompanyProfile,
  getCompanyDrivers,
  getCompanyStatistics,
  getCompanyDeliveries,
  getCompanyEarnings,
//  updateCompanySettings,
  manageCompanyDocuments,
  getCompanyDriverRequests,
  approveDriverDocument,
  suspendDriver,
  activateDriver,
//  getCompanyNotifications,
  getCompanyTransactions,
} from '../controllers/driver.controller.js';
import {
   updateCompanyProfile,
  updateCompanySettings,
  uploadCompanyDocument,
 // getCompanyDrivers,
  getCompanyStats,
  requestCompanyVerification,
  getCompanyNotifications,
} from "../controllers/company.controller.js";
import multer from "multer";
import { body } from "express-validator";


import { protect, authorize } from '../middlewares/auth.middleware.js';
import upload, { handleUploadError } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Protect all routes - only company admins can access
router.use(protect);
router.use(authorize('company_admin'));

// ============ COMPANY PROFILE ============
router.route('/profile')
  .get(getCompanyProfile)
  .put(updateCompanyProfile);

// ============ COMPANY DRIVERS ============
router.get('/drivers', getCompanyDrivers);
router.get('/driver-requests', getCompanyDriverRequests);

// Driver management actions
router.post('/drivers/:driverId/approve-document', approveDriverDocument);
router.post('/drivers/:driverId/suspend', suspendDriver);
router.post('/drivers/:driverId/activate', activateDriver);

// ============ COMPANY STATISTICS & DATA ============
router.get('/statistics', getCompanyStatistics);
router.get('/deliveries', getCompanyDeliveries);
router.get('/earnings', getCompanyEarnings);
router.get('/transactions', getCompanyTransactions);
router.route("/stats")
  .get(getCompanyStats);

router.route("/request-verification")
  .post(requestCompanyVerification);
// ============ COMPANY SETTINGS ============
router.put('/settings', updateCompanySettings);

// ============ COMPANY DOCUMENTS ============
router.post('/documents',
  
  handleUploadError,
  manageCompanyDocuments
);
 
// ============ COMPANY NOTIFICATIONS ============
router.get('/notifications', getCompanyNotifications);

export default router;