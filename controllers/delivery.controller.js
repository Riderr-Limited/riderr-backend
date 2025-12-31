import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import { calculateFare } from "../utils/fareCalculator.js";
import { sendNotification } from "../utils/notification.js";

/**
 * -------------------------------
 * UTILITY FUNCTIONS
 * -------------------------------
 */

// Calculate distance between two coordinates (Haversine formula)
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

// Find nearby available drivers
const findNearbyDrivers = async (lat, lng, radius = 10, vehicleType = null) => {
  try {
    const drivers = await Driver.find({
      isOnline: true,
      isAvailable: true,
      canAcceptDeliveries: true,
      currentDeliveryId: null,
      "currentLocation.lat": { $exists: true },
      "currentLocation.lng": { $exists: true },
      approvalStatus: "approved",
      ...(vehicleType && { vehicleType })
    }).populate('userId', 'name phone avatarUrl rating');

    // Filter by distance and calculate distance
    const nearbyDrivers = drivers.filter(driver => {
      const driverLat = driver.currentLocation.lat;
      const driverLng = driver.currentLocation.lng;
      
      if (!driverLat || !driverLng) return false;
      
      const distance = calculateDistance(lat, lng, driverLat, driverLng);
      driver._doc.distance = distance;
      return distance <= radius;
    });

    // Sort by distance and rating
    return nearbyDrivers.sort((a, b) => {
      if (a._doc.distance === b._doc.distance) {
        return (b.userId?.rating || 0) - (a.userId?.rating || 0);
      }
      return a._doc.distance - b._doc.distance;
    });

  } catch (error) {
    console.error("Find nearby drivers error:", error);
    return [];
  }
};

// Send delivery request to multiple drivers
const broadcastDeliveryRequest = async (delivery, drivers) => {
  try {
    const notifications = drivers.map(driver => ({
      userId: driver.userId._id,
      title: "New Delivery Request",
      message: `New delivery from ${delivery.pickup.name} to ${delivery.dropoff.name}`,
      data: {
        type: "delivery_request",
        deliveryId: delivery._id,
        pickup: delivery.pickup,
        dropoff: delivery.dropoff,
        estimatedFare: delivery.fare.totalFare,
        distance: delivery.estimatedDistanceKm,
        expiresIn: 60 // 60 seconds to accept
      }
    }));

    // Send push notifications
    await Promise.all(notifications.map(notification => 
      sendNotification(notification)
    ));

    // Update delivery with broadcast info
    delivery.broadcastedTo = drivers.map(d => d._id);
    delivery.broadcastedAt = new Date();
    delivery.status = "searching";
    await delivery.save();

    return true;
  } catch (error) {
    console.error("Broadcast delivery error:", error);
    return false;
  }
};

/**
 * -------------------------------
 * CUSTOMER CONTROLLERS
 * -------------------------------
 */

/**
 * @desc    Create delivery request (broadcast to nearby drivers)
 * @route   POST /api/deliveries/request
 * @access  Private (Customer)
 */
