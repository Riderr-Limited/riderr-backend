import Notification from "../models/notification.model.js";
import User from "../models/user.models.js";

/**
 * Send notification to user
 */
export const sendNotification = async ({ userId, title, message, data, type = "system" }) => {
  try {
    // Create notification in database
    const notification = new Notification({
      userId,
      title,
      message,
      data,
      type,
      read: false
    });

    await notification.save();

    // Get user's notification preferences
    const user = await User.findById(userId).select('notifications');
    
    // Check if user has push notifications enabled
    if (user?.notifications?.pushEnabled) {
      // Send push notification (implement with Firebase/APNS)
      await sendPushNotification(userId, title, message, data);
    }

    // Check if user has email notifications enabled
    if (user?.notifications?.emailEnabled && data?.type !== "delivery_request") {
      // Send email notification
      await sendEmailNotification(userId, title, message, data);
    }

    return { success: true, notificationId: notification._id };
  } catch (error) {
    console.error("Send notification error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send push notification (placeholder - implement with Firebase/APNS)
 */
const sendPushNotification = async (userId, title, message, data) => {
  try {
    // Get user's device tokens
    const user = await User.findById(userId).select('deviceTokens');
    
    if (!user?.deviceTokens?.length) {
      return;
    }

    // Send to each device token
    // Implementation depends on your push notification service
    console.log(`Push to ${userId}: ${title} - ${message}`);
    
  } catch (error) {
    console.error("Push notification error:", error);
  }
};

/**
 * Send email notification (placeholder)
 */
const sendEmailNotification = async (userId, title, message, data) => {
  try {
    const user = await User.findById(userId).select('email name');
    
    if (!user?.email) {
      return;
    }

    // Send email using your email service
    console.log(`Email to ${user.email}: ${title} - ${message}`);
    
  } catch (error) {
    console.error("Email notification error:", error);
  }
};

/**
 * Broadcast notification to multiple users
 */
export const broadcastNotification = async (userIds, title, message, data) => {
  try {
    const promises = userIds.map(userId => 
      sendNotification({ userId, title, message, data })
    );
    
    const results = await Promise.allSettled(promises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter(r => r.status === 'rejected' || !r.value?.success).length;
    
    return {
      success: true,
      sent: successful,
      failed
    };
  } catch (error) {
    console.error("Broadcast notification error:", error);
    return { success: false, error: error.message };
  }
};