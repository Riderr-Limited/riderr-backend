import express from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import deliveryRoutes from "./delivery.routes.js";

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
    memory: process.memoryUsage()
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
    message: "Delivery Service API",
    version: "1.0.0",
    endpoints: {
      auth: {
        signup: "POST /api/auth/signup",
        signupRider: "POST /api/auth/signup/company/:companyId",
        login: "POST /api/auth/login",
        refresh: "POST /api/auth/refresh",
        logout: "POST /api/auth/logout"
      },
      users: {
        getProfile: "GET /api/users/me",
        updateProfile: "PATCH /api/users/me",
        changePassword: "PUT /api/users/me/password",
        getUser: "GET /api/users/:id",
        getRiders: "GET /api/users/companies/:companyId/riders (company_admin)",
        getAllUsers: "GET /api/users (admin only)"
      },
      deliveries: {
        create: "POST /api/deliveries (customer)",
        getMyDeliveries: "GET /api/deliveries/my (customer)",
        getRiderDeliveries: "GET /api/deliveries/rider (rider)",
        getCompanyDeliveries: "GET /api/deliveries/company/:companyId (company_admin)",
        assignDelivery: "PATCH /api/deliveries/:id/assign (company_admin)",
        updateStatus: "PATCH /api/deliveries/:id/status (rider)",
        getById: "GET /api/deliveries/:id",
        getAllDeliveries: "GET /api/deliveries (admin)"
      }
    }
  });
});

// Mount route modules
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/deliveries", deliveryRoutes);

/**
 * @route   ALL /api/*
 * @desc    404 handler for undefined API routes
 * @access  Public
 */
router.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    path: req.originalUrl,
    suggestion: "Check /api for available endpoints"
  });
});

export default router;