export const createDeliveryRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const customer = req.user;
    
    // Validate customer role
    if (customer.role !== "customer") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only customers can create deliveries"
      });
    }

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array()
      });
    }

    const {
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupName,
      pickupPhone,
      pickupInstructions,
      
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      recipientName,
      recipientPhone,
      dropoffInstructions,
      
      itemType,
      itemDescription,
      itemWeight,
      itemDimensions,
      itemValue,
      isFragile,
      
      paymentMethod,
      estimatedValue,
      specialInstructions,
      vehicleType,
      scheduleFor
    } = req.body;

    // Validate coordinates
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff coordinates are required"
      });
    }

    // Validate recipient details
    if (!recipientName || !recipientPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Recipient name and phone are required"
      });
    }

    // Calculate distance
    const distance = calculateDistance(
      parseFloat(pickupLat),
      parseFloat(pickupLng),
      parseFloat(dropoffLat),
      parseFloat(dropoffLng)
    );

    // Calculate fare
    const fareDetails = calculateFare({
      distance,
      itemWeight: parseFloat(itemWeight) || 1,
      itemType,
      vehicleType: vehicleType || "bike",
      isFragile: isFragile || false,
      itemValue: parseFloat(itemValue) || 0
    });

    // Create delivery object
    const deliveryData = {
      customerId: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,
      
      pickup: {
        address: pickupAddress,
        lat: parseFloat(pickupLat),
        lng: parseFloat(pickupLng),
        name: pickupName || "Pickup Location",
        phone: pickupPhone || customer.phone,
        instructions: pickupInstructions
      },
      
      dropoff: {
        address: dropoffAddress,
        lat: parseFloat(dropoffLat),
        lng: parseFloat(dropoffLng),
        name: recipientName || "Dropoff Location",
        phone: recipientPhone,
        instructions: dropoffInstructions
      },
      
      recipientName: recipientName,
      recipientPhone: recipientPhone,
      
      itemDetails: {
        type: itemType || "parcel",
        description: itemDescription,
        weight: parseFloat(itemWeight) || 1,
        dimensions: itemDimensions,
        value: parseFloat(itemValue) || 0,
        isFragile: isFragile || false,
        images: req.body.itemImages || []
      },
      
      fare: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.distanceFare,
        weightFare: fareDetails.weightFare,
        specialFare: fareDetails.specialFare,
        totalFare: fareDetails.totalFare,
        currency: "NGN"
      },
      
      estimatedDistanceKm: distance,
      estimatedDurationMin: Math.ceil(distance * 3), // 3 minutes per km
      
      payment: {
        method: paymentMethod || "cash",
        status: paymentMethod === "cash" ? "pending" : "pending_payment",
        estimatedValue: parseFloat(estimatedValue) || fareDetails.totalFare
      },
      
      instructions: {
        special: specialInstructions,
        vehiclePreference: vehicleType,
        requiresProof: itemValue > 10000 // Require proof for high-value items
      },
      
      schedule: {
        isScheduled: !!scheduleFor,
        scheduledFor: scheduleFor ? new Date(scheduleFor) : null
      },
      
      // SIMPLIFIED: Start with "created" status only
      status: "created",
      meta: {
        platform: req.headers['x-platform'] || 'web',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    };

    // Create delivery
    const delivery = new Delivery(deliveryData);
    await delivery.save({ session });

    // Find nearby drivers (but don't broadcast immediately)
    const nearbyDrivers = await findNearbyDrivers(
      parseFloat(pickupLat),
      parseFloat(pickupLng),
      10, // 10km radius
      vehicleType
    );

    // Store nearby drivers info but don't broadcast yet
    if (nearbyDrivers.length > 0) {
      // Just log for now - actual broadcasting will happen via scheduled job or separate endpoint
      console.log(`Found ${nearbyDrivers.length} nearby drivers for delivery ${delivery._id}`);
      
      // Store the nearest driver info for quick access
      const nearestDriver = nearbyDrivers[0];
      delivery.nearestDriver = {
        driverId: nearestDriver._id,
        distance: nearestDriver._doc.distance,
        estimatedArrival: Math.ceil(nearestDriver._doc.distance * 3)
      };
    } else {
      console.log(`No nearby drivers found for delivery ${delivery._id}`);
      // Just leave as "created" - no special status
    }

    await delivery.save({ session });

    await session.commitTransaction();
    session.endSession();

    // SIMPLIFIED RESPONSE: Just confirm delivery created
    res.status(201).json({
      success: true,
      message: "Delivery request created successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          pickup: delivery.pickup,
          dropoff: delivery.dropoff,
          recipientName: delivery.recipientName,
          recipientPhone: delivery.recipientPhone,
          itemDetails: delivery.itemDetails,
          fare: delivery.fare,
          estimatedDistanceKm: delivery.estimatedDistanceKm,
          estimatedDurationMin: delivery.estimatedDurationMin,
          payment: delivery.payment,
          instructions: delivery.instructions,
          schedule: delivery.schedule,
          createdAt: delivery.createdAt,
          // Include nearby drivers count but don't change status
          nearbyDriversCount: nearbyDrivers.length,
          estimatedWaitTime: nearbyDrivers.length > 0 ? "Searching for drivers..." : "Waiting for drivers to come online"
        }
      }
    });

    // AFTER RESPONSE: Start searching for drivers in background
    if (nearbyDrivers.length > 0) {
      // Start broadcasting to drivers
      setTimeout(async () => {
        try {
          const updatedDelivery = await Delivery.findById(delivery._id);
          if (updatedDelivery && updatedDelivery.status === "created") {
            await broadcastDeliveryRequest(updatedDelivery, nearbyDrivers);
          }
        } catch (error) {
          console.error("Background broadcast error:", error);
        }
      }, 1000); // 1 second delay
    }

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Create delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create delivery request",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get nearby available drivers for customer
 * @route   GET /api/deliveries/nearby-drivers
 * @access  Private (Customer)
 */
export const getNearbyDrivers = async (req, res) => {
  try {
    const { lat, lng, radius = 10, vehicleType } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    const drivers = await findNearbyDrivers(latitude, longitude, searchRadius, vehicleType);

    // Format response
    const formattedDrivers = drivers.map(driver => ({
      _id: driver._id,
      userId: {
        _id: driver.userId?._id,
        name: driver.userId?.name,
        phone: driver.userId?.phone,
        avatarUrl: driver.userId?.avatarUrl,
        rating: driver.userId?.rating || 0
      },
      companyId: driver.companyId,
      licenseNumber: driver.licenseNumber,
      vehicleType: driver.vehicleType,
      vehicleMake: driver.vehicleMake,
      vehicleModel: driver.vehicleModel,
      vehicleYear: driver.vehicleYear,
      vehicleColor: driver.vehicleColor,
      plateNumber: driver.plateNumber,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      canAcceptDeliveries: driver.canAcceptDeliveries,
      currentLocation: driver.currentLocation,
      distance: driver._doc.distance,
      distanceText: `${driver._doc.distance.toFixed(1)} km away`,
      estimatedArrival: Math.ceil(driver._doc.distance * 3), // 3 min per km
      averageRating: driver.rating || 0,
      totalDeliveries: driver.totalDeliveries || 0,
      earnings: driver.earnings || 0,
      acceptanceRate: driver.acceptanceRate || 0
    }));

    res.status(200).json({
      success: true,
      message: `Found ${formattedDrivers.length} nearby drivers`,
      data: formattedDrivers
    });

  } catch (error) {
    console.error("Get nearby drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to find nearby drivers"
    });
  }
};

