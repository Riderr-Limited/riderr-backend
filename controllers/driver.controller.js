import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Delivery from "../models/delivery.models.js";
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import { sendNotification } from "../utils/notification.js";

/**
 * UTILITY FUNCTIONS
 */

// Calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Save driver details to delivery
const saveDriverDetailsToDelivery = async (deliveryId, driver) => {
  try {
    const delivery = await Delivery.findById(deliveryId);
    if (delivery && driver && driver.userId) {
      const driverUser = await User.findById(driver.userId);

      delivery.driverDetails = {
        driverId: driver._id,
        userId: driver.userId,
        name: driverUser?.name || "Driver",
        phone: driverUser?.phone || "",
        avatarUrl: driverUser?.avatarUrl,
        vehicle: {
          type: driver.vehicleType || "bike",
          make: driver.vehicleMake || "",
          model: driver.vehicleModel || "",
          plateNumber: driver.plateNumber || "",
        },
      };
      await delivery.save();
      console.log(`✅ Driver details saved for delivery ${deliveryId}`);
      return true;
    }
  } catch (error) {
    console.error("❌ Error saving driver details:", error);
  }
  return false;
};

// Validate driver can go online
const validateDriverForOnline = async (driver) => {
  const errors = [];

  if (!driver.isVerified) {
    errors.push("Driver must be verified by admin");
  }

  const requiredDocs = ["licensePhoto", "vehiclePhoto", "insurancePhoto"];
  const missingDocs = requiredDocs.filter((doc) => !driver[doc]);

  if (missingDocs.length > 0) {
    errors.push(`Missing required documents: ${missingDocs.join(", ")}`);
  }

  if (driver.licenseExpiry && new Date(driver.licenseExpiry) < new Date()) {
    errors.push("Driver license has expired");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * DRIVER PROFILE CONTROLLERS
 */

/**
 * @desc    Get driver profile
 * @route   GET /api/driver/profile
 * @access  Private (Driver)
 */
export const getDriverProfile = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id })
      .populate("userId", "name email phone avatarUrl")
      .populate("companyId", "name logo contactPhone address");

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Get driver statistics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [stats, recentDeliveries] = await Promise.all([
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: null,
            totalDeliveries: { $sum: 1 },
            totalEarnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            averageRating: { $avg: "$rating" },
          },
        },
      ]),
      Delivery.find({
        driverId: driver._id,
        status: "delivered",
      })
        .sort({ deliveredAt: -1 })
        .limit(5)
        .select(
          "deliveredAt fare.totalFare tip.amount rating pickup.address dropoff.address"
        ),
    ]);

    const driverStats = stats[0] || {
      totalDeliveries: 0,
      totalEarnings: 0,
      averageRating: 0,
    };

    // Calculate acceptance rate
    const acceptanceRate = driver.totalRequests
      ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
      : 0;

    res.status(200).json({
      success: true,
      data: {
        ...driver.toObject(),
        stats: {
          ...driverStats,
          acceptanceRate,
          totalOnlineHours: driver.totalOnlineHours || 0,
          totalRequests: driver.totalRequests || 0,
          acceptedRequests: driver.acceptedRequests || 0,
        },
        recentDeliveries,
        canGoOnline: (await validateDriverForOnline(driver)).isValid,
      },
    });
  } catch (error) {
    console.error("❌ Get driver profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver profile",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Update driver profile
 * @route   PUT /api/driver/profile
 * @access  Private (Driver)
 */
export const updateDriverProfile = async (req, res) => {
  try {
    const driverUser = req.user;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const {
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      licenseNumber,
      licenseExpiry,
      canAcceptDeliveries,
    } = req.body;

    // Update allowed fields
    const updates = {};

    if (vehicleMake !== undefined) updates.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined) updates.vehicleModel = vehicleModel;
    if (vehicleYear !== undefined) updates.vehicleYear = vehicleYear;
    if (vehicleColor !== undefined) updates.vehicleColor = vehicleColor;
    if (plateNumber !== undefined)
      updates.plateNumber = plateNumber.toUpperCase();
    if (licenseNumber !== undefined)
      updates.licenseNumber = licenseNumber.toUpperCase();
    if (licenseExpiry !== undefined)
      updates.licenseExpiry = new Date(licenseExpiry);
    if (canAcceptDeliveries !== undefined)
      updates.canAcceptDeliveries = canAcceptDeliveries;

    // If license details changed, mark as unverified
    if (licenseNumber || licenseExpiry) {
      updates.isVerified = false;
      updates.approvalStatus = "pending";
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      driver._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate("userId", "name email phone");

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedDriver,
    });
  } catch (error) {
    console.error("❌ Update driver profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

/**
 * @desc    Upload driver documents
 * @route   POST /api/driver/documents
 * @access  Private (Driver)
 */
// Update the uploadDriverDocuments function in driver.controller.js
/**
 * @desc    Upload driver documents
 * @route   POST /api/driver/documents
 * @access  Private (Driver)
 */
export const uploadDriverDocuments = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      // Delete uploaded files if driver not found
      if (req.files) {
        await Promise.all(req.files.map((file) => deleteFile(file.path)));
      }
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Get document types from request body
    const {
      licensePhoto,
      vehiclePhoto,
      insurancePhoto,
      idCardPhoto,
      vehicleRegistrationPhoto,
    } = req.body;

    // Update document URLs based on file field names
    const updates = {};
    const uploadedFiles = req.files || [];

    // Map uploaded files to document types
    uploadedFiles.forEach((file) => {
      const fieldName = file.fieldname;

      switch (fieldName) {
        case "licensePhoto":
          updates.licensePhoto = file.path;
          break;
        case "vehiclePhoto":
          updates.vehiclePhoto = file.path;
          break;
        case "insurancePhoto":
          updates.insurancePhoto = file.path;
          break;
        case "idCardPhoto":
          updates.idCardPhoto = file.path;
          break;
        case "vehicleRegistrationPhoto":
          updates.vehicleRegistrationPhoto = file.path;
          break;
      }
    });

    // Also update from request body (for URLs from external storage)
    if (licensePhoto && !updates.licensePhoto)
      updates.licensePhoto = licensePhoto;
    if (vehiclePhoto && !updates.vehiclePhoto)
      updates.vehiclePhoto = vehiclePhoto;
    if (insurancePhoto && !updates.insurancePhoto)
      updates.insurancePhoto = insurancePhoto;
    if (idCardPhoto && !updates.idCardPhoto) updates.idCardPhoto = idCardPhoto;
    if (vehicleRegistrationPhoto && !updates.vehicleRegistrationPhoto)
      updates.vehicleRegistrationPhoto = vehicleRegistrationPhoto;

    // Mark as unverified if documents are changed
    if (Object.keys(updates).length > 0) {
      updates.isVerified = false;
      updates.approvalStatus = "pending";
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      driver._id,
      { $set: updates },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Documents uploaded successfully",
      data: {
        licensePhoto: getFileUrl(req, updatedDriver.licensePhoto),
        vehiclePhoto: getFileUrl(req, updatedDriver.vehiclePhoto),
        insurancePhoto: getFileUrl(req, updatedDriver.insurancePhoto),
        idCardPhoto: getFileUrl(req, updatedDriver.idCardPhoto),
        vehicleRegistrationPhoto: getFileUrl(
          req,
          updatedDriver.vehicleRegistrationPhoto
        ),
        isVerified: updatedDriver.isVerified,
        approvalStatus: updatedDriver.approvalStatus,
      },
    });
  } catch (error) {
    // Delete uploaded files if error occurs
    if (req.files) {
      await Promise.all(req.files.map((file) => deleteFile(file.path)));
    }
    console.error("❌ Upload driver documents error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload documents",
    });
  }
};

