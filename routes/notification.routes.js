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