/**
 * -------------------------------
 * DRIVER CONTROLLERS - DELIVERY REQUESTS
 * -------------------------------
 */

/**
 * @desc    Get nearby delivery requests for driver
 * @route   GET /api/deliveries/driver/nearby
 * @access  Private (Driver)
 */
export const getNearbyDeliveryRequests = async (req, res) => {
  try {
    const driverUser = req.user;
    
    // Validate driver role
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can view delivery requests"
      });
    }

    const { lat, lng, radius = 10, maxDistance = 10 } = req.query;

    // Use provided location or driver's current location
    let latitude, longitude;
    
    if (lat && lng) {
      latitude = parseFloat(lat);
      longitude = parseFloat(lng);
    } else {
      // Get driver's current location
      const driver = await Driver.findOne({ userId: driverUser._id });
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver profile not found"
        });
      }
      
      if (!driver.currentLocation?.lat || !driver.currentLocation?.lng) {
        return res.status(400).json({
          success: false,
          message: "Driver location not available. Please update your location."
        });
      }
      
      latitude = driver.currentLocation.lat;
      longitude = driver.currentLocation.lng;
    }

    // Find available deliveries
    const deliveries = await Delivery.find({
      status: "created", // Only show created deliveries (not yet assigned)
      driverId: { $exists: false }, // Not assigned to any driver
      $or: [
        { broadcastedTo: { $exists: false } },
        { $and: [
          { broadcastedTo: { $exists: true } },
          { broadcastedTo: { $ne: driverUser.driverId } } // Not already broadcasted to this driver
        ]}
      ],
      createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes only
    })
    .populate('customerId', 'name phone avatarUrl rating')
    .sort({ createdAt: -1 })
    .limit(50); // Limit results for performance

    // Calculate distance for each delivery and filter by radius
    const nearbyDeliveries = [];
    
    for (const delivery of deliveries) {
      const distance = calculateDistance(
        latitude,
        longitude,
        delivery.pickup.lat,
        delivery.pickup.lng
      );
      
      // Check if within radius
      if (distance <= parseFloat(maxDistance)) {
        // Calculate fare (if not already calculated)
        if (!delivery.fare?.totalFare) {
          const fareDetails = calculateFare({
            distance,
            itemWeight: delivery.itemDetails.weight || 1,
            itemType: delivery.itemDetails.type || "parcel",
            vehicleType: delivery.instructions?.vehiclePreference || "bike",
            isFragile: delivery.itemDetails.isFragile || false,
            itemValue: delivery.itemDetails.value || 0
          });
          
          delivery.fare = {
            baseFare: fareDetails.baseFare,
            distanceFare: fareDetails.distanceFare,
            weightFare: fareDetails.weightFare,
            specialFare: fareDetails.specialFare,
            totalFare: fareDetails.totalFare,
            currency: "NGN"
          };
        }
        
        // Format delivery for response
        const formattedDelivery = {
          _id: delivery._id,
          pickup: {
            address: delivery.pickup.address,
            lat: delivery.pickup.lat,
            lng: delivery.pickup.lng,
            name: delivery.pickup.name,
            phone: delivery.pickup.phone,
            instructions: delivery.pickup.instructions
          },
          dropoff: {
            address: delivery.dropoff.address,
            lat: delivery.dropoff.lat,
            lng: delivery.dropoff.lng,
            name: delivery.dropoff.name,
            phone: delivery.dropoff.phone,
            instructions: delivery.dropoff.instructions
          },
          recipientName: delivery.recipientName,
          recipientPhone: delivery.recipientPhone,
          itemDetails: delivery.itemDetails,
          fare: delivery.fare,
          estimatedDistanceKm: delivery.estimatedDistanceKm || distance,
          estimatedDurationMin: delivery.estimatedDurationMin || Math.ceil(distance * 3),
          payment: delivery.payment,
          instructions: delivery.instructions,
          customer: delivery.customerId,
          createdAt: delivery.createdAt,
          distance: parseFloat(distance.toFixed(2)),
          distanceText: `${distance.toFixed(1)} km away`,
          estimatedPickupTime: Math.ceil(distance * 3), // 3 min per km
          canAccept: true
        };
        
        nearbyDeliveries.push(formattedDelivery);
      }
    }

    // Sort by distance (closest first)
    nearbyDeliveries.sort((a, b) => a.distance - b.distance);

    res.status(200).json({
      success: true,
      message: `Found ${nearbyDeliveries.length} nearby delivery requests`,
      data: {
        deliveries: nearbyDeliveries,
        driverLocation: { lat: latitude, lng: longitude },
        searchRadius: maxDistance,
        count: nearbyDeliveries.length
      }
    });

  } catch (error) {
    console.error("Get nearby deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get nearby deliveries"
    });
  }
};

