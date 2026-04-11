/**
 * @swagger
 * tags:
 *   name: Rescue
 *   description: Driver rescue & delivery reassignment
 */
import express from "express";
import { protect, authorize } from '../middlewares/auth.middleware.js';
import {
  requestDriverHelp,
  getCompanyRescueRequests,
  reassignDelivery,
  getAvailableDriversForReassignment,
  dismissRescueRequest,
  getRescueRequestStatus,
} from "../controllers/rescue.controller.js";

const router = express.Router();

// All routes require authentication
 
// ─── DRIVER ROUTES ────────────────────────────────────────────────────────────

/**
 * @route   POST /api/deliveries/:deliveryId/request-help
 * @desc    Driver requests rescue (tire broke, accident, etc.)
 * @access  Private (Driver)
 * @body    { reason, details, currentLat, currentLng }
 */
/**
 * @swagger
 * /rescue/deliveries/{deliveryId}/request-help:
 *   post:
 *     tags: [Rescue]
 *     summary: Driver requests rescue help
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *               details: { type: string }
 *               currentLat: { type: number }
 *               currentLng: { type: number }
 *     responses:
 *       200:
 *         description: Rescue request sent
 */
router.post("/deliveries/:deliveryId/request-help", protect, authorize("driver"), requestDriverHelp);

/**
 * @swagger
 * /rescue/deliveries/{deliveryId}/rescue-status:
 *   get:
 *     tags: [Rescue]
 *     summary: Get rescue request status (driver)
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Rescue status
 */
router.get("/deliveries/:deliveryId/rescue-status", protect, authorize("driver"), getRescueRequestStatus);

/**
 * @swagger
 * /rescue/company/rescue-requests:
 *   get:
 *     tags: [Rescue]
 *     summary: Get all pending rescue requests (company_admin)
 *     responses:
 *       200:
 *         description: Rescue requests list
 */
router.get("/company/rescue-requests", protect, authorize("company", "company_admin"), getCompanyRescueRequests);
router.get("/company/available-drivers", protect, authorize("company", "company_admin"), getAvailableDriversForReassignment);

/**
 * @swagger
 * /rescue/company/deliveries/{deliveryId}/reassign:
 *   post:
 *     tags: [Rescue]
 *     summary: Reassign delivery to another driver (company_admin)
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
 *             required: [newDriverId]
 *             properties:
 *               newDriverId: { type: string }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Delivery reassigned
 */
router.post("/company/deliveries/:deliveryId/reassign", protect, authorize("company", "company_admin"), reassignDelivery);
router.post("/company/deliveries/:deliveryId/dismiss-rescue", protect, authorize("company", "company_admin"), dismissRescueRequest);

export default router;