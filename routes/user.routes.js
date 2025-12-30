// routes/user.routes.js
import express from "express";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  deactivateAccount,
  reactivateAccount,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getUserPreferences,
  updateUserPreferences,
  getUserActivity,
  getCompanyDrivers,
  createCompanyDriver,
  updateDriverStatus,
  getDriverDetails,
  getAllUsers,
  updateUser,
  deleteUser
} from "../controllers/user.controller.js";
import  authenticate  from "../middlewares/authenticate.js";
import { validateUpdateProfile, validateCreateDriver } from "../middlewares/validation.middleware.js";

const router = express.Router();

// ==================== PUBLIC ROUTES ====================
router.post("/reactivate", reactivateAccount);

// ==================== authenticateED ROUTES ====================
// Apply authentication middleware to all routes below
router.use(authenticate);

// User Profile Routes
router.get("/profile", getUserProfile);
router.put("/profile", validateUpdateProfile, updateUserProfile);
router.put("/change-password", changePassword);
router.delete("/deactivate", deactivateAccount);

// User Preferences Routes
router.get("/preferences", getUserPreferences);
router.put("/preferences", updateUserPreferences);

// Notification Routes
router.get("/notifications", getUserNotifications);
router.put("/notifications/:notificationId/read", markNotificationAsRead);
router.put("/notifications/read-all", markAllNotificationsAsRead);
router.delete("/notifications/:notificationId", deleteNotification);

// Activity Log Routes
router.get("/activity", getUserActivity);

// ==================== COMPANY ADMIN ROUTES ====================
// Company Drivers Management
router.get("/companies/:companyId/drivers", getCompanyDrivers);
router.post("/companies/:companyId/drivers", validateCreateDriver, createCompanyDriver);
router.get("/companies/:companyId/drivers/:driverId", getDriverDetails);
router.put("/companies/:companyId/drivers/:driverId/status", updateDriverStatus);

// ==================== ADMIN ROUTES ====================
// User Management (Admin only)
router.get("/", getAllUsers);
router.put("/:userId", updateUser);
router.delete("/:userId", deleteUser);

export default router;