/**
 * @desc    Driver accepts a delivery request
 * @route   POST /api/deliveries/:deliveryId/accept
 * @access  Private (Driver)
 */
export const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    // Validate driver role
    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can accept deliveries"
      });
    }

    // Find driver profile
    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Check if driver is available
    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Driver is not available to accept new deliveries"
      });
    }

    // Find delivery
    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check if delivery is still available
    if (delivery.status !== "created" && delivery.status !== "searching") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery is no longer available (status: ${delivery.status})`
      });
    }

    // Check if already assigned to another driver
    if (delivery.driverId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery already assigned to another driver"
      });
    }

    // Calculate distance from driver to pickup
    let driverToPickupDistance = 5; // Default if no location
    if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      driverToPickupDistance = calculateDistance(
        driver.currentLocation.lat,
        driver.currentLocation.lng,
        delivery.pickup.lat,
        delivery.pickup.lng
      );
    }

    // Assign delivery to driver
    delivery.driverId = driver._id;
    delivery.companyId = driver.companyId;
    delivery.status = "assigned";
    delivery.assignedAt = new Date();
    delivery.acceptedAt = new Date();
    delivery.estimatedPickupTime = new Date(Date.now() + (driverToPickupDistance * 3 * 60000)); // 3 min per km

    // Update driver status
    driver.currentDeliveryId = delivery._id;
    driver.isAvailable = false;
    
    // Update driver stats
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    driver.acceptedRequests = (driver.acceptedRequests || 0) + 1;
    driver.acceptanceRate = Math.round((driver.acceptedRequests / driver.totalRequests) * 100);

    await Promise.all([
      delivery.save({ session }),
      driver.save({ session })
    ]);

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      // Send push notification
      await sendNotification({
        userId: customer._id,
        title: "🎉 Driver Assigned!",
        message: `Driver ${driverUser.name} has accepted your delivery`,
        data: {
          type: "driver_assigned",
          deliveryId: delivery._id,
          driver: {
            name: driverUser.name,
            phone: driverUser.phone,
            vehicle: `${driver.vehicleMake || ''} ${driver.vehicleModel || ''}`.trim() || 'Vehicle',
            plateNumber: driver.plateNumber,
            rating: driver.rating || 0,
            photo: driverUser.avatarUrl
          },
          estimatedPickupTime: delivery.estimatedPickupTime,
          estimatedArrival: `${Math.ceil(driverToPickupDistance * 3)} minutes`
        }
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
          recipientName: delivery.recipientName,
          recipientPhone: delivery.recipientPhone,
          estimatedPickupTime: delivery.estimatedPickupTime,
          fare: delivery.fare
        },
        driver: {
          _id: driver._id,
          name: driverUser.name,
          phone: driverUser.phone,
          vehicle: `${driver.vehicleMake || ''} ${driver.vehicleModel || ''}`.trim() || 'Vehicle',
          plateNumber: driver.plateNumber,
          rating: driver.rating || 0
        },
        nextSteps: [
          "Proceed to pickup location",
          "Contact customer if needed",
          "Pick up the package",
          "Start delivery"
        ]
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Accept delivery request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept delivery request"
    });
  }
};

/**
 * @desc    Driver rejects a delivery request
 * @route   POST /api/deliveries/:deliveryId/reject
 * @access  Private (Driver)
 */
export const rejectDelivery = async (req, res) => {
  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { reason } = req.body;

    // Validate driver role
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can reject deliveries"
      });
    }

    // Find driver profile
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Update driver stats
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    driver.acceptanceRate = driver.acceptedRequests 
      ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
      : 0;
    await driver.save();

    // Log rejection for analytics
    console.log(`Driver ${driverUser._id} rejected delivery ${deliveryId}: ${reason || 'No reason provided'}`);

    res.status(200).json({
      success: true,
      message: "Delivery request rejected",
      data: {
        rejectedAt: new Date(),
        reason: reason || "Not specified"
      }
    });

  } catch (error) {
    console.error("Reject delivery request error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject delivery request"
    });
  }
};

/**
 * @desc    Get driver's active delivery
 * @route   GET /api/deliveries/driver/active
 * @access  Private (Driver)
 */
export const getDriverActiveDelivery = async (req, res) => {
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
      // Clear invalid reference
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
      etaMinutes = Math.ceil(distanceToDropoff * 3);
      eta = new Date(Date.now() + (etaMinutes * 60000));
    } else if (delivery.status === "assigned") {
      // Calculate ETA to pickup
      if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        const distanceToPickup = calculateDistance(
          driver.currentLocation.lat,
          driver.currentLocation.lng,
          delivery.pickup.lat,
          delivery.pickup.lng
        );
        etaMinutes = Math.ceil(distanceToPickup * 3);
        eta = new Date(Date.now() + (etaMinutes * 60000));
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...delivery.toObject(),
        eta,
        etaMinutes,
        nextAction: getNextDeliveryAction(delivery.status),
        canStart: delivery.status === "assigned",
        canComplete: ["picked_up", "in_transit"].includes(delivery.status)
      }
    });

  } catch (error) {
    console.error("Get active delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get active delivery"
    });
  }
};

/**
 * @desc    Driver starts delivery (arrived at pickup)
 * @route   POST /api/deliveries/:deliveryId/start
 * @access  Private (Driver)
 */
export const startDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { otp, notes } = req.body; // OTP for verification

    // Validate driver role
    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can start deliveries"
      });
    }

    // Find driver profile
    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check if delivery can be started
    if (delivery.status !== "assigned") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be started from status: ${delivery.status}`
      });
    }

    // OTP verification (if required for high-value items)
    if (delivery.pickup.otp && otp !== delivery.pickup.otp) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Update delivery status
    delivery.status = "picked_up";
    delivery.pickedUpAt = new Date();
    delivery.actualPickupTime = new Date();
    
    // Add pickup notes if provided
    if (notes) {
      delivery.pickup.notes = notes;
    }
    
    // Start tracking
    delivery.tracking = {
      startedAt: new Date(),
      locations: [{
        lat: delivery.pickup.lat,
        lng: delivery.pickup.lng,
        timestamp: new Date(),
        status: "picked_up"
      }]
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
            phone: driverUser.phone
          },
          pickedUpAt: delivery.pickedUpAt,
          nextStep: "On the way to dropoff location"
        }
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
          nextStep: "Proceed to dropoff location"
        }
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Start delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start delivery"
    });
  }
};

