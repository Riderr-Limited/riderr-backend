/**
 * @swagger
 * tags:
 *   name: Company
 *   description: Company admin management
 */
 
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
/**
 * @swagger
 * /company/profile:
 *   get:
 *     tags: [Company]
 *     summary: Get company profile
 *     responses:
 *       200:
 *         description: Company profile
 *   put:
 *     tags: [Company]
 *     summary: Update company profile
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               address: { type: string }
 *               phone: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.route('/profile')
  .get(getCompanyProfile)
  .put(updateCompanyProfile);

/**
 * @swagger
 * /company/drivers:
 *   get:
 *     tags: [Company]
 *     summary: Get all company drivers
 *     responses:
 *       200:
 *         description: List of drivers
 */
// ============ COMPANY DRIVERS ============
router.get('/drivers', getCompanyDrivers);
router.get('/driver-requests', getCompanyDriverRequests);

/**
 * @swagger
 * /company/drivers/{driverId}/approve-document:
 *   post:
 *     tags: [Company]
 *     summary: Approve a driver document
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Document approved
 */
router.post('/drivers/:driverId/approve-document', approveDriverDocument);

/**
 * @swagger
 * /company/drivers/{driverId}/suspend:
 *   post:
 *     tags: [Company]
 *     summary: Suspend a driver
 *     parameters:
 *       - in: path
 *         name: driverId
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
 *         description: Driver suspended
 */
router.post('/drivers/:driverId/suspend', suspendDriver);

/**
 * @swagger
 * /company/drivers/{driverId}/activate:
 *   post:
 *     tags: [Company]
 *     summary: Activate a driver
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Driver activated
 */
router.post('/drivers/:driverId/activate', activateDriver);

/**
 * @swagger
 * /company/statistics:
 *   get:
 *     tags: [Company]
 *     summary: Get company statistics
 *     responses:
 *       200:
 *         description: Company stats
 */
// ============ COMPANY STATISTICS & DATA ============
router.get('/statistics', getCompanyStatistics);
router.get('/deliveries', getCompanyDeliveries);
router.get('/earnings', getCompanyEarnings);
router.get('/transactions', getCompanyTransactions);
router.route("/stats").get(getCompanyStats);
router.route("/request-verification").post(requestCompanyVerification);

/**
 * @swagger
 * /company/settings:
 *   put:
 *     tags: [Company]
 *     summary: Update company settings
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               commissionRate: { type: number }
 *               autoAssign: { type: boolean }
 *     responses:
 *       200:
 *         description: Settings updated
 */
// ============ COMPANY SETTINGS ============
router.put('/settings', updateCompanySettings);

/**
 * @swagger
 * /company/documents:
 *   post:
 *     tags: [Company]
 *     summary: Upload company documents
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document: { type: string, format: binary }
 *               documentType: { type: string }
 *     responses:
 *       200:
 *         description: Document uploaded
 */
// ============ COMPANY DOCUMENTS ============
router.post('/documents', handleUploadError, manageCompanyDocuments);

/**
 * @swagger
 * /company/notifications:
 *   get:
 *     tags: [Company]
 *     summary: Get company notifications
 *     responses:
 *       200:
 *         description: Notifications list
 */
// ============ COMPANY NOTIFICATIONS ============
router.get('/notifications', getCompanyNotifications);

export default router;