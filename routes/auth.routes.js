import express from "express";
import { signUp } from '../controllers/auth.controller.js';

const router = express.Router();

// General signup (for customers/admins)
router.post("/register", signUp);

// Company admin creates rider
router.post("/companies/:companyId/riders", signUp);

export default router;