/**
 * @desc    Driver completes delivery
 * @route   POST /api/deliveries/:deliveryId/complete
 * @access  Private (Driver)
 */
export const completeDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { 
      otp, 
      recipientName,
      recipientSignature,
      deliveryProof 
    } = req.body;

    // Validate driver role
    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can complete deliveries"
      });
    }

    // Find driver profile
    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check if delivery can be completed
    if (delivery.status !== "picked_up" && delivery.status !== "in_transit") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be completed from status: ${delivery.status}`
      });
    }

    // OTP verification
    if (delivery.dropoff.otp && otp !== delivery.dropoff.otp) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Update delivery status
    delivery.status = "delivered";
    delivery.deliveredAt = new Date();
    delivery.actualDeliveryTime = new Date();
    
    // Update delivery proof
    delivery.deliveryProof = {
      deliveredAt: new Date(),
      recipientName: recipientName || delivery.recipientName,
      recipientSignature: recipientSignature,
      photos: deliveryProof?.photos || [],
      otpVerified: !!otp,
      notes: deliveryProof?.notes
    };

    // Calculate actual fare (if there were changes)
    const actualDistance = delivery.tracking?.locations?.length > 0 
      ? calculateTotalDistance(delivery.tracking.locations)
      : delivery.estimatedDistanceKm;

    if (Math.abs(actualDistance - delivery.estimatedDistanceKm) > 2) {
      // Recalculate fare if distance difference > 2km
      const fareDetails = calculateFare({
        distance: actualDistance,
        itemWeight: delivery.itemDetails.weight,
        itemType: delivery.itemDetails.type,
        vehicleType: driver.vehicleType,
        isFragile: delivery.itemDetails.isFragile,
        itemValue: delivery.itemDetails.value
      });
      
      delivery.fare.actualTotal = fareDetails.totalFare;
      delivery.fare.adjustment = fareDetails.totalFare - delivery.fare.totalFare;
    } else {
      delivery.fare.actualTotal = delivery.fare.totalFare;
    }

    // Update driver status and stats
    driver.currentDeliveryId = null;
    driver.isAvailable = true;
    driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
    driver.earnings = (driver.earnings || 0) + (delivery.fare.actualTotal || delivery.fare.totalFare);
    
    // Update driver rating (simplified - in real app, use actual rating from customer)
    const newRating = calculateNewRating(driver.rating, delivery.rating);
    if (newRating !== null) {
      driver.rating = newRating;
    }

    await Promise.all([
      delivery.save({ session }),
      driver.save({ session })
    ]);

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
          fare: delivery.fare.actualTotal || delivery.fare.totalFare,
          requestRating: true
        }
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
          deliveryProof: delivery.deliveryProof
        },
        earnings: delivery.fare.actualTotal || delivery.fare.totalFare,
        driverAvailable: true
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Complete delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete delivery"
    });
  }
};

/**
 * @desc    Driver updates delivery location
 * @route   POST /api/deliveries/:deliveryId/location
 * @access  Private (Driver)
 */
export const updateDeliveryLocation = async (req, res) => {
  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { lat, lng, accuracy } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required"
      });
    }

    // Validate driver role
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can update location"
      });
    }

    // Find driver profile
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check if delivery is in progress
    if (!["picked_up", "in_transit"].includes(delivery.status)) {
      return res.status(400).json({
        success: false,
        message: "Delivery is not in progress"
      });
    }

    // Update driver's current location
    driver.currentLocation = {
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      accuracy: accuracy ? parseFloat(accuracy) : null,
      updatedAt: new Date()
    };

    // Update delivery tracking
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
      status: delivery.status
    });

    // Keep only last 100 locations
    if (delivery.tracking.locations.length > 100) {
      delivery.tracking.locations = delivery.tracking.locations.slice(-100);
    }

    await Promise.all([
      driver.save(),
      delivery.save()
    ]);

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
      data: {
        location: { lat, lng },
        deliveryStatus: delivery.status
      }
    });

  } catch (error) {
    console.error("Update location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location"
    });
  }
};

/**
 * -------------------------------
 * SHARED CONTROLLERS
 * -------------------------------
 */

/**
 * @desc    Get delivery details
 * @route   GET /api/deliveries/:deliveryId
 * @access  Private
 */
export const getDeliveryDetails = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .populate('customerId', 'name phone avatarUrl')
      .populate('driverId', 'licenseNumber vehicleType vehicleMake vehicleModel plateNumber')
      .populate({
        path: 'driverId',
        populate: {
          path: 'userId',
          select: 'name phone avatarUrl rating'
        }
      })
      .populate('companyId', 'name contactPhone logo');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check access permissions
    const isCustomer = user._id.toString() === delivery.customerId._id.toString();
    const isDriver = user.role === "driver" && delivery.driverId?._id;
    const isCompanyAdmin = user.role === "company_admin" && 
      user.companyId?.toString() === delivery.companyId?.toString();
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isCompanyAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    // Calculate ETA if delivery is in progress
    let eta = null;
    if (delivery.status === "picked_up" && delivery.tracking?.locations?.length > 0) {
      const lastLocation = delivery.tracking.locations[delivery.tracking.locations.length - 1];
      const distanceToDropoff = calculateDistance(
        lastLocation.lat,
        lastLocation.lng,
        delivery.dropoff.lat,
        delivery.dropoff.lng
      );
      eta = new Date(Date.now() + (distanceToDropoff * 3 * 60000)); // 3 min per km
    }

    res.status(200).json({
      success: true,
      data: {
        ...delivery.toObject(),
        eta,
        canCancel: ["created", "searching", "assigned", "picked_up"].includes(delivery.status),
        canRate: delivery.status === "delivered" && !delivery.rating
      }
    });

  } catch (error) {
    console.error("Get delivery details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery details"
    });
  }
};

/**
 * @desc    Cancel delivery
 * @route   POST /api/deliveries/:deliveryId/cancel
 * @access  Private (Customer/Driver)
 */
export const cancelDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required"
      });
    }

    // Find delivery
    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check permissions
    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = delivery.driverId && user.role === "driver";
    const isAdmin = user.role === "admin";
    
    if (!isCustomer && !isDriver && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this delivery"
      });
    }

    // Check if delivery can be cancelled
    const cancellableStatuses = ["created", "searching", "assigned", "picked_up"];
    if (!cancellableStatuses.includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be cancelled from status: ${delivery.status}`
      });
    }

    // Determine cancellation fee based on status
    let cancellationFee = 0;
    let refundAmount = delivery.fare.totalFare;
    
    if (delivery.status === "assigned" || delivery.status === "picked_up") {
      cancellationFee = delivery.fare.totalFare * 0.5; // 50% cancellation fee
      refundAmount = delivery.fare.totalFare - cancellationFee;
    }

    // Update delivery
    delivery.status = "cancelled";
    delivery.cancelledAt = new Date();
    delivery.cancelledBy = {
      userId: user._id,
      role: user.role,
      reason: reason
    };
    delivery.cancellationFee = cancellationFee;
    delivery.refundAmount = refundAmount;
    delivery.payment.status = "refunded";

    // If driver was assigned, make them available
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).session(session);
      if (driver) {
        driver.currentDeliveryId = null;
        driver.isAvailable = true;
        await driver.save({ session });

        // Notify driver
        await sendNotification({
          userId: driver.userId,
          title: "Delivery Cancelled",
          message: `Delivery ${deliveryId} has been cancelled`,
          data: {
            type: "delivery_cancelled",
            deliveryId: delivery._id,
            reason: reason,
            cancellationFee: cancellationFee
          }
        });
      }
    }

    // Notify customer
    if (isDriver || isAdmin) {
      await sendNotification({
        userId: delivery.customerId,
        title: "Delivery Cancelled",
        message: `Your delivery has been cancelled: ${reason}`,
        data: {
          type: "delivery_cancelled",
          deliveryId: delivery._id,
          reason: reason,
          refundAmount: refundAmount
        }
      });
    }

    await delivery.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Delivery cancelled successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          cancelledAt: delivery.cancelledAt,
          cancellationFee: delivery.cancellationFee,
          refundAmount: delivery.refundAmount
        },
        cancellationFee,
        refundAmount
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Cancel delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel delivery"
    });
  }
};

