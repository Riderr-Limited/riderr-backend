import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Delivery from "../models/delivery.models.js";
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import { sendNotification } from "../utils/notification.js";

/**
 * -------------------------------
 * UTILITY FUNCTIONS
 * -------------------------------
 */

// Calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

// Validate driver can go online
const validateDriverForOnline = async (driver) => {
  const errors = [];

  // Check if driver is verified
  if (!driver.isVerified) {
    errors.push("Driver must be verified by admin");
  }

  // Check required documents
  const requiredDocs = ['licensePhoto', 'vehiclePhoto', 'insurancePhoto'];
  const missingDocs = requiredDocs.filter(doc => !driver[doc]);
  
  if (missingDocs.length > 0) {
    errors.push(`Missing required documents: ${missingDocs.join(', ')}`);
  }

  // Check license expiry
  if (driver.licenseExpiry && new Date(driver.licenseExpiry) < new Date()) {
    errors.push("Driver license has expired");
  }

  // Check if driver has a current delivery
  if (driver.currentDeliveryId) {
    const delivery = await Delivery.findById(driver.currentDeliveryId);
    if (delivery && !['delivered', 'cancelled', 'failed'].includes(delivery.status)) {
      errors.push("Cannot go online while on an active delivery");
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * -------------------------------
 * DRIVER CONTROLLERS
 * -------------------------------
 */

/**
 * @desc    Get driver profile
 * @route   GET /api/drivers/profile
 * @access  Private (Driver)
 */
export const getDriverProfile = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id })
      .populate('userId', 'name email phone avatarUrl rating')
      .populate('companyId', 'name logo contactPhone address')
      .populate('currentDeliveryId', 'status pickup dropoff estimatedFare');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
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
            status: 'delivered',
            deliveredAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalDeliveries: { $sum: 1 },
            totalEarnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
            averageRating: { $avg: '$rating' },
            totalDistance: { $sum: '$estimatedDistanceKm' }
          }
        }
      ]),
      Delivery.find({
        driverId: driver._id,
        status: 'delivered'
      })
      .sort({ deliveredAt: -1 })
      .limit(5)
      .select('deliveredAt fare.actualTotal tip.amount rating pickup.address dropoff.address')
    ]);

    const driverStats = stats[0] || {
      totalDeliveries: 0,
      totalEarnings: 0,
      averageRating: 0,
      totalDistance: 0
    };

    // Calculate acceptance rate
    const acceptanceRate = driver.totalRequests 
      ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
      : 0;

    // Calculate online hours (simplified)
    const onlineHours = driver.totalOnlineHours || 0;

    res.status(200).json({
      success: true,
      data: {
        ...driver.toObject(),
        stats: {
          ...driverStats,
          acceptanceRate,
          onlineHours,
          totalRequests: driver.totalRequests || 0,
          acceptedRequests: driver.acceptedRequests || 0
        },
        recentDeliveries,
        canGoOnline: (await validateDriverForOnline(driver)).isValid
      }
    });

  } catch (error) {
    console.error("Get driver profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver profile"
    });
  }
};

/**
 * @desc    Update driver profile
 * @route   PUT /api/drivers/profile
 * @access  Private (Driver)
 */
export const updateDriverProfile = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array()
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
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
      canAcceptDeliveries
    } = req.body;

    // Update allowed fields
    const updates = {};
    
    if (vehicleMake !== undefined) updates.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined) updates.vehicleModel = vehicleModel;
    if (vehicleYear !== undefined) updates.vehicleYear = vehicleYear;
    if (vehicleColor !== undefined) updates.vehicleColor = vehicleColor;
    if (plateNumber !== undefined) updates.plateNumber = plateNumber.toUpperCase();
    if (licenseNumber !== undefined) updates.licenseNumber = licenseNumber.toUpperCase();
    if (licenseExpiry !== undefined) updates.licenseExpiry = new Date(licenseExpiry);
    if (canAcceptDeliveries !== undefined) updates.canAcceptDeliveries = canAcceptDeliveries;

    // If license details changed, mark as unverified
    if (licenseNumber || licenseExpiry) {
      updates.isVerified = false;
      updates.approvalStatus = "pending";
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      driver._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('userId', 'name email phone');

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedDriver
    });

  } catch (error) {
    console.error("Update driver profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile"
    });
  }
};

/**
 * @desc    Upload driver documents
 * @route   POST /api/drivers/documents
 * @access  Private (Driver)
 */
