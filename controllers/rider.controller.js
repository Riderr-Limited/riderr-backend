// controllers/rider.controller.js
import Rider from "../models/rider.model.js";
import Driver from "../models/riders.models.js"; // Make sure this exports Driver model
import Delivery from "../models/delivery.models.js";

/**
 * @desc    Get nearby rider (for deliveries)
 * @route   GET /api/rider/nearby
 * @access  Private (Customer/Company Admin)
 */
export const getNearbyRiders = async (req, res) => {
  try {
    const { lat, lng, radius = 10000, vehicleType } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const maxDistance = parseFloat(radius); // in meters

    // Find riders within radius who are available and online
    const query = {
      isAvailable: true,
      isOnline: true,
      isVerified: true,
      currentDeliveryId: null,
      "currentLocation.lat": { $exists: true },
      "currentLocation.lng": { $exists: true }
    };

    if (vehicleType) {
      query.vehicleType = vehicleType;
    }

    const riders = await Rider.find(query).populate('userId', 'name phone avatarUrl');

    // Calculate distance for each rider and filter by radius
    const nearbyRiders = riders.filter(rider => {
      if (!rider.currentLocation?.lat || !rider.currentLocation?.lng) {
        return false;
      }

      const distance = calculateDistance(
        latitude,
        longitude,
        rider.currentLocation.lat,
        rider.currentLocation.lng
      );

      rider.distance = distance; // Add distance to rider object
      return distance <= maxDistance / 1000; // Convert meters to km for comparison
    });

    // Sort by distance
    nearbyRiders.sort((a, b) => a.distance - b.distance);

    res.status(200).json({
      success: true,
      message: "Nearby riders found",
      data: nearbyRiders.map(rider => ({
        _id: rider._id,
        userId: rider.userId,
        companyId: rider.companyId,
        licenseNumber: rider.licenseNumber,
        vehicleType: rider.vehicleType,
        vehiclePlate: rider.vehiclePlate,
        vehicleColor: rider.vehicleColor,
        vehicleModel: rider.vehicleModel,
        isAvailable: rider.isAvailable,
        isVerified: rider.isVerified,
        isOnline: rider.isOnline,
        currentDeliveryId: rider.currentDeliveryId,
        currentLocation: rider.currentLocation,
        totalDeliveries: rider.totalDeliveries,
        averageRating: rider.averageRating,
        distance: rider.distance,
        licensePhoto: rider.licensePhoto,
        vehiclePhoto: rider.vehiclePhoto,
        insurancePhoto: rider.insurancePhoto,
        createdAt: rider.createdAt,
        updatedAt: rider.updatedAt
      }))
    });

  } catch (error) {
    console.error("Get nearby riders error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get nearby drivers (for rides)
 * @route   GET /api/rider/drivers/nearby
 * @access  Private (Customer)
 */
export const getNearbyDrivers = async (req, res) => {
  try {
    const { lat, lng, radius = 10000, vehicleType } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const maxDistance = parseFloat(radius); // in meters

    // Use the static method from your Driver model
    // Note: The findNearby method expects [longitude, latitude] for MongoDB
    const drivers = await Driver.findNearby(
      longitude, 
      latitude,
      maxDistance,
      vehicleType
    );

    res.status(200).json({
      success: true,
      message: "Nearby drivers found",
      data: drivers.map(driver => ({
        _id: driver._id,
        userId: driver.userId,
        companyId: driver.companyId,
        licenseNumber: driver.licenseNumber,
        vehicleType: driver.vehicleType,
        vehicleMake: driver.vehicleMake,
        vehicleModel: driver.vehicleModel,
        vehicleYear: driver.vehicleYear,
        vehicleColor: driver.vehicleColor,
        plateNumber: driver.plateNumber,
        isAvailable: driver.isAvailable,
        isOnline: driver.isOnline,
        isActive: driver.isActive,
        isVerified: driver.isVerified,
        currentStatus: driver.currentStatus,
        location: driver.location,
        rating: driver.rating,
        stats: driver.stats,
        currentTripId: driver.currentTripId,
        documents: driver.documents,
        canAcceptRides: driver.canAcceptRides,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt
      }))
    });

  } catch (error) {
    console.error("Get nearby drivers error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Update rider location
 * @route   PATCH /api/rider/location
 * @access  Private (Rider)
 */
export const updateRiderLocation = async (req, res) => {
  try {
    const riderUser = req.user;
    
    if (riderUser.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Only riders can update location"
      });
    }

    const { lat, lng, address } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const rider = await Rider.findOne({ userId: riderUser._id });
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found"
      });
    }

    // Update location
    rider.currentLocation = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      address: address || rider.currentLocation?.address,
      updatedAt: new Date()
    };

    await rider.save();

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        location: rider.currentLocation
      }
    });

  } catch (error) {
    console.error("Update rider location error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Update driver location (for rides)
 * @route   PATCH /api/rider/drivers/location
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

    const { lat, lng, address } = req.body;

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

    // Update location using instance method
    await driver.updateLocation(
      parseFloat(lat),
      parseFloat(lng),
      address
    );

    // Refresh driver data
    const updatedDriver = await Driver.findOne({ userId: driverUser._id });

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        location: updatedDriver.location
      }
    });

  } catch (error) {
    console.error("Update driver location error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Toggle rider online status
 * @route   PATCH /api/rider/online-status
 * @access  Private (Rider)
 */
export const toggleRiderOnlineStatus = async (req, res) => {
  try {
    const riderUser = req.user;
    
    if (riderUser.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Only riders can toggle online status"
      });
    }

    const { isOnline } = req.body;

    if (typeof isOnline !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isOnline must be a boolean"
      });
    }

    const rider = await Rider.findOne({ userId: riderUser._id });
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found"
      });
    }

    // Validate if rider can go online
    if (isOnline) {
      if (!rider.isVerified) {
        return res.status(400).json({
          success: false,
          message: "Rider must be verified to go online"
        });
      }

      // Check required documents
      const requiredDocs = ['licensePhoto', 'vehiclePhoto', 'insurancePhoto'];
      const hasAllDocs = requiredDocs.every(doc => rider[doc]);
      
      if (!hasAllDocs) {
        return res.status(400).json({
          success: false,
          message: "Please upload all required documents first"
        });
      }

      // Check if rider has a current delivery
      if (rider.currentDeliveryId) {
        const delivery = await Delivery.findById(rider.currentDeliveryId);
        if (delivery && !['delivered', 'cancelled', 'failed'].includes(delivery.status)) {
          return res.status(400).json({
            success: false,
            message: "Cannot go online while on a delivery"
          });
        }
      }
    }

    rider.isOnline = isOnline;
    if (!isOnline) {
      rider.isAvailable = false;
    }
    
    await rider.save();

    res.status(200).json({
      success: true,
      message: `Rider is now ${isOnline ? 'online' : 'offline'}`,
      data: {
        isOnline: rider.isOnline,
        isAvailable: rider.isAvailable
      }
    });

  } catch (error) {
    console.error("Toggle rider online status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Toggle driver online status (for rides)
 * @route   PATCH /api/rider/drivers/online-status
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

    try {
      if (isOnline) {
        await driver.goOnline();
      } else {
        await driver.goOffline();
      }

      // Refresh driver data
      const updatedDriver = await Driver.findOne({ userId: driverUser._id });

      res.status(200).json({
        success: true,
        message: `Driver is now ${isOnline ? 'online' : 'offline'}`,
        data: {
          isOnline: updatedDriver.isOnline,
          isAvailable: updatedDriver.isAvailable,
          currentStatus: updatedDriver.currentStatus
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }

  } catch (error) {
    console.error("Toggle driver online status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get rider/driver profile
 * @route   GET /api/rider/profile
 * @access  Private (Rider/Driver)
 */
export const getRiderProfile = async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role === "rider") {
      const rider = await Rider.findOne({ userId: user._id })
        .populate('userId', 'name email phone avatarUrl')
        .populate('companyId', 'name logo contactPhone');
      
      if (!rider) {
        return res.status(404).json({
          success: false,
          message: "Rider profile not found"
        });
      }

      // Get current delivery if exists
      let currentDelivery = null;
      if (rider.currentDeliveryId) {
        currentDelivery = await Delivery.findById(rider.currentDeliveryId)
          .select('_id status pickup dropoff itemType');
      }

      return res.status(200).json({
        success: true,
        data: {
          ...rider.toObject(),
          currentDelivery
        }
      });
    } 
    else if (user.role === "driver") {
      const driver = await Driver.findOne({ userId: user._id })
        .populate('userId', 'name email phone avatarUrl')
        .populate('companyId', 'name logo contactPhone');
      
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver profile not found"
        });
      }

      return res.status(200).json({
        success: true,
        data: driver
      });
    }
    else {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

  } catch (error) {
    console.error("Get rider/driver profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}