/**
 * @desc    Rate delivery
 * @route   POST /api/deliveries/:deliveryId/rate
 * @access  Private (Customer)
 */
export const rateDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const customer = req.user;
    const { deliveryId } = req.params;
    const { rating, review, tip } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5"
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
      status: "delivered"
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found or cannot be rated"
      });
    }

    // Check if already rated
    if (delivery.rating) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery already rated"
      });
    }

    // Update delivery rating
    delivery.rating = rating;
    delivery.review = review;
    delivery.ratedAt = new Date();

    // Add tip if provided
    if (tip && tip > 0) {
      delivery.tip = {
        amount: tip,
        addedAt: new Date()
      };
      delivery.fare.actualTotal = (delivery.fare.actualTotal || delivery.fare.totalFare) + tip;
    }

    await delivery.save({ session });

    // Update driver rating
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).session(session);
      if (driver) {
        // Calculate new average rating
        const totalRatings = driver.totalRatings || 0;
        const currentRating = driver.rating || 0;
        const newTotalRatings = totalRatings + 1;
        const newRating = ((currentRating * totalRatings) + rating) / newTotalRatings;

        driver.rating = newRating;
        driver.totalRatings = newTotalRatings;
        
        // Add tip to earnings
        if (tip && tip > 0) {
          driver.earnings = (driver.earnings || 0) + tip;
        }

        await driver.save({ session });

        // Update user rating
        const driverUser = await User.findById(driver.userId).session(session);
        if (driverUser) {
          driverUser.rating = newRating;
          await driverUser.save({ session });
        }

        // Notify driver
        await sendNotification({
          userId: driver.userId,
          title: "New Rating",
          message: `You received a ${rating} star rating for delivery #${deliveryId.slice(-6)}`,
          data: {
            type: "new_rating",
            deliveryId: delivery._id,
            rating: rating,
            review: review,
            tip: tip
          }
        });
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Thank you for your rating!",
      data: {
        rating,
        review,
        tip
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Rate delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit rating"
    });
  }
};

