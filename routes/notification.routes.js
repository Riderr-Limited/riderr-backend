
// ============================================
// ROUTES FILE: routes/notification.routes.js
// ============================================

import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import {
  getNotifications,
  getUnreadNotificationCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  updatePushToken,
} from '../controllers/notification.controller.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Get notifications
router.get('/', getNotifications);

// Get unread count
router.get('/unread-count', getUnreadNotificationCount);

// Mark notification as read
router.put('/:notificationId/read', markAsRead);

// Mark all as read
router.put('/read-all', markAllAsRead);

// Delete notification
router.delete('/:notificationId', deleteNotification);

// Clear all read notifications
router.delete('/clear-read', clearReadNotifications);

// Update push token
router.put('/push-token', updatePushToken);

export default router;

// ============================================
// ADD TO YOUR MAIN APP FILE (server.js or app.js)
// ============================================

/*
import notificationRoutes from './routes/notification.routes.js';

// Add this with your other routes
app.use('/api/notifications', notificationRoutes);
*/