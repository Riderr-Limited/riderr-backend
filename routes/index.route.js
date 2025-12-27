// routes/index.js - Complete Routes File
import express from 'express'
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import deliveryRoutes from "./delivery.routes.js";
import rideRoutes from "./ride.routes.js"; 

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
        signupRider: "POST /api/auth/signup/rider",
        signupCompany: "POST /api/auth/signup/company/:companyId",
        login: "POST /api/auth/login",
        refresh: "POST /api/auth/refresh",
        logout: "POST /api/auth/logout"
      },
      users: {
        getProfile: "GET /api/users/me",
        updateProfile: "PATCH /api/users/me",
        changePassword: "PUT /api/users/me/password",
        uploadAvatar: "POST /api/users/me/avatar",
        getUser: "GET /api/users/:id",
        getRiders: "GET /api/users/companies/:companyId/riders (company_admin)",
        getAllUsers: "GET /api/users (admin only)"
      },
      rides: {
        createRide: "POST /api/rides",
        myRides: "GET /api/rides/my-rides",
        activeRide: "GET /api/rides/active",
        getRideById: "GET /api/rides/:id",
        assignRide: "POST /api/rides/:rideId/assign",
        acceptRide: "POST /api/rides/:rideId/accept",
        arriveAtPickup: "POST /api/rides/:rideId/arrive",
        startRide: "POST /api/rides/:rideId/start",
        completeRide: "POST /api/rides/:rideId/complete",
        cancelRide: "POST /api/rides/:rideId/cancel",
        rateRide: "POST /api/rides/:rideId/rate",
        getCompanyRides: "GET /api/rides/company/:companyId",
        getDriverRides: "GET /api/rides/driver",
        getAllRides: "GET /api/rides (admin)",
        getRideStatistics: "GET /api/rides/statistics"
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
    },
    documentation: "https://api-docs.example.com"
  });
});

// Mount route modules
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/rides", rideRoutes);
router.use("/deliveries", deliveryRoutes);

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
    timestamp: new Date().toISOString()
  });
});

export default router;