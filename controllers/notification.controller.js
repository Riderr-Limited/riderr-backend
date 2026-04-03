import Notification from "../models/notification.model.js";
import User from "../models/user.models.js";
import { getUnreadCount } from "../utils/notification.js";

/**
 * @desc  Get notifications for the logged-in user
 * @route GET /api/notifications
 * @access Private
 */
export const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly, type, priority } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { userId: req.user._id };
    if (unreadOnly === "true") query.read = false;
    if (type) query.type = type;
    if (priority) query.priority = priority;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query),
      getUnreadCount(req.user._id),
    ]);

    return res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        total,
        unreadCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
        hasNextPage: parseInt(page) * parseInt(limit) < total,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("❌ getNotifications error:", error);
    return res.status(500).json({ success: false, message: "Failed to get notifications" });
  }
};

/**
 * @desc  Get unread notification count
 * @route GET /api/notifications/unread-count
 * @access Private
 */
export const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await getUnreadCount(req.user._id);
    return res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    console.error("❌ getUnreadNotificationCount error:", error);
    return res.status(500).json({ success: false, message: "Failed to get unread count" });
  }
};

/**
 * @desc  Get a single notification by ID
 * @route GET /api/notifications/:notificationId
 * @access Private
 */
export const getNotificationById = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      userId: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    console.error("❌ getNotificationById error:", error);
    return res.status(500).json({ success: false, message: "Failed to get notification" });
  }
};

/**
 * @desc  Mark a single notification as read
 * @route PUT /api/notifications/:notificationId/read
 * @access Private
 */
export const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, userId: req.user._id },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, message: "Notification marked as read", data: notification });
  } catch (error) {
    console.error("❌ markAsRead error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
};

/**
 * @desc  Mark a single notification as clicked
 * @route PUT /api/notifications/:notificationId/click
 * @access Private
 */
export const markAsClicked = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, userId: req.user._id },
      { $set: { clicked: true, clickedAt: new Date(), read: true, readAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    console.error("❌ markAsClicked error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark as clicked" });
  }
};

/**
 * @desc  Mark all notifications as read
 * @route PUT /api/notifications/read-all
 * @access Private
 */
export const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data: { updatedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("❌ markAllAsRead error:", error);
    return res.status(500).json({ success: false, message: "Failed to mark all as read" });
  }
};

/**
 * @desc  Delete a single notification
 * @route DELETE /api/notifications/:notificationId
 * @access Private
 */
export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.notificationId,
      userId: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("❌ deleteNotification error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

/**
 * @desc  Delete all read notifications for the user
 * @route DELETE /api/notifications/clear-read
 * @access Private
 */
export const clearReadNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      userId: req.user._id,
      read: true,
    });

    return res.status(200).json({
      success: true,
      message: `${result.deletedCount} notifications cleared`,
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    console.error("❌ clearReadNotifications error:", error);
    return res.status(500).json({ success: false, message: "Failed to clear notifications" });
  }
};

/**
 * @desc  Register / update push notification token
 * @route PUT /api/notifications/push-token
 * @access Private
 */
export const updatePushToken = async (req, res) => {
  try {
    const { token, platform } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "Push token is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.pushToken = token;
    if (!user.deviceTokens) user.deviceTokens = [];
    if (!user.deviceTokens.includes(token)) user.deviceTokens.push(token);
    if (platform) user.devicePlatform = platform;

    await user.save();

    return res.status(200).json({ success: true, message: "Push token updated" });
  } catch (error) {
    console.error("❌ updatePushToken error:", error);
    return res.status(500).json({ success: false, message: "Failed to update push token" });
  }
};