/**
 * @desc    Update driver location
 * @route   POST /api/driver/location
 * @access  Private (Driver)
 */
export const updateDriverLocation = async (req, res) => {
  try {
    const driverUser = req.user;

    const { lat, lng, address, accuracy } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Check if driver is online
    if (!driver.isOnline) {
      return res.status(400).json({
        success: false,
        message: "Driver must be online to update location",
      });
    }

    // Update location
    driver.currentLocation = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      address: address || driver.currentLocation?.address,
      accuracy: accuracy ? parseFloat(accuracy) : null,
      updatedAt: new Date(),
    };

    driver.lastLocationUpdate = new Date();

    await driver.save();

    // If driver has current delivery, update delivery tracking
    if (driver.currentDeliveryId) {
      const delivery = await Delivery.findById(driver.currentDeliveryId);
      if (delivery && delivery.status === "picked_up") {
        if (!delivery.tracking) {
          delivery.tracking = {
            startedAt: new Date(),
            locations: [],
          };
        }

        delivery.tracking.locations.push({
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          timestamp: new Date(),
          accuracy: accuracy ? parseFloat(accuracy) : null,
        });

        // Keep only last 100 locations
        if (delivery.tracking.locations.length > 100) {
          delivery.tracking.locations = delivery.tracking.locations.slice(-100);
        }

        await delivery.save();
      }
    }

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        location: driver.currentLocation,
        updatedAt: driver.lastLocationUpdate,
      },
    });
  } catch (error) {
    console.error("❌ Update driver location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location",
    });
  }
};

/**
 * @desc    Toggle driver online status
 * @route   POST /api/driver/online-status
 * @access  Private (Driver)
 */
export const toggleDriverOnlineStatus = async (req, res) => {
  try {
    const driverUser = req.user;

    const { isOnline } = req.body;

    if (typeof isOnline !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isOnline must be a boolean",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Validate if driver can go online
    // if (isOnline) {
    //   const validation = await validateDriverForOnline(driver);
    //   if (!validation.isValid) {
    //     return res.status(400).json({
    //       success: false,
    //       message: "Cannot go online",
    //       errors: validation.errors
    //     });
    //   }
    // }

    // Update status
    driver.isOnline = isOnline;

    if (!isOnline) {
      driver.isAvailable = false;
      driver.canAcceptDeliveries = false;

      // Record online session
      if (driver.lastOnlineStart) {
        const sessionDuration = Date.now() - driver.lastOnlineStart.getTime();
        driver.totalOnlineHours =
          (driver.totalOnlineHours || 0) + sessionDuration / 3600000;
        driver.lastOnlineStart = null;
      }
    } else {
      driver.canAcceptDeliveries = true;
      driver.lastOnlineStart = new Date();
    }

    await driver.save();

    res.status(200).json({
      success: true,
      message: `Driver is now ${isOnline ? "online" : "offline"}`,
      data: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        canAcceptDeliveries: driver.canAcceptDeliveries,
      },
    });
  } catch (error) {
    console.error("❌ Toggle driver online status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update online status",
    });
  }
};

/**
 * @desc    Update driver availability
 * @route   POST /api/driver/availability
 * @access  Private (Driver)
 */
export const updateDriverAvailability = async (req, res) => {
  try {
    const driverUser = req.user;

    const { isAvailable } = req.body;

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isAvailable must be a boolean",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Check if driver can become available
    if (isAvailable) {
      if (!driver.isOnline) {
        return res.status(400).json({
          success: false,
          message: "Must be online to become available",
        });
      }

      if (driver.currentDeliveryId) {
        const delivery = await Delivery.findById(driver.currentDeliveryId);
        if (
          delivery &&
          !["delivered", "cancelled", "failed"].includes(delivery.status)
        ) {
          return res.status(400).json({
            success: false,
            message: "Cannot become available while on a delivery",
          });
        }
      }
    }

    driver.isAvailable = isAvailable;
    await driver.save();

    res.status(200).json({
      success: true,
      message: `Driver is now ${
        isAvailable ? "available" : "unavailable"
      } for deliveries`,
      data: {
        isAvailable: driver.isAvailable,
      },
    });
  } catch (error) {
    console.error("❌ Update driver availability error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update availability",
    });
  }
};

