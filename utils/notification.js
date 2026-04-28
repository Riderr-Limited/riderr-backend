import Notification from "../models/notification.model.js";
import User from "../models/user.models.js";
import Expo from "expo-server-sdk";

const expo = new Expo();

/**
 * Save notification to DB and optionally send push
 */
export const sendNotification = async ({
  userId,
  type = "system",
  subType,
  title,
  message,
  data = {},
  priority = "medium",
  actionUrl = null,
  actionLabel = null,
  sendPush = true,
}) => {
  try {
    const notification = await Notification.create({
      userId,
      type,
      subType,
      title,
      message,
      data,
      priority,
      actionUrl,
      actionLabel,
      read: false,
    });

    if (sendPush) {
      const user = await User.findById(userId).select("pushToken deviceTokens notificationSettings");
      const tokens = [
        ...(user?.pushToken ? [user.pushToken] : []),
        ...(user?.deviceTokens || []),
      ].filter((t, i, arr) => arr.indexOf(t) === i); // dedupe

      if (tokens.length && user?.notificationSettings?.pushEnabled !== false) {
        await sendPushNotification({ tokens, title, body: message, data: { ...data, notificationId: notification._id.toString() } });

        await Notification.findByIdAndUpdate(notification._id, {
          "deliveryMethods.push.sent": true,
          "deliveryMethods.push.sentAt": new Date(),
        });
      }
    }

    return notification;
  } catch (error) {
    console.error("❌ sendNotification error:", error);
    return null;
  }
};

const sendPushNotification = async ({ tokens, title, body, data = {} }) => {
  try {
    const validTokens = tokens.filter(t => Expo.isExpoPushToken(t));
    if (!validTokens.length) return;

    const messages = validTokens.map(token => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
      channelId: "default",
    }));

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    // Log any errors from Expo
    tickets.forEach((ticket, i) => {
      if (ticket.status === "error") {
        console.error(`❌ Push error for token ${validTokens[i]}:`, ticket.message);
        // If token is invalid, it should be removed from the user — handle in cleanup
      }
    });

    return tickets;
  } catch (error) {
    console.error("❌ Push error:", error);
    return null;
  }
};

export const sendBulkNotifications = async (notifications) => {
  const results = await Promise.allSettled(
    notifications.map((n) => sendNotification(n))
  );
  return results;
};

export const markNotificationAsRead = async (notificationId) => {
  try {
    await Notification.findByIdAndUpdate(notificationId, {
      $set: { read: true, readAt: new Date() },
    });
    return true;
  } catch (error) {
    console.error("❌ markNotificationAsRead error:", error);
    return false;
  }
};

export const markAllNotificationsAsRead = async (userId) => {
  try {
    await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    return true;
  } catch (error) {
    console.error("❌ markAllNotificationsAsRead error:", error);
    return false;
  }
};

export const getUnreadCount = async (userId) => {
  try {
    return await Notification.countDocuments({ userId, read: false });
  } catch (error) {
    console.error("❌ getUnreadCount error:", error);
    return 0;
  }
};

export const deleteOldNotifications = async (daysOld = 30) => {
  try {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await Notification.deleteMany({
      read: true,
      createdAt: { $lt: cutoff },
    });
    return result.deletedCount;
  } catch (error) {
    console.error("❌ deleteOldNotifications error:", error);
    return 0;
  }
};