export const uploadDriverDocuments = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const {
      licensePhoto,
      vehiclePhoto,
      insurancePhoto,
      idCardPhoto,
      vehicleRegistrationPhoto
    } = req.body;

    // Update document URLs
    const updates = {};
    
    if (licensePhoto !== undefined) updates.licensePhoto = licensePhoto;
    if (vehiclePhoto !== undefined) updates.vehiclePhoto = vehiclePhoto;
    if (insurancePhoto !== undefined) updates.insurancePhoto = insurancePhoto;
    if (idCardPhoto !== undefined) updates.idCardPhoto = idCardPhoto;
    if (vehicleRegistrationPhoto !== undefined) updates.vehicleRegistrationPhoto = vehicleRegistrationPhoto;

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
        licensePhoto: updatedDriver.licensePhoto,
        vehiclePhoto: updatedDriver.vehiclePhoto,
        insurancePhoto: updatedDriver.insurancePhoto,
        idCardPhoto: updatedDriver.idCardPhoto,
        vehicleRegistrationPhoto: updatedDriver.vehicleRegistrationPhoto,
        isVerified: updatedDriver.isVerified,
        approvalStatus: updatedDriver.approvalStatus
      }
    });

  } catch (error) {
    console.error("Upload driver documents error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload documents"
    });
  }
};

/**
 * @desc    Update driver location
 * @route   POST /api/drivers/location
 * @access  Private (Driver)
 */
export const updateDriverLocation = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can update location"
      });
    }

    const { lat, lng, address, accuracy, heading, speed } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Check if driver is online
    if (!driver.isOnline) {
      return res.status(400).json({
        success: false,
        message: "Driver must be online to update location"
      });
    }

    // Update location
    driver.currentLocation = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      address: address || driver.currentLocation?.address,
      accuracy: accuracy ? parseFloat(accuracy) : null,
      heading: heading ? parseFloat(heading) : null,
      speed: speed ? parseFloat(speed) : null,
      updatedAt: new Date()
    };

    // Update last location update time
    driver.lastLocationUpdate = new Date();

    await driver.save();

    // If driver has current delivery, update delivery tracking
    if (driver.currentDeliveryId && driver.currentDeliveryId.status === "picked_up") {
      const delivery = await Delivery.findById(driver.currentDeliveryId);
      if (delivery) {
        if (!delivery.tracking) {
          delivery.tracking = {
            startedAt: new Date(),
            locations: []
          };
        }

        delivery.tracking.locations.push({
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          timestamp: new Date(),
          accuracy: accuracy ? parseFloat(accuracy) : null,
          heading: heading ? parseFloat(heading) : null,
          speed: speed ? parseFloat(speed) : null
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
        updatedAt: driver.lastLocationUpdate
      }
    });

  } catch (error) {
    console.error("Update driver location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location"
    });
  }
};

/**
 * @desc    Toggle driver online status
 * @route   POST /api/drivers/online-status
 * @access  Private (Driver)
 */
export const toggleDriverOnlineStatus = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can toggle online status"
      });
    }

    const { isOnline } = req.body;

    if (typeof isOnline !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isOnline must be a boolean"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    //// Validate if driver can go online
    //if (isOnline) {
    //  const validation = await validateDriverForOnline(driver);
    //  if (!validation.isValid) {
    //    return res.status(400).json({
    //      success: false,
    //      message: "Cannot go online",
    //      errors: validation.errors
    //    });
    //  }
    //}

    // Update status
    driver.isOnline = isOnline;
    
    if (!isOnline) {
      driver.isAvailable = false;
      driver.canAcceptDeliveries = false;
      
      // Record online session
      if (driver.lastOnlineStart) {
        const sessionDuration = Date.now() - driver.lastOnlineStart.getTime();
        driver.totalOnlineHours = (driver.totalOnlineHours || 0) + (sessionDuration / 3600000); // Convert ms to hours
        driver.lastOnlineStart = null;
      }
    } else {
      driver.canAcceptDeliveries = true;
      driver.lastOnlineStart = new Date();
    }
    
    await driver.save();

    res.status(200).json({
      success: true,
      message: `Driver is now ${isOnline ? 'online' : 'offline'}`,
      data: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        canAcceptDeliveries: driver.canAcceptDeliveries
      }
    });

  } catch (error) {
    console.error("Toggle driver online status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update online status"
    });
  }
};

/**
 * @desc    Update driver availability
 * @route   POST /api/drivers/availability
 * @access  Private (Driver)
 */
