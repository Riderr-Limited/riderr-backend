import express from "express";
import { body } from "express-validator";
import {
  getChatHistory,
  sendMessage,
  markMessagesAsRead,
  getUnreadCount,
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

// Routes
router.get("/:deliveryId/messages", canAccessDeliveryChat, getChatHistory);
router.post(
  "/:deliveryId/message",
  canAccessDeliveryChat,
  messageValidation,
  sendMessage,
);
router.put("/:deliveryId/read", canAccessDeliveryChat, markMessagesAsRead);
router.get("/unread/count", getUnreadCount);

export default router;
