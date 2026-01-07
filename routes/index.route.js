// routes/index.js
import express from 'express';
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import deliveryRoutes from "./delivery.routes.js";
import rideRoutes from "./ride.routes.js"; 
import deliveryPersonRoutes from './deliveryPerson.routes.js';
import driverRoutes from './driver.routes.js';
import companyRoutes from './company.routes.js'; // Add this

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
        create: "POST /api/deliveries/request (customer)",
        getNearbyDrivers: "GET /api/deliveries/nearby-drivers (customer)",
        getMyDeliveries: "GET /api/deliveries/my (customer)",
        getDeliveryDetails: "GET /api/deliveries/:deliveryId",
        generateOTP: "POST /api/deliveries/:deliveryId/generate-otp (customer)",
        trackDelivery: "GET /api/deliveries/:deliveryId/track",
        cancelDelivery: "POST /api/deliveries/:deliveryId/cancel",
        rateDelivery: "POST /api/deliveries/:deliveryId/rate (customer)",
        // Driver-specific delivery endpoints
        getNearbyRequests: "GET /api/deliveries/driver/nearby (driver)",
        getDriverActive: "GET /api/deliveries/driver/active (driver)",
        getDriverDeliveries: "GET /api/deliveries/driver/my-deliveries (driver)",
        acceptDelivery: "POST /api/deliveries/:deliveryId/accept (driver)",
        rejectDelivery: "POST /api/deliveries/:deliveryId/reject (driver)",
        startDelivery: "POST /api/deliveries/:deliveryId/start (driver)",
        completeDelivery: "POST /api/deliveries/:deliveryId/complete (driver)",
        updateLocation: "POST /api/deliveries/:deliveryId/location (driver)",
         getAllDeliveries: "GET /api/deliveries (admin)",
        getCompanyDeliveries: "GET /api/deliveries/company/:companyId/deliveries (company_admin, admin)"
      },
      driver: {
        getProfile: "GET /api/driver/profile",
        updateProfile: "PUT /api/driver/profile",
        uploadDocuments: "POST /api/driver/documents",
        updateLocation: "POST /api/driver/location",
        toggleOnlineStatus: "POST /api/driver/online-status",
        updateAvailability: "POST /api/driver/availability",
        getCurrentDelivery: "GET /api/driver/current-delivery",
        getDeliveryRequests: "GET /api/driver/requests",
        getEarnings: "GET /api/driver/earnings",
        getStats: "GET /api/driver/stats",
        getDeliveries: "GET /api/driver/deliveries",
        updateSettings: "PUT /api/driver/settings",
        acceptDelivery: "POST /api/driver/deliveries/accept/:deliveryId",
        startDelivery: "POST /api/driver/deliveries/start/:deliveryId",
        completeDelivery: "POST /api/driver/deliveries/complete/:deliveryId"
      },
      company: {
        getProfile: "GET /api/company/profile",
        updateProfile: "PUT /api/company/profile",
        updateSettings: "PUT /api/company/settings",
        uploadDocuments: "POST /api/company/documents",
        getDrivers: "GET /api/company/drivers",
        getDriverRequests: "GET /api/company/driver-requests",
        approveDriverDocument: "POST /api/company/drivers/:driverId/approve-document",
        suspendDriver: "POST /api/company/drivers/:driverId/suspend",
        activateDriver: "POST /api/company/drivers/:driverId/activate",
        getDeliveries: "GET /api/company/deliveries",
        getStatistics: "GET /api/company/statistics",
        getEarnings: "GET /api/company/earnings",
        getTransactions: "GET /api/company/transactions",
        getNotifications: "GET /api/company/notifications"
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
router.use("/driver", driverRoutes);
router.use("/company", companyRoutes); // Add this

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