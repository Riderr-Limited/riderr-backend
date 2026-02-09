import express from "express";
import {
  getMessages,
  sendMessage,
  getUnreadCount,
  getUserChats,
} from "../controllers/adminChat.controller.js";
import authenticate from "../middlewares/authenticate.js";

const router = express.Router();

router.get("/messages", authenticate, getMessages);
router.post("/messages", authenticate, sendMessage);
router.get("/unread", authenticate, getUnreadCount);
router.get("/users", authenticate, getUserChats);

export default router;
