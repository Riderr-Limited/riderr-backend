// controllers/notification.controller.js

import Notification from "../models/notificaton.models.js";
import { markNotificationAsRead, markAllNotificationsAsRead, getUnreadCount } from "../utils/notification.js";

/**
 * @desc    Get user's notifications
 * @route   GET /api/notifications
 * @access  Private
 */
// controllers/notification.controller.js

export const getNotifications = async (req, res) => {
  try {
    const user = req.user;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    // Build query - include personal AND company notifications if user is company admin
    const query = {
      $or: [
        // Personal notifications
        { userId: user._id },
        // Company notifications (if user is a company admin)
        ...(user.role === 'company' || user.companyId ? [
          { 
            type: 'company',
            $or: [
              { userId: user._id }, // Direct company notifications to user
              { 'data.companyId': user.companyId }, // Company-wide notifications
              { 'data.companyId': user._id }, // If companyId is the user's ID
            ]
          }
        ] : [])
      ]
    };

    // Add unread filter if needed
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query),
      getUnreadCount(user._id), // You might need to update this too
    ]);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        total,
        unreadCount,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get notifications",
    });
  }
};

/**
 * @desc    Get unread notification count
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
export const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await getUnreadCount(req.user._id);

    res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error("❌ Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
    });
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/notifications/:notificationId/read
 * @access  Private
 */
export const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const user = req.user;

    const notification = await Notification.findOne({
      _id: notificationId,
      userId: user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    await markNotificationAsRead(notificationId);

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("❌ Mark as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
    });
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
export const markAllAsRead = async (req, res) => {
  try {
    await markAllNotificationsAsRead(req.user._id);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("❌ Mark all as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark all notifications as read",
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:notificationId
 * @access  Private
 */
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const user = req.user;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId: user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification",
    });
  }
};

/**
 * @desc    Delete all read notifications
 * @route   DELETE /api/notifications/clear-read
 * @access  Private
 */
export const clearReadNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      userId: req.user._id,
      isRead: true,
    });

    res.status(200).json({
      success: true,
      message: `${result.deletedCount} notifications cleared`,
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    console.error("❌ Clear read notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear notifications",
    });
  }
};

/**
 * @desc    Update push notification token
 * @route   PUT /api/notifications/push-token
 * @access  Private
 */
export const updatePushToken = async (req, res) => {
  try {
    const { token, platform } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Push token is required",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update push token
    user.pushToken = token;
    
    // Add to device tokens array if not already present
    if (!user.deviceTokens) {
      user.deviceTokens = [];
    }
    
    if (!user.deviceTokens.includes(token)) {
      user.deviceTokens.push(token);
    }

    // Store platform info
    if (platform) {
      user.devicePlatform = platform; // 'ios' or 'android'
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Push token updated successfully",
    });
  } catch (error) {
    console.error("❌ Update push token error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update push token",
    });
  }
};