/**
 * @desc    Get driver's current delivery
 * @route   GET /api/driver/current-delivery
 * @access  Private (Driver)
 */
export const getCurrentDelivery = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    if (!driver.currentDeliveryId) {
      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    const delivery = await Delivery.findById(driver.currentDeliveryId)
      .populate("customerId", "name phone avatarUrl rating")
      .populate("companyId", "name contactPhone logo");

    if (!delivery) {
      // If delivery doesn't exist, clear the reference
      driver.currentDeliveryId = null;
      driver.isAvailable = true;
      await driver.save();

      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    // Save driver details if not present
    if (!delivery.driverDetails) {
      await saveDriverDetailsToDelivery(delivery._id, driver);
      // Refresh delivery
      const refreshedDelivery = await Delivery.findById(
        driver.currentDeliveryId
      );
      if (refreshedDelivery) {
        delivery.driverDetails = refreshedDelivery.driverDetails;
      }
    }

    // Calculate ETA if in transit
    let etaMinutes = null;

    if (
      delivery.status === "picked_up" &&
      delivery.tracking?.locations?.length > 0
    ) {
      const lastLocation =
        delivery.tracking.locations[delivery.tracking.locations.length - 1];
      const distanceToDropoff = calculateDistance(
        lastLocation.lat,
        lastLocation.lng,
        delivery.dropoff.lat,
        delivery.dropoff.lng
      );
      etaMinutes = Math.ceil(distanceToDropoff * 3);
    }

    res.status(200).json({
      success: true,
      data: {
        ...delivery.toObject(),
        etaMinutes,
        nextAction:
          delivery.status === "assigned"
            ? "Proceed to pickup location"
            : delivery.status === "picked_up"
            ? "Proceed to dropoff location"
            : "Wait for instructions",
      },
    });
  } catch (error) {
    console.error("❌ Get current delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get current delivery",
    });
  }
};

/**
 * @desc    Get driver earnings
 * @route   GET /api/driver/earnings
 * @access  Private (Driver)
 */
export const getDriverEarnings = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const { period = "week", startDate, endDate } = req.query;

    let matchStage = { driverId: driver._id, status: "delivered" };

    // Apply date filter
    if (startDate && endDate) {
      matchStage.deliveredAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    } else {
      // Default to period filter
      const date = new Date();
      switch (period) {
        case "today":
          date.setHours(0, 0, 0, 0);
          matchStage.deliveredAt = { $gte: date };
          break;
        case "week":
          date.setDate(date.getDate() - 7);
          matchStage.deliveredAt = { $gte: date };
          break;
        case "month":
          date.setMonth(date.getMonth() - 1);
          matchStage.deliveredAt = { $gte: date };
          break;
        case "year":
          date.setFullYear(date.getFullYear() - 1);
          matchStage.deliveredAt = { $gte: date };
          break;
      }
    }

    const earnings = await Delivery.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalEarnings: {
            $sum: {
              $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
            },
          },
          totalDeliveries: { $sum: 1 },
          totalTips: { $sum: { $ifNull: ["$tip.amount", 0] } },
          averageRating: { $avg: "$rating" },
        },
      },
    ]);

    // Get daily earnings for chart
    const dailyEarnings = await Delivery.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: "delivered",
          deliveredAt: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$deliveredAt" } },
          earnings: {
            $sum: {
              $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
            },
          },
          deliveries: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const result = earnings[0] || {
      totalEarnings: 0,
      totalDeliveries: 0,
      totalTips: 0,
      averageRating: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        summary: result,
        dailyEarnings,
        period,
        currency: "NGN",
      },
    });
  } catch (error) {
    console.error("❌ Get driver earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get earnings",
    });
  }
};

/**
 * @desc    Get driver statistics
 * @route   GET /api/driver/stats
 * @access  Private (Driver)
 */
export const getDriverStats = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Calculate various stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [
      todayStats,
      weekStats,
      monthStats,
      allTimeStats,
      ratingDistribution,
    ] = await Promise.all([
      // Today's stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: today },
          },
        },
        {
          $group: {
            _id: null,
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            deliveries: { $sum: 1 },
          },
        },
      ]),

      // Week's stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: weekAgo },
          },
        },
        {
          $group: {
            _id: null,
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            deliveries: { $sum: 1 },
          },
        },
      ]),

      // Month's stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: monthAgo },
          },
        },
        {
          $group: {
            _id: null,
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            deliveries: { $sum: 1 },
          },
        },
      ]),

      // All time stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
          },
        },
        {
          $group: {
            _id: null,
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            deliveries: { $sum: 1 },
            averageRating: { $avg: "$rating" },
          },
        },
      ]),

      // Rating distribution
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            rating: { $exists: true },
          },
        },
        {
          $group: {
            _id: "$rating",
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Calculate acceptance rate
    const acceptanceRate = driver.totalRequests
      ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
      : 0;

    // Calculate online hours
    const onlineHours = driver.totalOnlineHours || 0;

    res.status(200).json({
      success: true,
      data: {
        today: todayStats[0] || { earnings: 0, deliveries: 0 },
        week: weekStats[0] || { earnings: 0, deliveries: 0 },
        month: monthStats[0] || { earnings: 0, deliveries: 0 },
        allTime: allTimeStats[0] || {
          earnings: 0,
          deliveries: 0,
          averageRating: 0,
        },
        ratingDistribution: ratingDistribution.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        acceptanceRate,
        onlineHours,
        currentStatus: {
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          hasActiveDelivery: !!driver.currentDeliveryId,
        },
      },
    });
  } catch (error) {
    console.error("❌ Get driver stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get statistics",
    });
  }
};

/**
 * @desc    Get available delivery requests
 * @route   GET /api/driver/requests
 * @access  Private (Driver)
 */
