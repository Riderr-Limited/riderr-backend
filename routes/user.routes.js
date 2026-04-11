// routes/user.routes.js
/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User profile & management
 */
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
/**
 * @swagger
 * /users/reactivate:
 *   post:
 *     tags: [Users]
 *     summary: Reactivate a deactivated account
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Account reactivated
 */
router.post("/reactivate", reactivateAccount);

// ==================== authenticateED ROUTES ====================
router.use(authenticate);

/**
 * @swagger
 * /users/profile:
 *   get:
 *     tags: [Users]
 *     summary: Get current user profile
 *     responses:
 *       200:
 *         description: User profile
 *   put:
 *     tags: [Users]
 *     summary: Update current user profile
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               avatarUrl: { type: string }
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.get("/profile", getUserProfile);
router.put("/profile", validateUpdateProfile, updateUserProfile);

/**
 * @swagger
 * /users/change-password:
 *   put:
 *     tags: [Users]
 *     summary: Change password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password changed
 */
router.put("/change-password", changePassword);

/**
 * @swagger
 * /users/deactivate:
 *   delete:
 *     tags: [Users]
 *     summary: Deactivate own account
 *     responses:
 *       200:
 *         description: Account deactivated
 */
router.delete("/deactivate", deactivateAccount);

/**
 * @swagger
 * /users/preferences:
 *   get:
 *     tags: [Users]
 *     summary: Get user preferences
 *     responses:
 *       200:
 *         description: User preferences
 *   put:
 *     tags: [Users]
 *     summary: Update user preferences
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language: { type: string, enum: [en, yo, ig, ha] }
 *               notifications:
 *                 type: object
 *                 properties:
 *                   email: { type: boolean }
 *                   sms: { type: boolean }
 *                   push: { type: boolean }
 *     responses:
 *       200:
 *         description: Preferences updated
 */
router.get("/preferences", getUserPreferences);
router.put("/preferences", updateUserPreferences);

/**
 * @swagger
 * /users/notifications:
 *   get:
 *     tags: [Users]
 *     summary: Get user notifications (legacy)
 *     responses:
 *       200:
 *         description: Notifications list
 */
router.get("/notifications", getUserNotifications);
router.put("/notifications/:notificationId/read", markNotificationAsRead);
router.put("/notifications/read-all", markAllNotificationsAsRead);
router.delete("/notifications/:notificationId", deleteNotification);

/**
 * @swagger
 * /users/activity:
 *   get:
 *     tags: [Users]
 *     summary: Get user activity log
 *     responses:
 *       200:
 *         description: Activity log
 */
router.get("/activity", getUserActivity);

/**
 * @swagger
 * /users/companies/{companyId}/drivers:
 *   get:
 *     tags: [Users]
 *     summary: Get all drivers for a company (company_admin)
 *     parameters:
 *       - in: path
 *         name: companyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of drivers
 *   post:
 *     tags: [Users]
 *     summary: Create a driver under a company (company_admin)
 *     parameters:
 *       - in: path
 *         name: companyId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               password: { type: string }
 *     responses:
 *       201:
 *         description: Driver created
 */
router.get("/companies/:companyId/drivers", getCompanyDrivers);
router.post("/companies/:companyId/drivers", validateCreateDriver, createCompanyDriver);
router.get("/companies/:companyId/drivers/:driverId", getDriverDetails);
router.put("/companies/:companyId/drivers/:driverId/status", updateDriverStatus);

/**
 * @swagger
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: Get all users (admin only)
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [customer, driver, company_admin, admin] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of users
 */
router.get("/", getAllUsers);
router.put("/:userId", updateUser);
router.delete("/:userId", deleteUser);

export default router;