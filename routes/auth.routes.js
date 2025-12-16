import express from "express";
import { 
  signUp, 
  signIn, 
  refreshToken, 
  logout, 
  logoutAll,
  verifyEmail,
  resendVerification,
  checkVerificationStatus,
  getMe,
  testEndpoint,
  getDebugCode
} from "../controllers/auth.controller.js";
import authorize from "../middlewares/authorize.js";

const router = express.Router();

// ================== PUBLIC ROUTES ==================

/**
 * @route   GET /api/auth/test
 * @desc    Test endpoint
 * @access  Public
 */
router.get("/test", testEndpoint);

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post("/signup", signUp);

/**
 * @route   POST /api/auth/signup/company/:companyId
 * @desc    Register a new rider for a company
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
 * @access  Public
 */
router.post("/refresh", refreshToken);

/**
 * @route   POST /api/auth/verify-email
 * @desc    Verify email with code
 * @access  Public
 */
router.post("/verify-email", verifyEmail);

/**
 * @route   POST /api/auth/resend-verification
 * @desc    Resend verification code
 * @access  Public
 */
router.post("/resend-verification", resendVerification);

/**
 * @route   POST /api/auth/check-verification
 * @desc    Check verification status
 * @access  Public
 */
router.post("/check-verification", checkVerificationStatus);

/**
 * @route   POST /api/auth/debug-code
 * @desc    Get debug code (development only)
 * @access  Public
 */
router.post("/debug-code", getDebugCode);

// ================== PRIVATE ROUTES ==================

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get("/me", authorize, getMe);

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

export default router;