export const getDeliveryRequests = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Check if driver is available
    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      return res.status(400).json({
        success: false,
        message: "Driver is not available for new requests",
      });
    }

    const { lat, lng, radius = 10 } = req.query;

    // Use driver's current location if not provided
    const latitude = lat ? parseFloat(lat) : driver.currentLocation?.lat;
    const longitude = lng ? parseFloat(lng) : driver.currentLocation?.lng;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Location is required",
      });
    }

    // Find available deliveries
    const deliveries = await Delivery.find({
      status: "created",
      driverId: { $exists: false },
    })
      .populate("customerId", "name rating")
      .sort({ createdAt: -1 })
      .limit(20);

    // Calculate distance for each delivery
    const deliveriesWithDistance = deliveries
      .map((delivery) => {
        if (!delivery.pickup?.lat || !delivery.pickup?.lng) {
          return null;
        }

        const distance = calculateDistance(
          latitude,
          longitude,
          delivery.pickup.lat,
          delivery.pickup.lng
        );

        return {
          ...delivery.toObject(),
          distance,
          distanceText: `${distance.toFixed(1)} km away`,
          estimatedPickupTime: Math.ceil(distance * 3),
        };
      })
      .filter((d) => d !== null && d.distance <= radius);

    res.status(200).json({
      success: true,
      data: deliveriesWithDistance,
      count: deliveriesWithDistance.length,
    });
  } catch (error) {
    console.error("❌ Get delivery requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery requests",
    });
  }
};

/**
 * @desc    Update driver settings
 * @route   PUT /api/driver/settings
 * @access  Private (Driver)
 */
export const updateDriverSettings = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const {
      notifications,
      autoAccept,
      maxDistance,
      minFare,
      workingHours,
      preferredAreas,
    } = req.body;

    // Update settings
    const updates = {};

    if (notifications !== undefined) updates.notifications = notifications;
    if (autoAccept !== undefined) updates.autoAccept = autoAccept;
    if (maxDistance !== undefined)
      updates.maxDistance = parseFloat(maxDistance);
    if (minFare !== undefined) updates.minFare = parseFloat(minFare);
    if (workingHours !== undefined) updates.workingHours = workingHours;
    if (preferredAreas !== undefined) updates.preferredAreas = preferredAreas;

    const updatedDriver = await Driver.findByIdAndUpdate(
      driver._id,
      { $set: updates },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: {
        notifications: updatedDriver.notifications,
        autoAccept: updatedDriver.autoAccept,
        maxDistance: updatedDriver.maxDistance,
        minFare: updatedDriver.minFare,
        workingHours: updatedDriver.workingHours,
        preferredAreas: updatedDriver.preferredAreas,
      },
    });
  } catch (error) {
    console.error("❌ Update driver settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update settings",
    });
  }
};

/**
 * @desc    Driver accepts a delivery request
 * @route   POST /api/driver/deliveries/accept/:deliveryId
 * @access  Private (Driver)
 */
