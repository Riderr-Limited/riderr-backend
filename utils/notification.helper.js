// utils/notification.helper.js

import Notification from "../models/notificaton.models.js";
import User from "../models/user.models.js";

/**
 * Create a notification for a specific user
 */
export const createUserNotification = async ({
  userId,
  title,
  message,
  type = 'info',
  subType,
  priority = 'normal',
  actionUrl,
  actionLabel,
  data = {}
}) => {
  try {
    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      subType,
      priority,
      actionUrl,
      actionLabel,
      data,
      read: false,
      createdAt: new Date()
    });

    console.log('✅ User notification created:', notification._id);
    return notification;
  } catch (error) {
    console.error('❌ Error creating user notification:', error);
    throw error;
  }
};

/**
 * Create a notification for all company admins
 */
export const createCompanyNotification = async ({
  companyId,
  title,
  message,
  type = 'company',
  subType,
  priority = 'normal',
  actionUrl,
  actionLabel,
  data = {}
}) => {
  try {
    // Get all company admins
    const companyAdmins = await User.find({
      companyId,
      role: 'company_admin',
      isActive: true
    }).select('_id');

    if (companyAdmins.length === 0) {
      console.warn('⚠️ No active company admins found for company:', companyId);
      return [];
    }

    // Create notifications for all admins
    const notifications = await Promise.all(
      companyAdmins.map(admin => 
        Notification.create({
          userId: admin._id,
          companyId, // Store companyId directly
          title,
          message,
          type,
          subType,
          priority,
          actionUrl,
          actionLabel,
          data: {
            ...data,
            companyId // Also store in data for flexibility
          },
          read: false,
          createdAt: new Date()
        })
      )
    );

    console.log(`✅ Created ${notifications.length} company notifications`);
    return notifications;
  } catch (error) {
    console.error('❌ Error creating company notification:', error);
    throw error;
  }
};

/**
 * Create notification for a driver
 */
export const createDriverNotification = async ({
  driverId,
  companyId,
  title,
  message,
  type = 'driver',
  subType,
  priority = 'normal',
  actionUrl,
  actionLabel,
  data = {}
}) => {
  try {
    const notification = await Notification.create({
      userId: driverId,
      companyId,
      title,
      message,
      type,
      subType,
      priority,
      actionUrl,
      actionLabel,
      data: {
        ...data,
        companyId
      },
      read: false,
      createdAt: new Date()
    });

    console.log('✅ Driver notification created:', notification._id);
    return notification;
  } catch (error) {
    console.error('❌ Error creating driver notification:', error);
    throw error;
  }
};

/**
 * Create notification for driver approval
 */
export const notifyDriverApproval = async (driverId, companyId, approved = true) => {
  const title = approved ? 'Document Approved' : 'Document Rejected';
  const message = approved 
    ? 'Your document has been approved by the company' 
    : 'Your document has been rejected. Please upload a new one';

  return createDriverNotification({
    driverId,
    companyId,
    title,
    message,
    type: 'driver',
    subType: approved ? 'document_approved' : 'document_rejected',
    priority: 'high',
    actionUrl: '/driver/documents',
    actionLabel: 'View Documents'
  });
};

/**
 * Create notification for new driver request
 */
export const notifyNewDriverRequest = async (companyId, driverName, driverId) => {
  return createCompanyNotification({
    companyId,
    title: 'New Driver Request',
    message: `${driverName} has requested to join your company`,
    type: 'company',
    subType: 'driver_request',
    priority: 'high',
    actionUrl: `/company/driver-requests/${driverId}`,
    actionLabel: 'Review Request',
    data: {
      driverId,
      driverName
    }
  });
};

/**
 * Create notification for driver suspension
 */
export const notifyDriverSuspension = async (driverId, companyId, reason) => {
  return createDriverNotification({
    driverId,
    companyId,
    title: 'Account Suspended',
    message: `Your account has been suspended. Reason: ${reason}`,
    type: 'driver',
    subType: 'account_suspended',
    priority: 'urgent',
    actionUrl: '/driver/support',
    actionLabel: 'Contact Support'
  });
};

/**
 * Create notification for driver activation
 */
export const notifyDriverActivation = async (driverId, companyId) => {
  return createDriverNotification({
    driverId,
    companyId,
    title: 'Account Activated',
    message: 'Your account has been activated. You can now start accepting deliveries',
    type: 'driver',
    subType: 'account_activated',
    priority: 'high',
    actionUrl: '/driver/dashboard',
    actionLabel: 'Go to Dashboard'
  });
};

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (notificationId) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      {
        read: true,
        readAt: new Date()
      },
      { new: true }
    );

    return notification;
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 */
export const markAllNotificationsAsRead = async (userId) => {
  try {
    const result = await Notification.updateMany(
      { userId, read: false },
      {
        read: true,
        readAt: new Date()
      }
    );

    return result;
  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
    throw error;
  }
};

/**
 * Get unread notification count for a user
 */
export const getUnreadCount = async (userId) => {
  try {
    const count = await Notification.countDocuments({
      userId,
      read: false
    });

    return count;
  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    return 0;
  }
};

/**
 * Delete old read notifications (cleanup)
 */
export const cleanupOldNotifications = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.deleteMany({
      read: true,
      readAt: { $lt: cutoffDate }
    });

    console.log(`🧹 Cleaned up ${result.deletedCount} old notifications`);
    return result;
  } catch (error) {
    console.error('❌ Error cleaning up notifications:', error);
    throw error;
  }
};

export default {
  createUserNotification,
  createCompanyNotification,
  createDriverNotification,
  notifyDriverApproval,
  notifyNewDriverRequest,
  notifyDriverSuspension,
  notifyDriverActivation,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadCount,
  cleanupOldNotifications
};