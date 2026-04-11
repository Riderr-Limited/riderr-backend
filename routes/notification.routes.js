import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import {
  getNotifications,
  getUnreadNotificationCount,
  getNotificationById,
  markAsRead,
  markAsClicked,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  updatePushToken,
} from "../controllers/notification.controller.js";

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notifications & push token management
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notifications for the logged-in user
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [system, delivery, payment, security, promotion, order, support, driver, company, announcement] }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [low, medium, high, urgent] }
 *     responses:
 *       200:
 *         description: List of notifications
 */

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Get unread notification count
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     count: { type: integer }
 */

/**
 * @swagger
 * /notifications/read-all:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark all notifications as read
 *     responses:
 *       200:
 *         description: All marked as read
 */

/**
 * @swagger
 * /notifications/push-token:
 *   put:
 *     tags: [Notifications]
 *     summary: Register or update Expo push token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
 *               platform: { type: string, enum: [ios, android, web] }
 *     responses:
 *       200:
 *         description: Push token saved
 */

/**
 * @swagger
 * /notifications/clear-read:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete all read notifications
 *     responses:
 *       200:
 *         description: Read notifications cleared
 */

/**
 * @swagger
 * /notifications/{notificationId}:
 *   get:
 *     tags: [Notifications]
 *     summary: Get a single notification
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification data
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete a notification
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */

/**
 * @swagger
 * /notifications/{notificationId}/read:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark a notification as read
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Marked as read
 */

/**
 * @swagger
 * /notifications/{notificationId}/click:
 *   put:
 *     tags: [Notifications]
 *     summary: Mark a notification as clicked
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Marked as clicked
 */

// Static routes first — before any /:param routes
router.get("/unread-count", getUnreadNotificationCount);
router.put("/read-all", markAllAsRead);
router.put("/push-token", updatePushToken);
router.delete("/clear-read", clearReadNotifications);

// Param routes
router.get("/", getNotifications);
router.get("/:notificationId", getNotificationById);
router.put("/:notificationId/read", markAsRead);
router.put("/:notificationId/click", markAsClicked);
router.delete("/:notificationId", deleteNotification);

export default router;