// Notification templates
export const NotificationTemplates = {
  // ── Customer ──────────────────────────────────────────
  DELIVERY_CREATED: (deliveryId, referenceId) => ({
    type: "delivery", subType: "delivery_request",
    title: "📦 Delivery Request Created",
    message: `Your delivery ${referenceId} has been created. Looking for nearby drivers...`,
    data: { deliveryId, referenceId },
    actionUrl: `/deliveries/${deliveryId}`, actionLabel: "View Delivery",
  }),

  DRIVER_ASSIGNED: (deliveryId, driverName, estimatedTime) => ({
    type: "delivery", subType: "delivery_accepted",
    title: "🚗 Driver Assigned!",
    message: `${driverName} will pick up your package in ~${estimatedTime} minutes`,
    data: { deliveryId, driverName, estimatedTime },
    actionUrl: `/deliveries/${deliveryId}`, actionLabel: "Track Delivery",
  }),

  PACKAGE_PICKED_UP: (deliveryId, driverName) => ({
    type: "delivery", subType: "delivery_picked_up",
    title: "📦 Package Picked Up",
    message: `${driverName} has picked up your package and is heading to the destination`,
    data: { deliveryId, driverName },
    actionUrl: `/deliveries/${deliveryId}`, actionLabel: "Track Delivery",
  }),

  DELIVERY_COMPLETED: (deliveryId, referenceId) => ({
    type: "delivery", subType: "delivery_completed",
    title: "🎉 Delivery Completed!",
    message: `Your delivery ${referenceId} has been completed. Rate your experience!`,
    data: { deliveryId, referenceId, requestRating: true },
    actionUrl: `/deliveries/${deliveryId}`, actionLabel: "Rate Delivery",
    priority: "high",
  }),

  DELIVERY_CANCELLED: (deliveryId, reason) => ({
    type: "delivery", subType: "delivery_cancelled",
    title: "❌ Delivery Cancelled",
    message: `Your delivery has been cancelled.${reason ? ` Reason: ${reason}` : ""}`,
    data: { deliveryId, reason },
    priority: "high",
  }),

  PAYMENT_REQUIRED: (deliveryId, amount, driverName, companyName) => ({
    type: "payment", subType: "payment_success",
    title: "💳 Payment Required",
    message: `${driverName} accepted your delivery. Pay ₦${amount.toLocaleString()} to ${companyName}`,
    data: { deliveryId, amount, driverName, companyName, requiresPayment: true },
    actionUrl: `/deliveries/${deliveryId}/pay`, actionLabel: "Pay Now",
    priority: "high",
  }),

  PAYMENT_SUCCESS: (deliveryId, amount) => ({
    type: "payment", subType: "payment_success",
    title: "✅ Payment Successful",
    message: `Payment of ₦${amount.toLocaleString()} was successful`,
    data: { deliveryId, amount },
    actionUrl: `/deliveries/${deliveryId}`, actionLabel: "View Delivery",
  }),

  PAYMENT_FAILED: (deliveryId, amount) => ({
    type: "payment", subType: "payment_failed",
    title: "❌ Payment Failed",
    message: `Payment of ₦${amount.toLocaleString()} failed. Please try again`,
    data: { deliveryId, amount },
    actionUrl: `/deliveries/${deliveryId}/pay`, actionLabel: "Retry Payment",
    priority: "high",
  }),

  PAYMENT_REFUNDED: (deliveryId, amount) => ({
    type: "payment", subType: "payment_refunded",
    title: "💰 Refund Processed",
    message: `A refund of ₦${amount.toLocaleString()} has been processed`,
    data: { deliveryId, amount },
  }),

  // ── Driver ────────────────────────────────────────────
  NEW_DELIVERY_REQUEST: (deliveryId, distance, fare) => ({
    type: "delivery", subType: "delivery_request",
    title: "📦 New Delivery Request",
    message: `New delivery ${distance.toFixed(1)}km away. Fare: ₦${fare.toLocaleString()}`,
    data: { deliveryId, distance, fare },
    actionUrl: `/driver/deliveries/${deliveryId}`, actionLabel: "View Request",
    priority: "high",
  }),

  PAYMENT_RECEIVED: (deliveryId, amount) => ({
    type: "payment", subType: "payout_processed",
    title: "💰 Payment Received",
    message: `Payment of ₦${amount.toLocaleString()} received for this delivery`,
    data: { deliveryId, amount },
  }),

  RATING_RECEIVED: (deliveryId, rating, review) => ({
    type: "driver", subType: "rating_received",
    title: "⭐ New Rating",
    message: `You received a ${rating}-star rating${review ? `: "${review}"` : ""}`,
    data: { deliveryId, rating, review },
  }),

  ACCOUNT_VERIFIED: (driverId) => ({
    type: "driver", subType: "driver_approved",
    title: "✅ Account Verified",
    message: "Your driver account has been verified. You can now go online!",
    data: { driverId },
    actionUrl: "/driver/dashboard", actionLabel: "Go Online",
    priority: "high",
  }),

  ACCOUNT_SUSPENDED: (driverId, reason) => ({
    type: "driver", subType: "driver_suspended",
    title: "⚠️ Account Suspended",
    message: `Your account has been suspended. Reason: ${reason}`,
    data: { driverId, reason },
    actionUrl: "/driver/support", actionLabel: "Contact Support",
    priority: "urgent",
  }),

  ACCOUNT_REACTIVATED: (driverId) => ({
    type: "driver", subType: "new_assignment",
    title: "✅ Account Reactivated",
    message: "Your account has been reactivated. Welcome back!",
    data: { driverId },
    actionUrl: "/driver/dashboard", actionLabel: "Go to Dashboard",
    priority: "high",
  }),

  // ── Company ───────────────────────────────────────────
  NEW_DRIVER_REQUEST: (driverId, driverName) => ({
    type: "company", subType: "driver_application",
    title: "👤 New Driver Request",
    message: `${driverName} has requested to join your company`,
    data: { driverId, driverName },
    actionUrl: `/company/drivers/${driverId}`, actionLabel: "Review Request",
    priority: "high",
  }),

  COMPANY_APPROVED: () => ({
    type: "company", subType: "company_approved",
    title: "✅ Company Approved",
    message: "Your company has been approved and is now active",
    priority: "high",
    actionUrl: "/company/dashboard", actionLabel: "Go to Dashboard",
  }),

  COMPANY_SUSPENDED: (reason) => ({
    type: "company", subType: "company_suspended",
    title: "⚠️ Company Suspended",
    message: `Your company has been suspended. Reason: ${reason}`,
    priority: "urgent",
    actionUrl: "/company/support", actionLabel: "Contact Support",
  }),

  BANK_DETAILS_APPROVED: () => ({
    type: "company", subType: "company_approved",
    title: "✅ Bank Details Approved",
    message: "Your company bank details have been verified and approved",
    priority: "high",
  }),

  // ── Security ──────────────────────────────────────────
  PASSWORD_RESET: () => ({
    type: "security", subType: "password_changed",
    title: "🔐 Password Reset",
    message: "Your password has been reset by an administrator",
    priority: "high",
  }),

  ACCOUNT_UPDATED: (fields) => ({
    type: "security", subType: "new_device",
    title: "📝 Account Updated",
    message: "Your account has been updated by an administrator",
    data: { updatedFields: fields },
  }),

  CUSTOMER_CANCELLED: (deliveryId, reason) => ({
    type: "delivery", subType: "delivery_cancelled",
    title: "🚫 Delivery Cancelled",
    message: `The customer has cancelled the delivery. Reason: ${reason}`,
    data: { deliveryId, reason },
    priority: "high",
  }),

  // ── Ride ──────────────────────────────────────────────
  RIDE_ACCEPTED: (rideId, driverName) => ({
    type: "delivery", subType: "delivery_accepted",
    title: "🚗 Driver On The Way!",
    message: `${driverName} has accepted your ride and is heading to your pickup location`,
    data: { rideId, driverName },
    actionUrl: `/rides/${rideId}`, actionLabel: "Track Ride",
    priority: "high",
  }),

  RIDE_ARRIVED: (rideId, driverName) => ({
    type: "delivery", subType: "delivery_accepted",
    title: "📍 Driver Arrived!",
    message: `${driverName} has arrived at your pickup location`,
    data: { rideId, driverName },
    actionUrl: `/rides/${rideId}`, actionLabel: "View Ride",
    priority: "high",
  }),

  RIDE_STARTED: (rideId) => ({
    type: "delivery", subType: "delivery_picked_up",
    title: "🚀 Ride Started",
    message: "Your ride has started. Enjoy your trip!",
    data: { rideId },
    actionUrl: `/rides/${rideId}`, actionLabel: "Track Ride",
  }),

  RIDE_COMPLETED: (rideId, fare) => ({
    type: "delivery", subType: "delivery_completed",
    title: "🎉 Ride Completed!",
    message: `Your ride has been completed. Total fare: ₦${fare.toLocaleString()}. Please rate your experience!`,
    data: { rideId, fare, requestRating: true },
    actionUrl: `/rides/${rideId}`, actionLabel: "Rate Ride",
    priority: "high",
  }),

  RIDE_CANCELLED: (rideId, cancelledBy, reason) => ({
    type: "delivery", subType: "delivery_cancelled",
    title: "❌ Ride Cancelled",
    message: `Your ride has been cancelled by the ${cancelledBy}.${reason ? ` Reason: ${reason}` : ""}`,
    data: { rideId, cancelledBy, reason },
    priority: "high",
  }),

  NEW_RIDE_REQUEST: (rideId, pickupAddress) => ({
    type: "delivery", subType: "delivery_request",
    title: "🚗 New Ride Request",
    message: `New ride request from ${pickupAddress}`,
    data: { rideId, pickupAddress },
    actionUrl: `/driver/rides/${rideId}`, actionLabel: "View Request",
    priority: "high",
  }),

  // ── Chat ──────────────────────────────────────────────
  NEW_CHAT_MESSAGE: (senderName, deliveryId, preview) => ({
    type: "system", subType: "alert",
    title: `💬 ${senderName}`,
    message: preview || "You have a new message",
    data: { deliveryId, senderName },
    actionUrl: `/deliveries/${deliveryId}/chat`, actionLabel: "View Message",
  }),

  // ── Support ───────────────────────────────────────────
  SUPPORT_TICKET_CREATED: (ticketId) => ({
    type: "support", subType: "alert",
    title: "🎫 Support Ticket Created",
    message: `Your support ticket #${ticketId} has been created. We'll get back to you shortly.`,
    data: { ticketId },
    actionUrl: `/support/${ticketId}`, actionLabel: "View Ticket",
  }),

  SUPPORT_TICKET_UPDATED: (ticketId, status) => ({
    type: "support", subType: "alert",
    title: "🎫 Support Ticket Updated",
    message: `Your support ticket #${ticketId} status has been updated to: ${status}`,
    data: { ticketId, status },
    actionUrl: `/support/${ticketId}`, actionLabel: "View Ticket",
  }),

  SUPPORT_NEW_MESSAGE: (ticketId, senderName) => ({
    type: "support", subType: "alert",
    title: `💬 New message on ticket #${ticketId}`,
    message: `${senderName} replied to your support ticket`,
    data: { ticketId, senderName },
    actionUrl: `/support/${ticketId}`, actionLabel: "View Reply",
  }),
};