export const updateDriverAvailability = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can update availability"
      });
    }

    const { isAvailable } = req.body;

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isAvailable must be a boolean"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Check if driver can become available
    if (isAvailable) {
      if (!driver.isOnline) {
        return res.status(400).json({
          success: false,
          message: "Must be online to become available"
        });
      }

      if (driver.currentDeliveryId) {
        const delivery = await Delivery.findById(driver.currentDeliveryId);
        if (delivery && !['delivered', 'cancelled', 'failed'].includes(delivery.status)) {
          return res.status(400).json({
            success: false,
            message: "Cannot become available while on a delivery"
          });
        }
      }

      if (!driver.canAcceptDeliveries) {
        return res.status(400).json({
          success: false,
          message: "Driver is not allowed to accept deliveries"
        });
      }
    }

    driver.isAvailable = isAvailable;
    await driver.save();

    res.status(200).json({
      success: true,
      message: `Driver is now ${isAvailable ? 'available' : 'unavailable'} for deliveries`,
      data: {
        isAvailable: driver.isAvailable
      }
    });

  } catch (error) {
    console.error("Update driver availability error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update availability"
    });
  }
};

/**
 * @desc    Get driver's current delivery
 * @route   GET /api/drivers/current-delivery
 * @access  Private (Driver)
 */
export const getCurrentDelivery = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    if (!driver.currentDeliveryId) {
      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null
      });
    }

    const delivery = await Delivery.findById(driver.currentDeliveryId)
      .populate('customerId', 'name phone avatarUrl rating')
      .populate('companyId', 'name contactPhone logo');

    if (!delivery) {
      // If delivery doesn't exist, clear the reference
      driver.currentDeliveryId = null;
      driver.isAvailable = true;
      await driver.save();
      
      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null
      });
    }

    // Calculate ETA if in transit
    let eta = null;
    let etaMinutes = null;
    
    if (delivery.status === "picked_up" && delivery.tracking?.locations?.length > 0) {
      const lastLocation = delivery.tracking.locations[delivery.tracking.locations.length - 1];
      const distanceToDropoff = calculateDistance(
        lastLocation.lat,
        lastLocation.lng,
        delivery.dropoff.lat,
        delivery.dropoff.lng
      );
      etaMinutes = Math.ceil(distanceToDropoff * 3); // 3 min per km
      eta = new Date(Date.now() + (etaMinutes * 60000));
    }

    res.status(200).json({
      success: true,
      data: {
        ...delivery.toObject(),
        eta,
        etaMinutes,
        nextAction: getNextAction(delivery.status)
      }
    });

  } catch (error) {
    console.error("Get current delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get current delivery"
    });
  }
};

/**
 * @desc    Get driver earnings
 * @route   GET /api/drivers/earnings
 * @access  Private (Driver)
 */
export const getDriverEarnings = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const { period = 'week', startDate, endDate } = req.query;
    
    let matchStage = { driverId: driver._id, status: 'delivered' };
    
    // Apply date filter
    if (startDate && endDate) {
      matchStage.deliveredAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else {
      // Default to period filter
      const date = new Date();
      switch (period) {
        case 'today':
          date.setHours(0, 0, 0, 0);
          matchStage.deliveredAt = { $gte: date };
          break;
        case 'week':
          date.setDate(date.getDate() - 7);
          matchStage.deliveredAt = { $gte: date };
          break;
        case 'month':
          date.setMonth(date.getMonth() - 1);
          matchStage.deliveredAt = { $gte: date };
          break;
        case 'year':
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
          totalEarnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
          totalDeliveries: { $sum: 1 },
          totalDistance: { $sum: '$estimatedDistanceKm' },
          totalTips: { $sum: '$tip.amount' },
          averageRating: { $avg: '$rating' }
        }
      }
    ]);

    // Get daily earnings for chart
    const dailyEarnings = await Delivery.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: 'delivered',
          deliveredAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$deliveredAt" } },
          earnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
          deliveries: { $sum: 1 }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    const result = earnings[0] || {
      totalEarnings: 0,
      totalDeliveries: 0,
      totalDistance: 0,
      totalTips: 0,
      averageRating: 0
    };

    res.status(200).json({
      success: true,
      data: {
        summary: result,
        dailyEarnings,
        period,
        currency: "NGN"
      }
    });

  } catch (error) {
    console.error("Get driver earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get earnings"
    });
  }
};

/**
 * @desc    Get driver statistics
 * @route   GET /api/drivers/stats
 * @access  Private (Driver)
 */