/**
 * @desc    Get customer's deliveries
 * @route   GET /api/deliveries/my
 * @access  Private (Customer)
 */
export const getMyDeliveries = async (req, res) => {
  try {
    const customer = req.user;
    const { 
      status, 
      page = 1, 
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc' 
    } = req.query;

    const query = { customerId: customer._id };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('driverId', 'vehicleType vehicleMake vehicleModel plateNumber')
        .populate({
          path: 'driverId',
          populate: {
            path: 'userId',
            select: 'name avatarUrl rating'
          }
        })
        .populate('companyId', 'name logo')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Delivery.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Get my deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries"
    });
  }
};

/**
 * @desc    Get driver's deliveries
 * @route   GET /api/deliveries/driver/my-deliveries
 * @access  Private (Driver)
 */
export const getDriverDeliveries = async (req, res) => {
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
      status, 
      page = 1, 
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc' 
    } = req.query;

    const query = { driverId: driver._id };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('customerId', 'name phone avatarUrl rating')
        .populate('companyId', 'name logo')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Delivery.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Get driver deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries"
    });
  }
};

/**
 * @desc    Get delivery tracking
 * @route   GET /api/deliveries/:deliveryId/track
 * @access  Private
 */
export const trackDelivery = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .select('status pickup dropoff tracking driverId estimatedPickupTime estimatedDeliveryTime recipientName recipientPhone customerId');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check access permissions
    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId?.toString() === user.driverId?.toString();
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    // Get driver location if available
    let driverLocation = null;
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId)
        .select('currentLocation userId')
        .populate('userId', 'name phone avatarUrl');
      
      if (driver) {
        driverLocation = {
          lat: driver.currentLocation?.lat,
          lng: driver.currentLocation?.lng,
          updatedAt: driver.currentLocation?.updatedAt,
          driver: {
            name: driver.userId?.name,
            phone: driver.userId?.phone,
            avatarUrl: driver.userId?.avatarUrl
          }
        };
      }
    }

    // Calculate ETA
    let eta = null;
    let etaMinutes = null;
    
    if (delivery.status === "assigned" && delivery.estimatedPickupTime) {
      eta = delivery.estimatedPickupTime;
      etaMinutes = Math.ceil((eta.getTime() - Date.now()) / 60000);
    } else if (delivery.status === "picked_up" && delivery.tracking?.locations?.length > 0) {
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
        deliveryId: delivery._id,
        status: delivery.status,
        pickup: delivery.pickup,
        dropoff: delivery.dropoff,
        recipientName: delivery.recipientName,
        recipientPhone: delivery.recipientPhone,
        tracking: delivery.tracking,
        driverLocation,
        eta,
        etaMinutes,
        canTrack: ["assigned", "picked_up", "in_transit"].includes(delivery.status)
      }
    });

  } catch (error) {
    console.error("Track delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to track delivery"
    });
  }
};

/**
 * @desc    Generate OTP for delivery verification
 * @route   POST /api/deliveries/:deliveryId/generate-otp
 * @access  Private (Customer)
 */
