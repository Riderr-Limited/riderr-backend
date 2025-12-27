import express from 'express';
import {
  signUp,
  signIn,
  verifyEmail, // Removed verifyPhone
  resendVerification,
  refreshToken,
  logout,
  getMe,
  debugUser,
  checkVerificationStatus,
  testEndpoint,
  resetPasswordAdmin
} from '../controllers/auth.controller.js';
import authorize from '../middlewares/authorize.js';

const router = express.Router();

// Test endpoint
router.get('/test', testEndpoint);

// Public routes
router.post('/signup', signUp);
router.post('/login', signIn);
router.post('/verify-email', verifyEmail); // Only email verification
router.post('/resend-verification', resendVerification);
router.post('/refresh', refreshToken);
router.post('/debug-user', debugUser); // Debug endpoint
router.post('/check-verification', checkVerificationStatus); // Debug endpoint
// In your auth.routes.js
router.post('/reset-password-admin', resetPasswordAdmin);
// Protected routes
router.post('/logout', authorize, logout);
router.get('/me', authorize, getMe);

export default router;