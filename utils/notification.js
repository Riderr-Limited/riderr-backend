 
import Notification from "../models/notificaton.models.js";
import User from "../models/user.models.js";

/**
 * Send notification to user and save to database
 * @param {Object} options - Notification options
 * @param {String} options.userId - User ID to send notification to
 * @param {String} options.type - Notification type
 * @param {String} options.title - Notification title
 * @param {String} options.message - Notification message/body
 * @param {Object} options.data - Additional data payload
 * @param {Boolean} options.sendPush - Whether to send push notification (default: true)
 */
export const sendNotification = async ({
  userId,
  type,
  title,
  message,
  data = {},
  sendPush = true,
}) => {
  try {
    // Create notification in database
    const notification = await Notification.create({
      userId,
      type,
      title,
      body: message,
      data,
      isRead: false,
    });

    console.log(`✅ Notification saved for user ${userId}: ${title}`);

    // Get user's push token if available
    if (sendPush) {
      const user = await User.findById(userId).select("pushToken deviceTokens");
      
      if (user?.pushToken || user?.deviceTokens?.length > 0) {
        // Send push notification (implement based on your push service)
        await sendPushNotification({
          token: user.pushToken || user.deviceTokens[0],
          title,
          body: message,
          data,
        });
        console.log(`📲 Push notification sent to user ${userId}`);
      }
    }

    // Emit socket event for real-time notification (if using Socket.IO)
    // global.io?.to(`user_${userId}`).emit('notification', notification);

    return notification;
  } catch (error) {
    console.error("❌ Send notification error:", error);
    // Don't throw error - notification failure shouldn't break main flow
    return null;
  }
};

/**
 * Send push notification via FCM or other service
 */
const sendPushNotification = async ({ token, title, body, data }) => {
  try {
    // Implement your push notification service here
    // Example for Firebase Cloud Messaging (FCM):
    /*
    const message = {
      notification: { title, body },
      data: data ? JSON.stringify(data) : {},
      token,
    };
    await admin.messaging().send(message);
    */
    
    console.log(`📱 Push notification would be sent: ${title}`);
    return true;
  } catch (error) {
    console.error("❌ Push notification error:", error);
    return false;
  }
};

/**
 * Notification templates for different events
 */