export const generateDeliveryOTP = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId } = req.params;
    const { type } = req.body; // 'pickup' or 'delivery'

    if (!['pickup', 'delivery'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Type must be 'pickup' or 'delivery'"
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Generate OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Save OTP based on type
    if (type === 'pickup') {
      delivery.pickup.otp = otp;
      delivery.pickup.otpGeneratedAt = new Date();
      delivery.pickup.otpExpiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes
    } else {
      delivery.dropoff.otp = otp;
      delivery.dropoff.otpGeneratedAt = new Date();
      delivery.dropoff.otpExpiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes
    }

    await delivery.save();

    res.status(200).json({
      success: true,
      message: `OTP generated for ${type}`,
      data: {
        otp,
        expiresIn: 10 // minutes
      }
    });

  } catch (error) {
    console.error("Generate OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate OTP"
    });
  }
};

/**
 * @desc    Get all deliveries (Admin only)
 * @route   GET /api/deliveries
 * @access  Private (Admin)
 */
export const getAllDeliveries = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required"
      });
    }

    const {
      status,
      startDate,
      endDate,
      minFare,
      maxFare,
      vehicleType,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // Build query
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (vehicleType && vehicleType !== 'all') query['instructions.vehiclePreference'] = vehicleType;
    
    // Date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Fare range
    if (minFare || maxFare) {
      query['fare.totalFare'] = {};
      if (minFare) query['fare.totalFare'].$gte = parseFloat(minFare);
      if (maxFare) query['fare.totalFare'].$lte = parseFloat(maxFare);
    }

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('customerId', 'name phone email')
        .populate('driverId', 'licenseNumber vehicleType plateNumber')
        .populate({
          path: 'driverId',
          populate: {
            path: 'userId',
            select: 'name phone'
          }
        })
        .populate('companyId', 'name')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Delivery.countDocuments(query)
    ]);

    // Calculate statistics
    const stats = await Delivery.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalDeliveries: { $sum: 1 },
          totalRevenue: { $sum: '$fare.totalFare' },
          averageFare: { $avg: '$fare.totalFare' },
          completedDeliveries: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      stats: stats[0] || {
        totalDeliveries: 0,
        totalRevenue: 0,
        averageFare: 0,
        completedDeliveries: 0
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Get all deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries"
    });
  }
};

/**
 * @desc    Get company deliveries (Company Admin only)
 * @route   GET /api/deliveries/company/:companyId/deliveries
 * @access  Private (Company Admin)
 */
export const getCompanyDeliveries = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;

    // Check permissions
    if (admin.role !== "company_admin" || admin.companyId?.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const {
      status,
      driverId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    // Build query
    const query = { companyId };
    if (status && status !== 'all') query.status = status;
    if (driverId) query.driverId = driverId;
    
    // Date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [deliveries, total, drivers] = await Promise.all([
      Delivery.find(query)
        .populate('customerId', 'name phone')
        .populate('driverId', 'licenseNumber vehicleType plateNumber')
        .populate({
          path: 'driverId',
          populate: {
            path: 'userId',
            select: 'name'
          }
        })
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Delivery.countDocuments(query),
      Driver.find({ companyId }).select('_id licenseNumber').populate('userId', 'name')
    ]);

    // Calculate company statistics
    const stats = await Delivery.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalDeliveries: { $sum: 1 },
          totalRevenue: { $sum: '$fare.totalFare' },
          completedDeliveries: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          pendingDeliveries: {
            $sum: { $cond: [{ $in: ['$status', ['created', 'searching', 'assigned']] }, 1, 0] }
          },
          cancelledDeliveries: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        deliveries,
        drivers,
        stats: stats[0] || {
          totalDeliveries: 0,
          totalRevenue: 0,
          completedDeliveries: 0,
          pendingDeliveries: 0,
          cancelledDeliveries: 0
        }
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Get company deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company deliveries"
    });
  }
};

// Helper functions
const calculateTotalDistance = (locations) => {
  let totalDistance = 0;
  for (let i = 1; i < locations.length; i++) {
    totalDistance += calculateDistance(
      locations[i-1].lat,
      locations[i-1].lng,
      locations[i].lat,
      locations[i].lng
    );
  }
  return totalDistance;
};

const calculateNewRating = (currentRating, newRating) => {
  if (newRating === undefined || newRating === null) return null;
  
  if (!currentRating) return newRating;
  
  // Simple average for demo - in production, use weighted average
  return (currentRating + newRating) / 2;
};

// Helper function to determine next action
const getNextDeliveryAction = (status) => {
  switch (status) {
    case "assigned":
      return {
        action: "go_to_pickup",
        title: "Go to Pickup Location",
        description: "Proceed to the pickup location to collect the package"
      };
    case "picked_up":
      return {
        action: "go_to_dropoff",
        title: "Go to Dropoff Location",
        description: "Deliver the package to the recipient"
      };
    case "in_transit":
      return {
        action: "continue_to_dropoff",
        title: "Continue to Dropoff",
        description: "Continue to the dropoff location"
      };
    default:
      return {
        action: "wait",
        title: "Wait for Instructions",
        description: "Please wait for further instructions"
      };
  }
};