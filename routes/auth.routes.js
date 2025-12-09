import express from "express";
import { 
  signUp, 
  signIn, 
  refreshToken, 
  logout, 
  logoutAll 
} from "../controllers/auth.controller.js";
import authorize from "../middlewares/authorize.js";

const router = express.Router();

// ================== PUBLIC ROUTES ==================

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user (customer or company_admin)
 * @access  Public
 */
router.post("/signup", signUp);

/**
 * @route   POST /api/auth/signup/company/:companyId
 * @desc    Register a new rider for a specific company
 * @access  Public
 */
router.post("/signup/company/:companyId", signUp);

/**
 * @route   POST /api/auth/login
 * @desc    Login user with email/phone and password
 * @access  Public
 */
router.post("/login", signIn);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public (requires valid refresh token)
 */
router.post("/refresh", refreshToken);

// ================== PRIVATE ROUTES ==================

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (clear refresh token)
 * @access  Private
 */
router.post("/logout", authorize, logout);

/**
 * @route   POST /api/auth/logout-all
 * @desc    Logout from all devices
 * @access  Private
 */
router.post("/logout-all", authorize, logoutAll);

/**
 * @route   POST /api/auth/verify-email
 * @desc    Verify email address
 * @access  Private
 */
router.post("/verify-email", authorize, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Email verification endpoint"
  });
});

export default router;