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

router.get("/", getNotifications);
router.get("/unread-count", getUnreadNotificationCount);
router.get("/:notificationId", getNotificationById);
router.put("/read-all", markAllAsRead);
router.put("/:notificationId/read", markAsRead);
router.put("/:notificationId/click", markAsClicked);
router.delete("/clear-read", clearReadNotifications);
router.delete("/:notificationId", deleteNotification);
router.put("/push-token", updatePushToken);

export default router;
