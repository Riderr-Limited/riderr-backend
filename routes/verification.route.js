import express from "express";
import {
  sendPhoneVerification,
  verifyPhone,
  sendEmailVerification,
  verifyEmail,
  resendVerification,
  checkVerificationStatus
} from "../controllers/verification.controller.js";
import authorize from "../middlewares/authorize.js";

const router = express.Router();

// Public routes
router.post("/send-phone", sendPhoneVerification);
router.post("/verify-phone", verifyPhone);
router.post("/send-email", sendEmailVerification);
router.post("/verify-email", verifyEmail);
router.post("/resend", resendVerification);

// Protected routes
router.post("/status", authorize, checkVerificationStatus);

export default router;