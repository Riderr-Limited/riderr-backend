/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Delivery chat between customer and driver
 */
import express from "express";
import { body } from "express-validator";
import {
  getChatHistory,
  sendMessage,
  markMessagesAsRead,
  getUnreadCount,
  initiateVoiceCallFromChat,
} from "../controllers/chat.controller.js";
import {
  authenticate,
  canAccessDeliveryChat,
} from "../middlewares/auth.middleware.js";

const router = express.Router();

// All chat routes require authentication
router.use(authenticate);

// Validation rules
const messageValidation = [
  body("message")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Message must be 1-500 characters"),
  body("messageType")
    .optional()
    .isIn(["text", "image", "location"])
    .withMessage("Invalid message type"),
];

/**
 * @swagger
 * /chat/{deliveryId}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: Get chat history for a delivery
 *     parameters:
 *       - in: path
 *         name: deliveryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chat messages
 */
router.get("/:deliveryId/messages", canAccessDeliveryChat, getChatHistory);

/**
 * @swagger
 * /chat/{deliveryId}/message:
 *   post:
 *     tags: [Chat]
 *     summary: Send a message in a delivery chat
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
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 500 }
 *               messageType: { type: string, enum: [text, image, location], default: text }
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post("/:deliveryId/message", canAccessDeliveryChat, messageValidation, sendMessage);
router.put("/:deliveryId/read", canAccessDeliveryChat, markMessagesAsRead);
router.get("/unread/count", getUnreadCount);
router.post("/:deliveryId/voice-call", canAccessDeliveryChat, initiateVoiceCallFromChat);

export default router;
