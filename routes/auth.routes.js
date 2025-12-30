// routes/auth.routes.js (with validation)
import express from "express";
import {
  signUp,
  signUpCompanyDriver,
  signIn,
  verifyEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  resendVerification,
  refreshToken,
  logout,
  getMe,
  updateProfile,
  testEndpoint,
  checkVerificationStatus
} from "../controllers/auth.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import {
  validateSignup,
  validateLogin,
  validateVerifyEmail,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateResendVerification,
  validateRefreshToken,
  validateSignUpCompanyDriver
} from "../middlewares/validation.middleware.js";

const router = express.Router();

// ==================== PUBLIC ROUTES ====================

// Health check
router.get("/test", testEndpoint);

// Verification status
router.get("/check-verification", checkVerificationStatus);

// Registration & Login
router.post("/signup", validateSignup, signUp);
router.post("/login", validateLogin, signIn);

// Email verification
router.post("/verify-email", validateVerifyEmail, verifyEmail);
router.post("/resend-verification", validateResendVerification, resendVerification);

// Password recovery
router.post("/forgot-password", validateForgotPassword, forgotPassword);
router.post("/reset-password", validateResetPassword, resetPassword);

// Token refresh
router.post("/refresh", validateRefreshToken, refreshToken);

// ==================== PROTECTED ROUTES ====================
router.use(protect);

// User profile (all authenticated users)
router.get("/me", getMe);
router.put("/profile", updateProfile);
router.post("/change-password", validateChangePassword, changePassword);
router.post("/logout", logout);

// Company admin specific routes
router.post("/signup-company-driver", 
  authorize('company_admin'),
  validateSignUpCompanyDriver,
  signUpCompanyDriver
);

export default router;