export const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`🚗 Driver ${driverUser._id} accepting delivery ${deliveryId}`);

    const driver = await Driver.findOne({ userId: driverUser._id }).session(
      session
    );
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Check if driver is available
    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Driver is not available for new deliveries",
      });
    }

    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check if delivery is still available
    if (delivery.status !== "created" || delivery.driverId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery is no longer available",
      });
    }

    // Calculate distance from driver to pickup
    let driverToPickupDistance = 5;
    if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      driverToPickupDistance = calculateDistance(
        driver.currentLocation.lat,
        driver.currentLocation.lng,
        delivery.pickup.lat,
        delivery.pickup.lng
      );
    }

    // Update delivery
    delivery.driverId = driver._id;
    delivery.status = "assigned";
    delivery.assignedAt = new Date();
    delivery.estimatedPickupTime = new Date(
      Date.now() + driverToPickupDistance * 3 * 60000
    );

    // Update driver
    driver.currentDeliveryId = delivery._id;
    driver.isAvailable = false;
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    driver.acceptedRequests = (driver.acceptedRequests || 0) + 1;

    // Save driver details to delivery
    await saveDriverDetailsToDelivery(delivery._id, driver);

    await Promise.all([delivery.save({ session }), driver.save({ session })]);

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: "🚗 Driver Assigned!",
        message: `Driver ${driverUser.name} has accepted your delivery`,
        data: {
          type: "driver_assigned",
          deliveryId: delivery._id,
          driver: {
            name: driverUser.name,
            phone: driverUser.phone,
            avatarUrl: driverUser.avatarUrl,
            vehicle:
              `${driver.vehicleMake || ""} ${
                driver.vehicleModel || ""
              }`.trim() || "Vehicle",
            plateNumber: driver.plateNumber,
          },
          estimatedPickupTime: delivery.estimatedPickupTime,
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Delivery accepted successfully!",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          pickup: delivery.pickup,
          dropoff: delivery.dropoff,
          estimatedPickupTime: delivery.estimatedPickupTime,
          fare: delivery.fare,
          driverId: delivery.driverId,
          driverDetails: delivery.driverDetails,
        },
        driver: {
          _id: driver._id,
          name: driverUser.name,
          phone: driverUser.phone,
          vehicle:
            `${driver.vehicleMake || ""} ${driver.vehicleModel || ""}`.trim() ||
            "Vehicle",
          plateNumber: driver.plateNumber,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Accept delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept delivery",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Driver starts delivery (arrived at pickup)
 * @route   POST /api/driver/deliveries/start/:deliveryId
 * @access  Private (Driver)
 */
export const startDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { otp, notes } = req.body || {};

    console.log(`🚚 Driver ${driverUser._id} starting delivery ${deliveryId}`);

    const driver = await Driver.findOne({ userId: driverUser._id }).session(
      session
    );
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id,
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found or not assigned to this driver",
      });
    }

    // Check status - should be "assigned"
    if (delivery.status !== "assigned") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot start delivery from status: ${delivery.status}`,
      });
    }

    // OTP verification (if required for high-value items)
    if (delivery.pickup?.otp) {
      if (!otp) {
        return res.status(400).json({
          success: false,
          message: "OTP is required",
        });
      }

      if (otp !== delivery.pickup.otp) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP",
        });
      }
    }

    // Update delivery status to "picked_up"
    delivery.status = "picked_up";
    delivery.pickedUpAt = new Date();

    // Add pickup notes if provided
    if (notes) {
      delivery.pickup.notes = notes;
    }

    // Start tracking
    delivery.tracking = {
      startedAt: new Date(),
      locations: [
        {
          lat: delivery.pickup.lat,
          lng: delivery.pickup.lng,
          timestamp: new Date(),
          status: "picked_up",
        },
      ],
    };

    await delivery.save({ session });

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: "📦 Package Picked Up",
        message: `Your package has been picked up by ${driverUser.name}`,
        data: {
          type: "delivery_started",
          deliveryId: delivery._id,
          driver: {
            name: driverUser.name,
            phone: driverUser.phone,
          },
          pickedUpAt: delivery.pickedUpAt,
          nextStep: "On the way to dropoff location",
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Delivery started successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          pickedUpAt: delivery.pickedUpAt,
          pickup: delivery.pickup,
          dropoff: delivery.dropoff,
          nextStep: "Proceed to dropoff location",
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Start delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start delivery",
    });
  }
};

/**
 * @desc    Driver completes delivery
 * @route   POST /api/driver/deliveries/complete/:deliveryId
 * @access  Private (Driver)
 */
export const completeDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { otp } = req.body || {};

    console.log(
      `✅ Driver ${driverUser._id} completing delivery ${deliveryId}`
    );

    const driver = await Driver.findOne({ userId: driverUser._id }).session(
      session
    );
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id,
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check status - should be "picked_up"
    if (delivery.status !== "picked_up") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot complete delivery from status: ${delivery.status}`,
      });
    }

    // OTP verification
    if (delivery.dropoff?.otp) {
      if (!otp) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "OTP is required to complete this delivery",
        });
      }

      if (otp !== delivery.dropoff.otp) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid OTP",
        });
      }
    }


    // Update delivery status
    delivery.status = "delivered";
    delivery.deliveredAt = new Date();

    // Update delivery proof
    delivery.deliveryProof = {
      deliveredAt: new Date(),
      recipientName: delivery.recipientName,
      otpVerified: !!otp,
    };

    // Update driver status
    driver.currentDeliveryId = null;
    driver.isAvailable = true;
    driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;

    await Promise.all([delivery.save({ session }), driver.save({ session })]);

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: "🎊 Delivery Completed!",
        message: `Your package has been delivered successfully`,
        data: {
          type: "delivery_completed",
          deliveryId: delivery._id,
          deliveredAt: delivery.deliveredAt,
          requestRating: true,
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Delivery completed successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          deliveredAt: delivery.deliveredAt,
          fare: delivery.fare,
        },
        driverAvailable: true,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Complete delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete delivery",
    });
  }
};

/**
 * @desc    Get driver's delivery history
 * @route   GET /api/driver/deliveries
 * @access  Private (Driver)
 */
export const getDriverDeliveries = async (req, res) => {
  try {
    const driverUser = req.user;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const { status, page = 1, limit = 10 } = req.query;

    const query = { driverId: driver._id };
    if (status && status !== "all") {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const deliveries = await Delivery.find(query)
      .populate("customerId", "name phone avatarUrl rating")
      .populate("companyId", "name logo")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Delivery.countDocuments(query);

    // Ensure driver details are included
    const deliveriesWithDriverDetails = await Promise.all(
      deliveries.map(async (delivery) => {
        const deliveryObj = delivery.toObject();

        // If no driverDetails but has driverId, populate it
        if (!deliveryObj.driverDetails && deliveryObj.driverId) {
          await saveDriverDetailsToDelivery(delivery._id, driver);
          const refreshedDelivery = await Delivery.findById(delivery._id);
          deliveryObj.driverDetails = refreshedDelivery.driverDetails;
        }

        return deliveryObj;
      })
    );

    res.status(200).json({
      success: true,
      data: deliveriesWithDriverDetails,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get driver deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Add these company controller functions to your existing driver.controller.js

/**
 * @desc    Get company profile
 * @route   GET /api/company/profile
 * @access  Private (Company)
 */
export const getCompanyProfile = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Get company statistics
    const [driverStats, deliveryStats, earnings] = await Promise.all([
      Driver.countDocuments({ companyId: company._id }),
      Driver.countDocuments({ companyId: company._id, isOnline: true }),
      Delivery.countDocuments({ companyId: company._id }),
      Delivery.aggregate([
        {
          $match: {
            companyId: company._id,
            status: "delivered",
            deliveredAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: null,
            totalEarnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            totalDeliveries: { $sum: 1 },
          },
        },
      ]),
    ]);

    const earningsData = earnings[0] || {
      totalEarnings: 0,
      totalDeliveries: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        ...company.toObject(),
        stats: {
          totalDrivers: driverStats,
          onlineDrivers: deliveryStats,
          totalDeliveries: earningsData.totalDeliveries,
          totalEarnings: earningsData.totalEarnings,
        },
      },
    });
  } catch (error) {
    console.error("❌ Get company profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company profile",
    });
  }
};

/**
 * @desc    Update company profile
 * @route   PUT /api/company/profile
 * @access  Private (Company)
 */
export const updateCompanyProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      name,
      address,
      city,
      state,
      lga,
      contactPhone,
      contactEmail,
      logoUrl,
      operatingHours,
    } = req.body;

    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Update allowed fields
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (lga !== undefined) updates.lga = lga;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl;
    if (operatingHours !== undefined) {
      updates.settings = { ...company.settings, operatingHours };
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      company._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Company profile updated successfully",
      data: updatedCompany,
    });
  } catch (error) {
    console.error("❌ Update company profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update company profile",
    });
  }
};