export const getDriverStats = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
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
      ratingDistribution
    ] = await Promise.all([
      // Today's stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: 'delivered',
            deliveredAt: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            earnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
            deliveries: { $sum: 1 },
            distance: { $sum: '$estimatedDistanceKm' }
          }
        }
      ]),
      
      // Week's stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: 'delivered',
            deliveredAt: { $gte: weekAgo }
          }
        },
        {
          $group: {
            _id: null,
            earnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
            deliveries: { $sum: 1 },
            distance: { $sum: '$estimatedDistanceKm' }
          }
        }
      ]),
      
      // Month's stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: 'delivered',
            deliveredAt: { $gte: monthAgo }
          }
        },
        {
          $group: {
            _id: null,
            earnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
            deliveries: { $sum: 1 },
            distance: { $sum: '$estimatedDistanceKm' }
          }
        }
      ]),
      
      // All time stats
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: 'delivered'
          }
        },
        {
          $group: {
            _id: null,
            earnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
            deliveries: { $sum: 1 },
            distance: { $sum: '$estimatedDistanceKm' },
            averageRating: { $avg: '$rating' }
          }
        }
      ]),
      
      // Rating distribution
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: 'delivered',
            rating: { $exists: true }
          }
        },
        {
          $group: {
            _id: '$rating',
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
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
        today: todayStats[0] || { earnings: 0, deliveries: 0, distance: 0 },
        week: weekStats[0] || { earnings: 0, deliveries: 0, distance: 0 },
        month: monthStats[0] || { earnings: 0, deliveries: 0, distance: 0 },
        allTime: allTimeStats[0] || { earnings: 0, deliveries: 0, distance: 0, averageRating: 0 },
        ratingDistribution: ratingDistribution.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        acceptanceRate,
        onlineHours,
        currentStatus: {
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          hasActiveDelivery: !!driver.currentDeliveryId
        }
      }
    });

  } catch (error) {
    console.error("Get driver stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get statistics"
    });
  }
};

/**
 * @desc    Get available delivery requests
 * @route   GET /api/drivers/requests
 * @access  Private (Driver)
 */
export const getDeliveryRequests = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Check if driver is available
    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      return res.status(400).json({
        success: false,
        message: "Driver is not available for new requests"
      });
    }

    const { lat, lng, radius = 10 } = req.query;

    // Use driver's current location if not provided
    const latitude = lat ? parseFloat(lat) : driver.currentLocation?.lat;
    const longitude = lng ? parseFloat(lng) : driver.currentLocation?.lng;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Location is required"
      });
    }

    // Find deliveries that are searching for drivers
    const deliveries = await Delivery.find({
      status: "searching",
      "broadcastedTo": driver._id,
      "broadcastedAt": { $gte: new Date(Date.now() - 60000) } // Last 60 seconds
    })
    .populate('customerId', 'name rating')
    .sort({ createdAt: -1 });

    // Calculate distance for each delivery
    const deliveriesWithDistance = deliveries.map(delivery => {
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
        estimatedPickupTime: Math.ceil(distance * 3) // 3 min per km
      };
    });

    // Filter by radius
    const filteredDeliveries = deliveriesWithDistance.filter(d => d.distance <= radius);

    res.status(200).json({
      success: true,
      data: filteredDeliveries,
      count: filteredDeliveries.length
    });

  } catch (error) {
    console.error("Get delivery requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery requests"
    });
  }
};

/**
 * @desc    Update driver settings
 * @route   PUT /api/drivers/settings
 * @access  Private (Driver)
 */
export const updateDriverSettings = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const {
      notifications,
      autoAccept,
      maxDistance,
      minFare,
      workingHours,
      preferredAreas
    } = req.body;

    // Update settings
    const updates = {};
    
    if (notifications !== undefined) updates.notifications = notifications;
    if (autoAccept !== undefined) updates.autoAccept = autoAccept;
    if (maxDistance !== undefined) updates.maxDistance = parseFloat(maxDistance);
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
        preferredAreas: updatedDriver.preferredAreas
      }
    });

  } catch (error) {
    console.error("Update driver settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update settings"
    });
  }
};

// Helper function to determine next action
const getNextAction = (status) => {
  switch (status) {
    case "assigned":
      return "Proceed to pickup location";
    case "picked_up":
      return "Proceed to dropoff location";
    case "in_transit":
      return "Continue to dropoff location";
    default:
      return "Wait for instructions";
  }
};