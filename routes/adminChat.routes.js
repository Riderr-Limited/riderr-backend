import express from "express";
import {
  getMessages,
  sendMessage,
  getUnreadCount,
  getAdminUnreadCount,
  getUserChats,
  getUserMessages,
  deleteMessage,
  markConversationRead,
} from "../controllers/adminChat.controller.js";
import authenticate from "../middlewares/authenticate.js";

const router = express.Router();

// User-facing
router.get("/messages", authenticate, getMessages);
router.post("/messages", authenticate, sendMessage);
router.get("/unread", authenticate, getUnreadCount);

// Admin-facing
router.get("/conversations", authenticate, getUserChats);
router.get("/admin-unread", authenticate, getAdminUnreadCount);
router.get("/users/:userId/messages", authenticate, getUserMessages);
router.put("/users/:userId/mark-read", authenticate, markConversationRead);
router.delete("/messages/:messageId", authenticate, deleteMessage);

export default router;