/**
 * @desc    Get company drivers
 * @route   GET /api/company/drivers
 * @access  Private (Company)
 */
export const getCompanyDrivers = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const {
      status,
      isOnline,
      isVerified,
      page = 1,
      limit = 10,
      search,
    } = req.query;

    const query = { companyId: company._id };

    // Apply filters
    if (status && status !== "all") {
      query.approvalStatus = status;
    }
    if (isOnline !== undefined) {
      query.isOnline = isOnline === "true";
    }
    if (isVerified !== undefined) {
      query.isVerified = isVerified === "true";
    }
    if (search) {
      query.$or = [
        { licenseNumber: { $regex: search, $options: "i" } },
        { plateNumber: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [drivers, total] = await Promise.all([
      Driver.find(query)
        .populate("userId", "name phone email avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Driver.countDocuments(query),
    ]);

    // Get driver statistics
    const driversWithStats = await Promise.all(
      drivers.map(async (driver) => {
        const driverObj = driver.toObject();

        // Get driver delivery stats
        const [deliveryStats, earnings] = await Promise.all([
          Delivery.aggregate([
            {
              $match: {
                driverId: driver._id,
                status: "delivered",
                deliveredAt: {
                  $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              },
            },
            {
              $group: {
                _id: null,
                totalDeliveries: { $sum: 1 },
                averageRating: { $avg: "$rating" },
              },
            },
          ]),
          Delivery.aggregate([
            {
              $match: {
                driverId: driver._id,
                status: "delivered",
                deliveredAt: {
                  $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              },
            },
            {
              $group: {
                _id: null,
                totalEarnings: {
                  $sum: {
                    $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
                  },
                },
              },
            },
          ]),
        ]);

        const stats = deliveryStats[0] || {
          totalDeliveries: 0,
          averageRating: 0,
        };
        const earningsData = earnings[0] || { totalEarnings: 0 };

        return {
          ...driverObj,
          stats: {
            ...stats,
            totalEarnings: earningsData.totalEarnings,
            acceptanceRate: driver.totalRequests
              ? Math.round(
                  (driver.acceptedRequests / driver.totalRequests) * 100
                )
              : 0,
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: driversWithStats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company drivers",
    });
  }
};

/**
 * @desc    Get company statistics
 * @route   GET /api/company/statistics
 * @access  Private (Company)
 */
export const getCompanyStatistics = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { period = "month" } = req.query;

    let dateFilter = {};
    const now = new Date();

    switch (period) {
      case "today":
        dateFilter = {
          $gte: new Date(now.setHours(0, 0, 0, 0)),
        };
        break;
      case "week":
        dateFilter = {
          $gte: new Date(now.setDate(now.getDate() - 7)),
        };
        break;
      case "month":
        dateFilter = {
          $gte: new Date(now.setMonth(now.getMonth() - 1)),
        };
        break;
      case "year":
        dateFilter = {
          $gte: new Date(now.setFullYear(now.getFullYear() - 1)),
        };
        break;
    }

    const [
      driverStats,
      deliveryStats,
      earningsData,
      dailyDeliveries,
      topDrivers,
    ] = await Promise.all([
      // Driver statistics
      Driver.aggregate([
        {
          $match: { companyId: company._id },
        },
        {
          $group: {
            _id: null,
            totalDrivers: { $sum: 1 },
            onlineDrivers: {
              $sum: { $cond: [{ $eq: ["$isOnline", true] }, 1, 0] },
            },
            verifiedDrivers: {
              $sum: { $cond: [{ $eq: ["$isVerified", true] }, 1, 0] },
            },
            averageRating: { $avg: "$rating.average" },
          },
        },
      ]),

      // Delivery statistics
      Delivery.aggregate([
        {
          $match: {
            companyId: company._id,
            status: { $in: ["delivered", "cancelled", "failed"] },
            createdAt: dateFilter,
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      // Earnings statistics
      Delivery.aggregate([
        {
          $match: {
            companyId: company._id,
            status: "delivered",
            createdAt: dateFilter,
          },
        },
        {
          $group: {
            _id: null,
            totalEarnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            totalDeliveries: { $sum: 1 },
            averageFare: { $avg: "$fare.totalFare" },
            totalCommission: {
              $sum: {
                $multiply: [
                  {
                    $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
                  },
                  company.settings.commissionRate / 100,
                ],
              },
            },
          },
        },
      ]),

      // Daily deliveries for chart
      Delivery.aggregate([
        {
          $match: {
            companyId: company._id,
            status: "delivered",
            createdAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            deliveries: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ]),

      // Top drivers
      Delivery.aggregate([
        {
          $match: {
            companyId: company._id,
            status: "delivered",
            createdAt: dateFilter,
          },
        },
        {
          $group: {
            _id: "$driverId",
            deliveries: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            averageRating: { $avg: "$rating" },
          },
        },
        { $sort: { deliveries: -1 } },
        { $limit: 5 },
      ]),
    ]);

    // Format delivery stats
    const deliveryStatsFormatted = {
      delivered: 0,
      cancelled: 0,
      failed: 0,
    };

    deliveryStats.forEach((stat) => {
      deliveryStatsFormatted[stat._id] = stat.count;
    });

    // Populate top drivers with driver info
    const topDriversPopulated = await Promise.all(
      topDrivers.map(async (driver) => {
        const driverInfo = await Driver.findById(driver._id).populate(
          "userId",
          "name phone avatarUrl"
        );

        return {
          driver: driverInfo?.userId || { name: "Unknown Driver" },
          deliveries: driver.deliveries,
          earnings: driver.earnings,
          averageRating: driver.averageRating || 0,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        driverStats: driverStats[0] || {
          totalDrivers: 0,
          onlineDrivers: 0,
          verifiedDrivers: 0,
          averageRating: 0,
        },
        deliveryStats: deliveryStatsFormatted,
        earnings: earningsData[0] || {
          totalEarnings: 0,
          totalDeliveries: 0,
          averageFare: 0,
          totalCommission: 0,
        },
        dailyDeliveries,
        topDrivers: topDriversPopulated,
        period,
      },
    });
  } catch (error) {
    console.error("❌ Get company statistics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company statistics",
    });
  }
};

/**
 * @desc    Get company deliveries
 * @route   GET /api/company/deliveries
 * @access  Private (Company)
 */
export const getCompanyDeliveries = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const {
      status,
      startDate,
      endDate,
      driverId,
      page = 1,
      limit = 10,
    } = req.query;

    const query = { companyId: company._id };

    // Apply filters
    if (status && status !== "all") {
      query.status = status;
    }
    if (driverId) {
      query.driverId = driverId;
    }
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate("customerId", "name phone")
        .populate("driverId")
        .populate("driverDetails.userId", "name phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Delivery.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company deliveries",
    });
  }
};

/**
 * @desc    Get company earnings
 * @route   GET /api/company/earnings
 * @access  Private (Company)
 */
export const getCompanyEarnings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { period = "month", startDate, endDate } = req.query;

    let matchStage = { companyId: company._id, status: "delivered" };

    // Apply date filter
    if (startDate && endDate) {
      matchStage.deliveredAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    } else {
      // Default to period filter
      const date = new Date();
      switch (period) {
        case "today":
          date.setHours(0, 0, 0, 0);
          matchStage.deliveredAt = { $gte: date };
          break;
        case "week":
          date.setDate(date.getDate() - 7);
          matchStage.deliveredAt = { $gte: date };
          break;
        case "month":
          date.setMonth(date.getMonth() - 1);
          matchStage.deliveredAt = { $gte: date };
          break;
        case "year":
          date.setFullYear(date.getFullYear() - 1);
          matchStage.deliveredAt = { $gte: date };
          break;
      }
    }

    const earnings = await Delivery.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
            },
          },
          totalDeliveries: { $sum: 1 },
          averageFare: { $avg: "$fare.totalFare" },
          totalTips: { $sum: { $ifNull: ["$tip.amount", 0] } },
          totalCommission: {
            $sum: {
              $multiply: [
                { $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }] },
                company.settings.commissionRate / 100,
              ],
            },
          },
        },
      },
    ]);

    // Get daily earnings for chart
    const dailyEarnings = await Delivery.aggregate([
      {
        $match: {
          companyId: company._id,
          status: "delivered",
          deliveredAt: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$deliveredAt" } },
          revenue: {
            $sum: {
              $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
            },
          },
          commission: {
            $sum: {
              $multiply: [
                { $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }] },
                company.settings.commissionRate / 100,
              ],
            },
          },
          deliveries: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const result = earnings[0] || {
      totalRevenue: 0,
      totalDeliveries: 0,
      averageFare: 0,
      totalTips: 0,
      totalCommission: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        summary: result,
        dailyEarnings,
        period,
        currency: "NGN",
        commissionRate: company.settings.commissionRate,
      },
    });
  } catch (error) {
    console.error("❌ Get company earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company earnings",
    });
  }
};

