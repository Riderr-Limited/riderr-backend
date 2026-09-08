// utils/notification.helper.js

import { sendNotification } from "./notification.js";
import User from "../models/user.models.js";

/**
 * Create a notification for a specific user
 */
export const createUserNotification = async ({
  userId,
  title,
  message,
  type = 'system',
  subType,
  priority = 'medium',
  actionUrl,
  actionLabel,
  data = {}
}) => {
  return sendNotification({ userId, title, message, type, subType, priority, actionUrl, actionLabel, data });
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
  priority = 'medium',
  actionUrl,
  actionLabel,
  data = {}
}) => {
  const companyAdmins = await User.find({ companyId, role: 'company_admin', isActive: true }).select('_id');
  if (!companyAdmins.length) return [];
  return Promise.all(
    companyAdmins.map(admin =>
      sendNotification({ userId: admin._id, title, message, type, subType, priority, actionUrl, actionLabel, data: { ...data, companyId } })
    )
  );
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
  priority = 'medium',
  actionUrl,
  actionLabel,
  data = {}
}) => {
  return sendNotification({ userId: driverId, title, message, type, subType, priority, actionUrl, actionLabel, data: { ...data, companyId } });
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

export { markNotificationAsRead, markAllNotificationsAsRead, getUnreadCount, deleteOldNotifications as cleanupOldNotifications } from "./notification.js";

export default {
  createUserNotification,
  createCompanyNotification,
  createDriverNotification,
  notifyDriverApproval,
  notifyNewDriverRequest,
  notifyDriverSuspension,
  notifyDriverActivation,
};