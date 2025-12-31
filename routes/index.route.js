// routes/index.js
import express from 'express';
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import deliveryRoutes from "./delivery.routes.js";
import rideRoutes from "./ride.routes.js"; 
import deliveryPersonRoutes from './deliveryPerson.routes.js';
 import paymentRoutes from './payment.routes.js';
import driverRoutes from './driver.routes.js';

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
    message: "Delivery & Ride Service API",
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
      deliveries: {
        create: "POST /api/deliveries (customer)",
        getMyDeliveries: "GET /api/deliveries/my (customer)",
        getDeliveryPersonDeliveries: "GET /api/deliveries/delivery-person (delivery_person)",
        getCompanyDeliveries: "GET /api/deliveries/company/:companyId (company_admin)",
        assignDelivery: "PATCH /api/deliveries/:id/assign (company_admin)",
        updateStatus: "PATCH /api/deliveries/:id/status (delivery_person)",
        getById: "GET /api/deliveries/:id",
        getAllDeliveries: "GET /api/deliveries (admin)",
        getNearbyDrivers: "GET /api/deliveries/nearby-drivers (customer)"
      },
      rides: {
        createRide: "POST /api/rides (customer)",
        myRides: "GET /api/rides/my-rides (customer)",
        activeRide: "GET /api/rides/active",
        getRideById: "GET /api/rides/:id",
        assignRide: "POST /api/rides/:rideId/assign",
        acceptRide: "POST /api/rides/:rideId/accept (delivery_person)",
        arriveAtPickup: "POST /api/rides/:rideId/arrive (delivery_person)",
        startRide: "POST /api/rides/:rideId/start (delivery_person)",
        completeRide: "POST /api/rides/:rideId/complete (delivery_person)",
        cancelRide: "POST /api/rides/:rideId/cancel (customer, delivery_person)",
        rateRide: "POST /api/rides/:rideId/rate (customer)",
        getCompanyRides: "GET /api/rides/company/:companyId (company_admin)",
        getDeliveryPersonRides: "GET /api/rides/delivery-person (delivery_person)",
        getAllRides: "GET /api/rides (admin)",
        getRideStatistics: "GET /api/rides/statistics"
      },
      deliveryPersons: {
        nearby: "GET /api/delivery-persons/nearby",
        updateLocation: "PATCH /api/delivery-persons/location",
        onlineStatus: "PATCH /api/delivery-persons/online-status",
        getProfile: "GET /api/delivery-persons/profile",
        updateServices: "PATCH /api/delivery-persons/services"
      }
    },
    documentation: "https://api-docs.example.com"
  });
});

// Mount route modules
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/deliveries", deliveryRoutes);
router.use("/rides", rideRoutes);
router.use("/delivery-persons", deliveryPersonRoutes);
router.use("/payments", paymentRoutes);
router.use("/driver", driverRoutes)

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