/**
 * @desc    Update company settings
 * @route   PUT /api/company/settings
 * @access  Private (Company)
 */
export const updateCompanySettings = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { autoAccept, commissionRate, notificationChannels, operatingHours } =
      req.body;

    // Update settings
    const updates = { settings: { ...company.settings } };

    if (autoAccept !== undefined) updates.settings.autoAccept = autoAccept;
    if (commissionRate !== undefined) {
      if (commissionRate < 0 || commissionRate > 100) {
        return res.status(400).json({
          success: false,
          message: "Commission rate must be between 0 and 100",
        });
      }
      updates.settings.commissionRate = commissionRate;
    }
    if (notificationChannels !== undefined) {
      updates.settings.notificationChannels = notificationChannels;
    }
    if (operatingHours !== undefined) {
      updates.settings.operatingHours = operatingHours;
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      company._id,
      { $set: updates },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: {
        settings: updatedCompany.settings,
      },
    });
  } catch (error) {
    console.error("❌ Update company settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update settings",
    });
  }
};

/**
 * @desc    Manage company documents
 * @route   POST /api/company/documents
 * @access  Private (Company)
 */
// Update the manageCompanyDocuments function in driver.controller.js
/**
 * @desc    Manage company documents
 * @route   POST /api/company/documents
 * @access  Private (Company)
 */
export const manageCompanyDocuments = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      // Delete uploaded file if company not found
      if (req.file) {
        await deleteFile(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { documentType } = req.body;

    if (!documentType || !req.file) {
      // Delete uploaded file if validation fails
      if (req.file) {
        await deleteFile(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: "Document type and file are required",
      });
    }

    // Add or update document
    const documentIndex = company.onboardingDocs.findIndex(
      (doc) => doc.name === documentType
    );

    const document = {
      name: documentType,
      url: req.file.path,
      uploadedAt: new Date(),
      verified: false,
    };

    if (documentIndex >= 0) {
      // Delete old file if exists
      if (company.onboardingDocs[documentIndex].url) {
        await deleteFile(company.onboardingDocs[documentIndex].url);
      }
      company.onboardingDocs[documentIndex] = document;
    } else {
      company.onboardingDocs.push(document);
    }

    await company.save();

    res.status(200).json({
      success: true,
      message: "Document uploaded successfully",
      data: {
        documents: company.onboardingDocs.map((doc) => ({
          name: doc.name,
          url: getFileUrl(req, doc.url), // Get full URL
          uploadedAt: doc.uploadedAt,
          verified: doc.verified,
        })),
      },
    });
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      await deleteFile(req.file.path);
    }
    console.error("❌ Manage company documents error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload document",
    });
  }
};

