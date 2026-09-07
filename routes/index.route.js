 // routes/index.route.js
import express from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import deliveryRoutes from "./delivery.routes.js";
import rideRoutes from "./ride.routes.js";
import driverRoutes from "./driver.routes.js";
import companyRoutes from "./company.routes.js";
import paymentRoutes from "./payment.routes.js";
import notificationRoutes from "./notification.routes.js";
import chatRoutes from "./chat.routes.js";
import voiceCallRoutes from "./voiceCall.routes.js";
import supportTicketRoutes from "./supportTicket.routes.js";
import adminChatRoutes from "./adminChat.routes.js";
import contactRoutes from "./contact.routes.js";
import adminRoutes from "./admin.routes.js";
import rescueRoutes from "./rescue.routes.js";
import riderRoutes from "./rider.routes.js";
import podRoutes from "./pod.routes.js";
import errandRoutes from "./errand.routes.js";
import companyDashboardRoutes from "./companyDashboard.routes.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { getActiveCompanies } from "../controllers/company.controller.js";

const router = express.Router();

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is healthy and running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

/**
 * @route   GET /api
 * @desc    API information
 * @access  Public
 */
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Delivery & Ride Service API",
    version: "1.0.0",
    endpoints: {
      // ... your endpoints documentation
    },
    documentation: "https://api-docs.example.com",
  });
});

// ============ MOUNT ALL ROUTES HERE ============
// Mount route modules BEFORE the 404 handler

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/deliveries", deliveryRoutes);
router.use("/rides", rideRoutes);
router.use("/driver", driverRoutes);
router.use("/company", companyRoutes);
router.use("/payments", paymentRoutes);
router.use("/notifications", notificationRoutes);
router.use("/chat", chatRoutes);
router.use("/voice-call", voiceCallRoutes);
router.use("/v1/support", supportTicketRoutes);
router.use("/rescue", rescueRoutes);
router.use("/rider", riderRoutes);

// Public companies list — for customer to pick a company before creating order
router.get("/companies", authenticate, getActiveCompanies);

router.use("/pod", podRoutes);
router.use("/errands", errandRoutes);
router.use("/company-dashboard", companyDashboardRoutes);

// Admin routes
router.use("/admin", adminRoutes);

// Admin chat routes
router.use("/admin-chat", adminChatRoutes);

// Contact form routes
router.use("/contact", contactRoutes);

// ============ 404 HANDLER (MUST BE LAST) ============
/**
 * @route   ALL *
 * @desc    404 handler for undefined API routes
 * @access  Public
 */
router.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

export default router;