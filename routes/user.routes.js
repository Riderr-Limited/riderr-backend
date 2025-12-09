import express from "express";
import { 
  getMyProfile,
  updateMyProfile,
  changePassword,
  createRider,
  getCompanyRiders,
  getUserById,
  deleteRider,
  getAllUsers,
  updateUserStatus
} from "../controllers/user.controller.js";
import authorize from "../middlewares/authorize.js";
import authorizeRole from "../middlewares/authorizeRole.js";

const router = express.Router();

// Apply authorization middleware to all user routes
router.use(authorize);

// ================== PROFILE ROUTES (All authenticated users) ==================

/**
 * @route   GET /api/users/me
 * @desc    Get current user's profile
 * @access  Private
 */
router.get("/me", getMyProfile);

/**
 * @route   PATCH /api/users/me
 * @desc    Update current user's profile
 * @access  Private
 */
router.patch("/me", updateMyProfile);

/**
 * @route   PUT /api/users/me/password
 * @desc    Change current user's password
 * @access  Private
 */
router.put("/me/password", changePassword);

/**
 * @route   POST /api/users/me/avatar
 * @desc    Upload user avatar
 * @access  Private
 */
router.post("/me/avatar", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Avatar upload endpoint"
  });
});

// ================== USER MANAGEMENT ROUTES ==================

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private
 * @note    Admin can view anyone, company_admin can view their company users, users can view themselves
 */
router.get("/:id", getUserById);

// ================== COMPANY ADMIN ROUTES ==================

/**
 * @route   POST /api/users/companies/:companyId/riders
 * @desc    Create a new rider for a company
 * @access  Private (company_admin only)
 */
router.post(
  "/companies/:companyId/riders",
  authorizeRole(["company_admin"]),
  createRider
);

/**
 * @route   GET /api/users/companies/:companyId/riders
 * @desc    Get all riders for a company
 * @access  Private (company_admin only)
 */
router.get(
  "/companies/:companyId/riders",
  authorizeRole(["company_admin"]),
  getCompanyRiders
);

/**
 * @route   DELETE /api/users/companies/:companyId/riders/:riderId
 * @desc    Deactivate a rider
 * @access  Private (company_admin only)
 */
router.delete(
  "/companies/:companyId/riders/:riderId",
  authorizeRole(["company_admin"]),
  deleteRider
);

// ================== ADMIN-ONLY ROUTES ==================

/**
 * @route   GET /api/users
 * @desc    Get all users (with pagination, filtering, sorting)
 * @access  Private (admin only)
 */
router.get(
  "/",
  authorizeRole(["admin"]),
  getAllUsers
);

/**
 * @route   PATCH /api/users/:id/status
 * @desc    Update user status (isActive, isVerified)
 * @access  Private (admin only)
 */
router.patch(
  "/:id/status",
  authorizeRole(["admin"]),
  updateUserStatus
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Deactivate user account
 * @access  Private (admin only)
 */
router.delete(
  "/:id",
  authorizeRole(["admin"]),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "User deactivation endpoint"
    });
  }
);

/**
 * @route   GET /api/users/stats/overview
 * @desc    Get user statistics overview
 * @access  Private (admin only)
 */
router.get(
  "/stats/overview",
  authorizeRole(["admin"]),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "User statistics endpoint",
      data: {
        totalUsers: 0,
        activeUsers: 0,
        newUsersToday: 0,
        userDistribution: {
          customer: 0,
          rider: 0,
          company_admin: 0,
          admin: 0
        }
      }
    });
  }
);

export default router;