/**
 * @desc    Get company driver requests (pending approvals)
 * @route   GET /api/company/driver-requests
 * @access  Private (Company)
 */
export const getCompanyDriverRequests = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [drivers, total] = await Promise.all([
      Driver.find({
        companyId: company._id,
        approvalStatus: "pending",
      })
        .populate("userId", "name phone email avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Driver.countDocuments({
        companyId: company._id,
        approvalStatus: "pending",
      }),
    ]);

    res.status(200).json({
      success: true,
      data: drivers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company driver requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver requests",
    });
  }
};

/**
 * @desc    Approve driver document
 * @route   POST /api/company/drivers/:driverId/approve-document
 * @access  Private (Company)
 */
export const approveDriverDocument = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { documentType } = req.body;

    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const driver = await Driver.findOne({
      _id: driverId,
      companyId: company._id,
    });

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    // Mark driver as verified if all required documents are verified
    const requiredDocs = ["licensePhoto", "vehiclePhoto", "insurancePhoto"];
    const hasAllDocs = requiredDocs.every((doc) => driver[doc]);

    if (hasAllDocs) {
      driver.isVerified = true;
      driver.approvalStatus = "approved";
      driver.approvedBy = req.user._id;
      driver.approvedAt = new Date();
    }

    await driver.save();

    // Notify driver
    const driverUser = await User.findById(driver.userId);
    if (driverUser) {
      await sendNotification({
        userId: driverUser._id,
        title: "✅ Account Verified",
        message: "Your driver account has been verified and approved",
        data: {
          type: "driver_approved",
          driverId: driver._id,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Driver approved successfully",
      data: {
        isVerified: driver.isVerified,
        approvalStatus: driver.approvalStatus,
        approvedAt: driver.approvedAt,
      },
    });
  } catch (error) {
    console.error("❌ Approve driver document error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve driver document",
    });
  }
};

/**
 * @desc    Suspend driver
 * @route   POST /api/company/drivers/:driverId/suspend
 * @access  Private (Company)
 */
export const suspendDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason } = req.body;

    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const driver = await Driver.findOne({
      _id: driverId,
      companyId: company._id,
    });

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    driver.isSuspended = true;
    driver.suspensionReason = reason;
    driver.suspendedAt = new Date();
    driver.isOnline = false;
    driver.isAvailable = false;

    await driver.save();

    // Notify driver
    const driverUser = await User.findById(driver.userId);
    if (driverUser) {
      await sendNotification({
        userId: driverUser._id,
        title: "⚠️ Account Suspended",
        message: `Your driver account has been suspended. Reason: ${reason}`,
        data: {
          type: "driver_suspended",
          driverId: driver._id,
          reason: reason,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Driver suspended successfully",
      data: {
        isSuspended: driver.isSuspended,
        suspensionReason: driver.suspensionReason,
        suspendedAt: driver.suspendedAt,
      },
    });
  } catch (error) {
    console.error("❌ Suspend driver error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to suspend driver",
    });
  }
};

/**
 * @desc    Activate driver
 * @route   POST /api/company/drivers/:driverId/activate
 * @access  Private (Company)
 */
export const activateDriver = async (req, res) => {
  try {
    const { driverId } = req.params;

    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const driver = await Driver.findOne({
      _id: driverId,
      companyId: company._id,
    });

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    driver.isSuspended = false;
    driver.suspensionReason = "";
    driver.suspendedAt = null;

    await driver.save();

    // Notify driver
    const driverUser = await User.findById(driver.userId);
    if (driverUser) {
      await sendNotification({
        userId: driverUser._id,
        title: "✅ Account Reactivated",
        message: "Your driver account has been reactivated",
        data: {
          type: "driver_reactivated",
          driverId: driver._id,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Driver activated successfully",
      data: {
        isSuspended: driver.isSuspended,
      },
    });
  } catch (error) {
    console.error("❌ Activate driver error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to activate driver",
    });
  }
};

/**
 * @desc    Get company notifications
 * @route   GET /api/company/notifications
 * @access  Private (Company)
 */
export const getCompanyNotifications = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // In a real app, you would have a Notification model
    // For now, we'll return a placeholder
    const notifications = [
      {
        id: "1",
        title: "New Driver Request",
        message: "John Doe has requested to join your company",
        type: "driver_request",
        read: false,
        createdAt: new Date(),
        data: { driverId: "123" },
      },
      {
        id: "2",
        title: "Delivery Completed",
        message: "Delivery #D-12345 has been completed successfully",
        type: "delivery_completed",
        read: true,
        createdAt: new Date(Date.now() - 3600000),
        data: { deliveryId: "D-12345" },
      },
    ];

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        total: notifications.length,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(notifications.length / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get notifications",
    });
  }
};

/**
 * @desc    Get company transactions
 * @route   GET /api/company/transactions
 * @access  Private (Company)
 */
export const getCompanyTransactions = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get company deliveries with earnings
    const deliveries = await Delivery.find({
      companyId: company._id,
      status: "delivered",
    })
      .select("deliveredAt fare.totalFare tip.amount driverId customerId")
      .populate("driverId", "plateNumber")
      .populate("driverDetails.userId", "name")
      .populate("customerId", "name")
      .sort({ deliveredAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Delivery.countDocuments({
      companyId: company._id,
      status: "delivered",
    });

    const transactions = deliveries.map((delivery) => ({
      id: delivery._id,
      date: delivery.deliveredAt,
      amount: delivery.fare.totalFare + (delivery.tip?.amount || 0),
      commission:
        (delivery.fare.totalFare + (delivery.tip?.amount || 0)) *
        (company.settings.commissionRate / 100),
      driver: delivery.driverDetails?.userId?.name || "Unknown Driver",
      customer: delivery.customerId?.name || "Unknown Customer",
      type: "delivery",
      status: "completed",
    }));

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get transactions",
    });
  }
};
