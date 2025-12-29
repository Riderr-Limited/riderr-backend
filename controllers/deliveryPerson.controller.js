// controllers/deliveryPerson.controller.js
import DeliveryPerson from "../models/deliveryPerson.model.js";
import Delivery from "../models/delivery.models.js";
import Ride from "../models/ride.model.js";

/**
 * @desc    Get nearby delivery persons
 * @route   GET /api/delivery-persons/nearby
 * @access  Private
 */
export const getNearbyDeliveryPersons = async (req, res) => {
  try {
    const { lat, lng, radius = 10000, serviceType, vehicleType } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const maxDistance = parseFloat(radius);

    // Find nearby persons
    const persons = await DeliveryPerson.findNearby(
      longitude,
      latitude,
      maxDistance,
      serviceType,
      vehicleType
    );

    res.status(200).json({
      success: true,
      message: `Found ${persons.length} nearby ${serviceType || 'delivery'} persons`,
      data: persons.map(person => ({
        _id: person._id,
        userId: person.userId,
        companyId: person.companyId,
        licenseNumber: person.licenseNumber,
        vehicleType: person.vehicleType,
        vehiclePlate: person.vehiclePlate,
        vehicleColor: person.vehicleColor,
        vehicleModel: person.vehicleModel,
        services: person.services,
        isAvailable: person.isAvailable,
        isOnline: person.isOnline,
        isVerified: person.isVerified,
        currentLocation: person.currentLocation,
        distance: person._doc.distance || 0,
        distanceText: `${(person._doc.distance || 0).toFixed(1)} km away`,
        estimatedArrival: Math.ceil((person._doc.distance || 0) * 3),
        totalDeliveries: person.totalDeliveries,
        totalRides: person.totalRides,
        averageRating: person.averageRating,
        createdAt: person.createdAt
      }))
    });

  } catch (error) {
    console.error("Get nearby delivery persons error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Update delivery person location
 * @route   PATCH /api/delivery-persons/location
 * @access  Private (Delivery Person)
 */
export const updateLocation = async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Only delivery persons can update location"
      });
    }

    const { lat, lng, address } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const deliveryPerson = await DeliveryPerson.findOne({ userId: user._id });
    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: "Delivery person profile not found"
      });
    }

    await deliveryPerson.updateLocation(
      parseFloat(lat),
      parseFloat(lng),
      address
    );

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        location: deliveryPerson.currentLocation
      }
    });

  } catch (error) {
    console.error("Update location error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Toggle online status
 * @route   PATCH /api/delivery-persons/online-status
 * @access  Private (Delivery Person)
 */
export const toggleOnlineStatus = async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Only delivery persons can toggle online status"
      });
    }

    const { isOnline } = req.body;

    if (typeof isOnline !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isOnline must be a boolean"
      });
    }

    const deliveryPerson = await DeliveryPerson.findOne({ userId: user._id });
    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: "Delivery person profile not found"
      });
    }

    try {
      if (isOnline) {
        await deliveryPerson.goOnline();
      } else {
        await deliveryPerson.goOffline();
      }

      // Refresh delivery person data
      const updatedPerson = await DeliveryPerson.findOne({ userId: user._id });

      res.status(200).json({
        success: true,
        message: `You are now ${isOnline ? 'online' : 'offline'}`,
        data: {
          isOnline: updatedPerson.isOnline,
          isAvailable: updatedPerson.isAvailable,
          services: updatedPerson.services
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }

  } catch (error) {
    console.error("Toggle online status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get delivery person profile
 * @route   GET /api/delivery-persons/profile
 * @access  Private (Delivery Person)
 */
export const getProfile = async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const deliveryPerson = await DeliveryPerson.findOne({ userId: user._id })
      .populate('userId', 'name email phone avatarUrl')
      .populate('companyId', 'name logo contactPhone');
    
    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: "Delivery person profile not found"
      });
    }

    // Get current assignments
    let currentDelivery = null;
    let currentRide = null;

    if (deliveryPerson.currentDeliveryId) {
      currentDelivery = await Delivery.findById(deliveryPerson.currentDeliveryId)
        .select('_id status pickup dropoff itemType');
    }

    if (deliveryPerson.currentRideId) {
      currentRide = await Ride.findById(deliveryPerson.currentRideId)
        .select('_id status pickup dropoff estimatedFare');
    }

    return res.status(200).json({
      success: true,
      data: {
        ...deliveryPerson.toObject(),
        currentDelivery,
        currentRide
      }
    });

  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Update delivery person services
 * @route   PATCH /api/delivery-persons/services
 * @access  Private (Delivery Person)
 */
export const updateServices = async (req, res) => {
  try {
    const user = req.user;
    const { deliveries, rides } = req.body;

    if (user.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const deliveryPerson = await DeliveryPerson.findOne({ userId: user._id });
    if (!deliveryPerson) {
      return res.status(404).json({
        success: false,
        message: "Delivery person profile not found"
      });
    }

    // Update services
    if (deliveries !== undefined) {
      deliveryPerson.services.deliveries = deliveries;
    }
    
    if (rides !== undefined) {
      deliveryPerson.services.rides = rides;
    }

    await deliveryPerson.save();

    res.status(200).json({
      success: true,
      message: "Services updated successfully",
      data: {
        services: deliveryPerson.services
      }
    });

  } catch (error) {
    console.error("Update services error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};