export const NotificationTemplates = {
  // Customer notifications
  DELIVERY_CREATED: (deliveryId, referenceId) => ({
    type: "delivery_created",
    title: "📦 Delivery Request Created",
    message: `Your delivery request ${referenceId} has been created. Looking for nearby drivers...`,
    data: { deliveryId, referenceId },
  }),

  DRIVER_ASSIGNED: (deliveryId, driverName, estimatedTime) => ({
    type: "driver_assigned",
    title: "🚗 Driver Assigned!",
    message: `${driverName} will pick up your package in approximately ${estimatedTime} minutes`,
    data: { deliveryId, driverName, estimatedTime },
  }),

  DRIVER_ARRIVING: (deliveryId, driverName, eta) => ({
    type: "driver_arriving",
    title: "⏰ Driver Arriving Soon",
    message: `${driverName} is ${eta} minutes away from pickup location`,
    data: { deliveryId, driverName, eta },
  }),

  PACKAGE_PICKED_UP: (deliveryId, driverName) => ({
    type: "package_picked_up",
    title: "📦 Package Picked Up",
    message: `${driverName} has picked up your package and is heading to the destination`,
    data: { deliveryId, driverName },
  }),

  DRIVER_NEARBY_DROPOFF: (deliveryId, eta) => ({
    type: "driver_nearby_dropoff",
    title: "📍 Driver Nearby",
    message: `Your driver will arrive at the dropoff location in ${eta} minutes`,
    data: { deliveryId, eta },
  }),

  DELIVERY_COMPLETED: (deliveryId, referenceId) => ({
    type: "delivery_completed",
    title: "🎉 Delivery Completed!",
    message: `Your delivery ${referenceId} has been completed successfully. Rate your experience!`,
    data: { deliveryId, referenceId, requestRating: true },
  }),

  PAYMENT_REQUIRED: (deliveryId, amount, driverName, companyName) => ({
    type: "payment_required",
    title: "💳 Payment Required",
    message: `Driver ${driverName} has accepted your delivery. Please complete payment of ₦${amount.toLocaleString()} to ${companyName}`,
    data: { 
      deliveryId, 
      amount, 
      driverName,
      companyName,
      requiresPayment: true 
    },
  }),

  DELIVERY_CANCELLED: (deliveryId, reason) => ({
    type: "delivery_cancelled",
    title: "❌ Delivery Cancelled",
    message: `Your delivery has been cancelled. ${reason ? `Reason: ${reason}` : ''}`,
    data: { deliveryId, reason },
  }),

  // Driver notifications
  NEW_DELIVERY_REQUEST: (deliveryId, distance, fare) => ({
    type: "new_delivery_request",
    title: "📦 New Delivery Request",
    message: `New delivery available ${distance.toFixed(1)}km away. Fare: ₦${fare.toLocaleString()}`,
    data: { deliveryId, distance, fare },
  }),

  DELIVERY_ACCEPTED_SUCCESS: (deliveryId, customerName) => ({
    type: "delivery_accepted",
    title: "✅ Delivery Accepted",
    message: `You've accepted a delivery from ${customerName}. Proceed to pickup location.`,
    data: { deliveryId, customerName },
  }),

  CUSTOMER_CANCELLED: (deliveryId, reason) => ({
    type: "customer_cancelled",
    title: "❌ Customer Cancelled",
    message: `The customer has cancelled the delivery. ${reason ? `Reason: ${reason}` : ''}`,
    data: { deliveryId, reason },
  }),

  PAYMENT_RECEIVED: (deliveryId, amount) => ({
    type: "payment_received",
    title: "💰 Payment Received",
    message: `Payment of ₦${amount.toLocaleString()} has been received for this delivery`,
    data: { deliveryId, amount },
  }),

  RATING_RECEIVED: (deliveryId, rating, review) => ({
    type: "rating_received",
    title: "⭐ New Rating",
    message: `You received a ${rating}-star rating${review ? ` with review: "${review}"` : ''}`,
    data: { deliveryId, rating, review },
  }),

  ACCOUNT_VERIFIED: (driverId) => ({
    type: "account_verified",
    title: "✅ Account Verified",
    message: "Your driver account has been verified and approved. You can now go online!",
    data: { driverId },
  }),

  ACCOUNT_SUSPENDED: (driverId, reason) => ({
    type: "account_suspended",
    title: "⚠️ Account Suspended",
    message: `Your account has been suspended. Reason: ${reason}`,
    data: { driverId, reason },
  }),

  ACCOUNT_REACTIVATED: (driverId) => ({
    type: "account_reactivated",
    title: "✅ Account Reactivated",
    message: "Your account has been reactivated. Welcome back!",
    data: { driverId },
  }),

  // Company notifications
  NEW_DRIVER_REQUEST: (driverId, driverName) => ({
    type: "new_driver_request",
    title: "👤 New Driver Request",
    message: `${driverName} has requested to join your company`,
    data: { driverId, driverName },
  }),

  DRIVER_DOCUMENT_UPLOADED: (driverId, driverName, documentType) => ({
    type: "driver_document_uploaded",
    title: "📄 Document Uploaded",
    message: `${driverName} has uploaded ${documentType} for verification`,
    data: { driverId, driverName, documentType },
  }),

  DELIVERY_MILESTONE: (totalDeliveries) => ({
    type: "delivery_milestone",
    title: "🎯 Milestone Achieved!",
    message: `Your company has completed ${totalDeliveries} deliveries!`,
    data: { totalDeliveries },
  }),
};

/**
 * Send bulk notifications to multiple users
 */
export const sendBulkNotifications = async (notifications) => {
  try {
    const results = await Promise.allSettled(
      notifications.map(notification => sendNotification(notification))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`✅ Sent ${successful}/${notifications.length} bulk notifications`);
    
    return results;
  } catch (error) {
    console.error("❌ Send bulk notifications error:", error);
    return [];
  }
};

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (notificationId) => {
  try {
    await Notification.findByIdAndUpdate(notificationId, { isRead: true });
    return true;
  } catch (error) {
    console.error("❌ Mark notification as read error:", error);
    return false;
  }
};

/**
 * Mark all notifications as read for a user
 */
export const markAllNotificationsAsRead = async (userId) => {
  try {
    await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );
    return true;
  } catch (error) {
    console.error("❌ Mark all notifications as read error:", error);
    return false;
  }
};

/**
 * Get unread notification count
 */
export const getUnreadCount = async (userId) => {
  try {
    const count = await Notification.countDocuments({ userId, isRead: false });
    return count;
  } catch (error) {
    console.error("❌ Get unread count error:", error);
    return 0;
  }
};

/**
 * Delete old notifications (cleanup job)
 */
export const deleteOldNotifications = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoffDate },
      isRead: true,
    });
    
    console.log(`🧹 Deleted ${result.deletedCount} old notifications`);
    return result.deletedCount;
  } catch (error) {
    console.error("❌ Delete old notifications error:", error);
    return 0;
  }
};