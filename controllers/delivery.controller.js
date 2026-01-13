import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import { calculateFare } from "../utils/fareCalculator.js";
import { sendNotification } from "../utils/notification.js";
import crypto from "crypto";

/**
 * UTILITY FUNCTIONS
 */

// Calculate distance between two coordinates
// Calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  // Handle null/undefined values
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return 0;
  }

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
// Save driver details to delivery
const saveDriverDetailsToDelivery = async (deliveryId, driver) => {
  try {
    const delivery = await Delivery.findById(deliveryId);
    if (delivery && driver && driver.userId) {
      const driverUser = await User.findById(driver.userId);

      // Extract coordinates from new location format
      let lat, lng;
      if (driver.location && driver.location.coordinates) {
        // [longitude, latitude] format
        lng = driver.location.coordinates[0];
        lat = driver.location.coordinates[1];
      } else if (driver.lat && driver.lng) {
        // Old format
        lat = driver.lat;
        lng = driver.lng;
      }

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
        currentLocation: lat && lng ? { lat, lng } : undefined,
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

/**
 * CUSTOMER CONTROLLERS
 */

/**
 * @desc    Create delivery request
 * @route   POST /api/deliveries/request
 * @access  Private (Customer)
 *
 *
 */

export const createDeliveryRequest = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can create deliveries",
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupName,
      pickupPhone,
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      recipientName,
      recipientPhone,
      itemType,
      itemDescription,
      itemWeight,
      paymentMethod,
    } = req.body;

    // Validate coordinates
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff coordinates are required",
      });
    }

    // Validate recipient details
    if (!recipientName || !recipientPhone) {
      return res.status(400).json({
        success: false,
        message: "Recipient name and phone are required",
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
      itemType: itemType || "parcel",
    });

    // Generate unique reference ID (PER REQUEST)
    const referenceId = `RID-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;

    // Create delivery object
    const deliveryData = {
      referenceId,
      customerId: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,

      pickup: {
        address: pickupAddress,
        lat: parseFloat(pickupLat),
        lng: parseFloat(pickupLng),
        name: pickupName || "Pickup Location",
        phone: pickupPhone || customer.phone,
      },

      dropoff: {
        address: dropoffAddress,
        lat: parseFloat(dropoffLat),
        lng: parseFloat(dropoffLng),
        name: recipientName,
        phone: recipientPhone,
      },

      recipientName: recipientName,
      recipientPhone: recipientPhone,

      itemDetails: {
        type: itemType || "parcel",
        description: itemDescription,
        weight: parseFloat(itemWeight) || 1,
      },

      fare: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.distanceFare,
        totalFare: fareDetails.totalFare,
        currency: "NGN",
      },

      estimatedDistanceKm: distance,
      estimatedDurationMin: Math.ceil(distance * 3),

      payment: {
        method: paymentMethod || "cash",
        status: paymentMethod === "cash" ? "pending" : "pending_payment",
      },

      status: "created",
    };

    // Create delivery
    const delivery = new Delivery(deliveryData);
    await delivery.save();

    // Find nearby drivers to notify them
    const nearbyDrivers = await Driver.find({
      isOnline: true,
      isActive: true,
      approvalStatus: "approved",
      $or: [
        { "location.coordinates": { $exists: true, $ne: [0, 0] } },
        { "currentLocation.lat": { $exists: true } },
      ],
    }).populate("userId", "name phone avatarUrl");

    // Filter drivers by distance from pickup
    const driversNearPickup = nearbyDrivers.filter((driver) => {
      let driverLat, driverLng;

      // Get driver location from appropriate field
      if (
        driver.location &&
        driver.location.coordinates &&
        driver.location.coordinates.length >= 2
      ) {
        driverLng = driver.location.coordinates[0];
        driverLat = driver.location.coordinates[1];
      } else if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        driverLat = driver.currentLocation.lat;
        driverLng = driver.currentLocation.lng;
      } else if (driver.lat && driver.lng) {
        driverLat = driver.lat;
        driverLng = driver.lng;
      } else {
        return false;
      }

      const distanceToPickup = calculateDistance(
        parseFloat(pickupLat),
        parseFloat(pickupLng),
        driverLat,
        driverLng
      );
      return distanceToPickup <= 10; // 10km radius
    });

    // Notify nearby drivers
    for (const driver of driversNearPickup) {
      await sendNotification({
        userId: driver.userId._id,
        title: "📦 New Delivery Request",
        message: `New delivery available near you`,
        data: {
          type: "new_delivery",
          deliveryId: delivery._id,
          pickup: delivery.pickup,
          fare: delivery.fare.totalFare,
          distance: delivery.estimatedDistanceKm,
        },
      });
    }

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
          fare: delivery.fare,
          estimatedDistanceKm: delivery.estimatedDistanceKm,
          estimatedDurationMin: delivery.estimatedDurationMin,
          createdAt: delivery.createdAt,
          nearbyDriversCount: driversNearPickup.length,
        },
      },
    });
  } catch (error) {
    console.error("❌ Create delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create delivery request",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get nearby available drivers for customer
 * @route   GET /api/deliveries/nearby-drivers
 * @access  Private (Customer)
 */
// In delivery.controller.js - getNearbyDrivers function
export const getNearbyDrivers = async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    // Find drivers using the correct model fields
    const drivers = await Driver.find({
      isOnline: true,
      isActive: true,
      approvalStatus: "approved",
      $or: [
        { "location.coordinates": { $exists: true, $ne: [0, 0] } }, // Using new format
        { "currentLocation.lat": { $exists: true } }, // Using old format for compatibility
      ],
    }).populate("userId", "name phone avatarUrl rating");

    // Calculate distance for each driver
    const driversWithDistance = drivers
      .map((driver) => {
        let driverLat, driverLng;

        // Try to get location from new format first
        if (
          driver.location &&
          driver.location.coordinates &&
          driver.location.coordinates.length >= 2
        ) {
          driverLng = driver.location.coordinates[0];
          driverLat = driver.location.coordinates[1];
        }
        // Fall back to currentLocation format
        else if (
          driver.currentLocation &&
          driver.currentLocation.lat &&
          driver.currentLocation.lng
        ) {
          driverLat = driver.currentLocation.lat;
          driverLng = driver.currentLocation.lng;
        }
        // Fall back to deprecated fields
        else if (driver.lat && driver.lng) {
          driverLat = driver.lat;
          driverLng = driver.lng;
        } else {
          return null;
        }

        const distance = calculateDistance(
          latitude,
          longitude,
          driverLat,
          driverLng
        );

        return {
          ...driver.toObject(),
          distance: parseFloat(distance.toFixed(2)),
          distanceText: `${distance.toFixed(1)} km away`,
          estimatedArrival: Math.ceil(distance * 3), // 3 min per km
        };
      })
      .filter(
        (driver) => driver !== null && driver.distance <= parseFloat(radius)
      )
      .sort((a, b) => a.distance - b.distance);

    res.status(200).json({
      success: true,
      message: `Found ${driversWithDistance.length} nearby drivers`,
      data: driversWithDistance,
    });
  } catch (error) {
    console.error("❌ Get nearby drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to find nearby drivers",
    });
  }
};

/**
 * @desc    Get customer's deliveries
 * @route   GET /api/deliveries/my
 * @access  Private (Customer)
 */
/**
 * @desc    Get customer's deliveries
 * @route   GET /api/deliveries/my
 * @access  Private (Customer)
 */
export const getMyDeliveries = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const { status, page = 1, limit = 10 } = req.query;

    const query = { customerId: customer._id };
    if (status && status !== "all") query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Add error handling for the query
    const deliveries = await Delivery.find(query)
      .populate({
        path: "driverId",
        select: "vehicleType vehicleMake vehicleModel plateNumber",
        populate: {
          path: "userId",
          select: "name avatarUrl rating",
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Delivery.countDocuments(query);

    // Safely handle deliveries array
    const deliveriesWithDriverDetails = deliveries.map((delivery) => {
      try {
        const deliveryObj = delivery.toObject
          ? delivery.toObject()
          : delivery;

        // If no driverDetails but has driverId, populate it
        if (!deliveryObj.driverDetails && deliveryObj.driverId) {
          deliveryObj.driverDetails = {
            driverId: deliveryObj.driverId?._id || null,
            name: deliveryObj.driverId?.userId?.name || "Driver",
            avatarUrl: deliveryObj.driverId?.userId?.avatarUrl || null,
            rating: deliveryObj.driverId?.userId?.rating || 0,
            vehicle: {
              type: deliveryObj.driverId?.vehicleType || "bike",
              make: deliveryObj.driverId?.vehicleMake || "",
              model: deliveryObj.driverId?.vehicleModel || "",
              plateNumber: deliveryObj.driverId?.plateNumber || "",
            },
          };
        }

        return deliveryObj;
      } catch (error) {
        console.error("Error processing delivery:", error);
        // Return a minimal safe object
        return {
          _id: delivery._id,
          status: delivery.status || "unknown",
          pickup: delivery.pickup || {},
          dropoff: delivery.dropoff || {},
          createdAt: delivery.createdAt,
        };
      }
    });

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
    console.error("❌ Get my deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * DRIVER CONTROLLERS - DELIVERY REQUESTS
 */

/**
 * @desc    Get nearby delivery requests for driver
 * @route   GET /api/deliveries/driver/nearby
 * @access  Private (Driver)
 */
export const getNearbyDeliveryRequests = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can view delivery requests",
      });
    }

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

    // Get driver's location
    const { lat, lng, maxDistance = 10 } = req.query;

    let latitude, longitude;

    if (lat && lng) {
      latitude = parseFloat(lat);
      longitude = parseFloat(lng);
    } else if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      latitude = driver.currentLocation.lat;
      longitude = driver.currentLocation.lng;
    } else {
      return res.status(400).json({
        success: false,
        message: "Driver location is required",
      });
    }

    // Find available deliveries that don't have a driver yet
    const deliveries = await Delivery.find({
      status: "created",
      driverId: { $exists: false },
    })
      .populate("customerId", "name phone avatarUrl rating")
      .sort({ createdAt: -1 })
      .limit(50);

    // Calculate distance for each delivery from driver's location
    const nearbyDeliveries = [];

    for (const delivery of deliveries) {
      if (!delivery.pickup?.lat || !delivery.pickup?.lng) continue;

      const distance = calculateDistance(
        latitude,
        longitude,
        delivery.pickup.lat,
        delivery.pickup.lng
      );

      if (distance <= parseFloat(maxDistance)) {
        // Calculate pickup time estimate
        const pickupTimeMinutes = Math.ceil(distance * 3);

        // Format delivery for response
        const formattedDelivery = {
          _id: delivery._id,
          pickup: {
            address: delivery.pickup.address || "Address not specified",
            lat: delivery.pickup.lat,
            lng: delivery.pickup.lng,
            name: delivery.pickup.name || "Pickup Location",
            phone: delivery.pickup.phone || "Phone not specified",
            instructions: delivery.pickup.instructions || "",
          },
          dropoff: {
            address: delivery.dropoff.address || "Address not specified",
            lat: delivery.dropoff.lat,
            lng: delivery.dropoff.lng,
            name: delivery.dropoff.name || "Dropoff Location",
            phone: delivery.dropoff.phone || "Phone not specified",
            instructions: delivery.dropoff.instructions || "",
          },
          recipientName: delivery.recipientName,
          recipientPhone: delivery.recipientPhone,
          itemDetails: delivery.itemDetails,
          fare: delivery.fare,
          estimatedDistanceKm: delivery.estimatedDistanceKm || distance,
          estimatedDurationMin:
            delivery.estimatedDurationMin || Math.ceil(distance * 3),
          payment: delivery.payment,
          customer: delivery.customerId,
          createdAt: delivery.createdAt,
          // Distance from driver to pickup
          distanceFromDriver: parseFloat(distance.toFixed(2)),
          distanceText: `${distance.toFixed(1)} km away`,
          estimatedPickupTime: pickupTimeMinutes,
          estimatedPickupTimeText: `${pickupTimeMinutes} min`,
          canAccept: true,
        };

        nearbyDeliveries.push(formattedDelivery);
      }
    }

    // Sort by distance (closest first)
    nearbyDeliveries.sort(
      (a, b) => a.distanceFromDriver - b.distanceFromDriver
    );

    res.status(200).json({
      success: true,
      message: `Found ${nearbyDeliveries.length} nearby delivery requests`,
      data: {
        deliveries: nearbyDeliveries,
        driverLocation: { lat: latitude, lng: longitude },
        searchRadius: maxDistance,
        count: nearbyDeliveries.length,
      },
    });
  } catch (error) {
    console.error("❌ Get nearby deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get nearby deliveries",
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

    console.log(`🚗 Driver ${driverUser._id} accepting delivery ${deliveryId}`);

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can accept deliveries",
      });
    }

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
    

// Notify customer to make payment
if (customer) {
  await sendNotification({
    userId: customer._id,
    title: "💳 Complete Payment",
    message: `Please complete payment for your delivery with ${driverUser.name}`,
    data: {
      type: "payment_required",
      deliveryId: delivery._id,
      amount: delivery.fare.totalFare,
      driverId: driver._id,
      requiresPayment: true,
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
          driverDetails: delivery.driverDetails,
        },
        driver: {
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

    console.log(`🚚 Driver ${driverUser._id} starting delivery ${deliveryId}`);

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can start deliveries",
      });
    }

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

    // Update delivery status to "picked_up"
    delivery.status = "picked_up";
    delivery.pickedUpAt = new Date();

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
 * @route   POST /api/deliveries/:deliveryId/complete
 * @access  Private (Driver)
 */
export const completeDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(
      `✅ Driver ${driverUser._id} completing delivery ${deliveryId}`
    );

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can complete deliveries",
      });
    }

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

    // Update delivery status
    delivery.status = "delivered";
    delivery.deliveredAt = new Date();

    // Update driver status
    driver.currentDeliveryId = null;
    driver.isAvailable = true;
    driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
    driver.earnings = (driver.earnings || 0) + (delivery.fare.totalFare || 0);

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
        earnings: delivery.fare.totalFare || 0,
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
        message: "Access denied",
      });
    }

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

    const delivery = await Delivery.findById(driver.currentDeliveryId).populate(
      "customerId",
      "name phone avatarUrl rating"
    );

    if (!delivery) {
      // Clear invalid reference
      driver.currentDeliveryId = null;
      driver.isAvailable = true;
      await driver.save();

      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    // Ensure driver details are saved
    if (!delivery.driverDetails) {
      await saveDriverDetailsToDelivery(delivery._id, driver);
    }

    // Calculate ETA if in transit
    let etaMinutes = null;
    if (delivery.status === "assigned") {
      // Calculate ETA to pickup
      if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        const distanceToPickup = calculateDistance(
          driver.currentLocation.lat,
          driver.currentLocation.lng,
          delivery.pickup.lat,
          delivery.pickup.lng
        );
        etaMinutes = Math.ceil(distanceToPickup * 3);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...delivery.toObject(),
        etaMinutes,
        nextAction:
          delivery.status === "assigned"
            ? "Go to pickup location"
            : delivery.status === "picked_up"
            ? "Go to dropoff location"
            : "Wait for instructions",
      },
    });
  } catch (error) {
    console.error("❌ Get active delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get active delivery",
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
        message: "Access denied",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const { status, page = 1, limit = 10 } = req.query;

    const query = { driverId: driver._id };
    if (status && status !== "all") query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const deliveries = await Delivery.find(query)
      .populate("customerId", "name phone avatarUrl rating")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Delivery.countDocuments(query);

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
    console.error("❌ Get driver deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries",
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

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can reject deliveries",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Update driver stats
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    await driver.save();

    res.status(200).json({
      success: true,
      message: "Delivery request rejected",
    });
  } catch (error) {
    console.error("❌ Reject delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject delivery",
    });
  }
};

/**
 * SHARED CONTROLLERS
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
      .populate("customerId", "name phone avatarUrl")
      .populate({
        path: "driverId",
        populate: {
          path: "userId",
          select: "name phone avatarUrl rating",
        },
      });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check access permissions
    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Ensure driver details are populated
    if (!delivery.driverDetails && delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        await saveDriverDetailsToDelivery(delivery._id, driver);
        const refreshedDelivery = await Delivery.findById(deliveryId);
        delivery.driverDetails = refreshedDelivery.driverDetails;
      }
    }

    res.status(200).json({
      success: true,
      data: delivery,
    });
  } catch (error) {
    console.error("❌ Get delivery details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery details",
    });
  }
};

/**
 * @desc    Track delivery
 * @route   GET /api/deliveries/:deliveryId/track
 * @access  Private
 */
export const trackDelivery = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId).select(
      "status pickup dropoff driverId driverDetails customerId estimatedPickupTime recipientName recipientPhone fare createdAt assignedAt pickedUpAt deliveredAt"
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check access permissions
    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver";
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Ensure driver details are populated
    if (!delivery.driverDetails && delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        await saveDriverDetailsToDelivery(delivery._id, driver);
        const refreshedDelivery = await Delivery.findById(deliveryId);
        delivery.driverDetails = refreshedDelivery.driverDetails;
      }
    }

    // Get driver current location if available
    let driverLocation = null;
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).select(
        "currentLocation"
      );

      if (driver && driver.currentLocation) {
        driverLocation = {
          lat: driver.currentLocation.lat,
          lng: driver.currentLocation.lng,
          updatedAt: driver.currentLocation.updatedAt,
        };
      }
    }

    // Get timeline
    const timeline = [];
    if (delivery.createdAt)
      timeline.push({
        event: "created",
        time: delivery.createdAt,
        description: "Delivery request created",
      });
    if (delivery.assignedAt)
      timeline.push({
        event: "assigned",
        time: delivery.assignedAt,
        description: "Driver assigned",
      });
    if (delivery.pickedUpAt)
      timeline.push({
        event: "picked_up",
        time: delivery.pickedUpAt,
        description: "Package picked up",
      });
    if (delivery.deliveredAt)
      timeline.push({
        event: "delivered",
        time: delivery.deliveredAt,
        description: "Package delivered",
      });

    res.status(200).json({
      success: true,
      data: {
        deliveryId: delivery._id,
        status: delivery.status,
        pickup: delivery.pickup,
        dropoff: delivery.dropoff,
        recipientName: delivery.recipientName,
        recipientPhone: delivery.recipientPhone,
        fare: delivery.fare,
        driverDetails: delivery.driverDetails,
        driverLocation: driverLocation,
        timeline: timeline.sort((a, b) => new Date(a.time) - new Date(b.time)),
        canTrack: ["assigned", "picked_up"].includes(delivery.status),
      },
    });
  } catch (error) {
    console.error("❌ Track delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to track delivery",
    });
  }
};

/**
 * @desc    Cancel delivery
 * @route   POST /api/deliveries/:deliveryId/cancel
 * @access  Private (Customer/Driver)
 */
export const cancelDelivery = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required",
      });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check if user is the customer or driver
    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this delivery",
      });
    }

    // Check if delivery can be cancelled
    if (delivery.status !== "created" && delivery.status !== "assigned") {
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be cancelled from status: ${delivery.status}`,
      });
    }

    // Update delivery
    delivery.status = "cancelled";
    delivery.cancelledAt = new Date();
    delivery.cancelledBy = {
      userId: user._id,
      role: user.role,
      reason: reason,
    };

    // If driver was assigned, make them available
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        driver.currentDeliveryId = null;
        driver.isAvailable = true;
        await driver.save();
      }
    }

    await delivery.save();

    res.status(200).json({
      success: true,
      message: "Delivery cancelled successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          cancelledAt: delivery.cancelledAt,
        },
      },
    });
  } catch (error) {
    console.error("❌ Cancel delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel delivery",
    });
  }
};

/**
 * @desc    Rate delivery
 * @route   POST /api/deliveries/:deliveryId/rate
 * @access  Private (Customer)
 */
export const rateDelivery = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId } = req.params;
    const { rating, review, tip } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
      status: "delivered",
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found or cannot be rated",
      });
    }

    // Check if already rated
    if (delivery.rating) {
      return res.status(400).json({
        success: false,
        message: "Delivery already rated",
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
        addedAt: new Date(),
      };
    }

    await delivery.save();

    // Update driver rating
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        // Calculate new average rating
        const totalRatings = driver.totalRatings || 0;
        const currentRating = driver.rating || 0;
        const newTotalRatings = totalRatings + 1;
        const newRating =
          (currentRating * totalRatings + rating) / newTotalRatings;

        driver.rating = newRating;
        driver.totalRatings = newTotalRatings;

        // Add tip to earnings
        if (tip && tip > 0) {
          driver.earnings = (driver.earnings || 0) + tip;
        }

        await driver.save();
      }
    }

    res.status(200).json({
      success: true,
      message: "Thank you for your rating!",
      data: { rating, review, tip },
    });
  } catch (error) {
    console.error("❌ Rate delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit rating",
    });
  }
};
/**
 * @desc    Get customer's active delivery
 * @route   GET /api/deliveries/customer/active
 * @access  Private (Customer)
 */
export const getCustomerActiveDelivery = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Find active delivery (in progress deliveries)
    const delivery = await Delivery.findOne({
      customerId: customer._id,
      status: { $in: ["assigned", "picked_up", "in_transit"] }
    })
      .populate({
        path: "driverId",
        select: "vehicleType vehicleMake vehicleModel plateNumber",
        populate: {
          path: "userId",
          select: "name avatarUrl phone rating",
        },
      })
      .sort({ createdAt: -1 });

    if (!delivery) {
      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    // Get driver's current location if available
    let driverLocation = null;
    let etaMinutes = null;

    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId)
        .select("currentLocation location");

      if (driver) {
        // Get driver location from appropriate field
        if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
          driverLocation = {
            lat: driver.currentLocation.lat,
            lng: driver.currentLocation.lng,
            updatedAt: driver.currentLocation.updatedAt,
          };
        } else if (driver.location?.coordinates) {
          driverLocation = {
            lat: driver.location.coordinates[1],
            lng: driver.location.coordinates[0],
            updatedAt: new Date(),
          };
        }

        // Calculate ETA
        if (driverLocation && delivery.status === "picked_up") {
          // If picked up, calculate ETA to dropoff
          const distance = calculateDistance(
            driverLocation.lat,
            driverLocation.lng,
            delivery.dropoff.lat,
            delivery.dropoff.lng
          );
          etaMinutes = Math.ceil(distance * 3); // 3 minutes per km
        } else if (driverLocation && delivery.status === "assigned") {
          // If assigned, calculate ETA to pickup
          const distance = calculateDistance(
            driverLocation.lat,
            driverLocation.lng,
            delivery.pickup.lat,
            delivery.pickup.lng
          );
          etaMinutes = Math.ceil(distance * 3);
        }
      }

      // Ensure driver details are saved to delivery
      if (!delivery.driverDetails) {
        await saveDriverDetailsToDelivery(delivery._id, driver);
        // Refresh delivery to get updated driver details
        const refreshedDelivery = await Delivery.findById(delivery._id);
        delivery.driverDetails = refreshedDelivery.driverDetails;
      }
    }

    // Get timeline
    const timeline = [];
    if (delivery.createdAt)
      timeline.push({
        event: "created",
        time: delivery.createdAt,
        description: "Order created",
        icon: "📝"
      });
    if (delivery.assignedAt)
      timeline.push({
        event: "assigned",
        time: delivery.assignedAt,
        description: "Driver assigned",
        icon: "🚗"
      });
    if (delivery.pickedUpAt)
      timeline.push({
        event: "picked_up",
        time: delivery.pickedUpAt,
        description: "Package picked up",
        icon: "📦"
      });

    // Add current step
    let currentStep = "awaiting_driver";
    let nextStep = "";

    switch (delivery.status) {
      case "assigned":
        currentStep = "driver_assigned";
        nextStep = "Driver heading to pickup location";
        break;
      case "picked_up":
        currentStep = "package_picked_up";
        nextStep = "Driver heading to dropoff location";
        break;
      case "in_transit":
        currentStep = "in_transit";
        nextStep = "Driver on the way";
        break;
    }

    res.status(200).json({
      success: true,
      data: {
        _id: delivery._id,
        referenceId: delivery.referenceId,
        status: delivery.status,
        currentStep,
        nextStep,
        
        // Pickup info
        pickup: {
          address: delivery.pickup.address,
          lat: delivery.pickup.lat,
          lng: delivery.pickup.lng,
          name: delivery.pickup.name,
          phone: delivery.pickup.phone,
        },
        
        // Dropoff info
        dropoff: {
          address: delivery.dropoff.address,
          lat: delivery.dropoff.lat,
          lng: delivery.dropoff.lng,
          name: delivery.dropoff.name,
          phone: delivery.dropoff.phone,
        },
        
        // Driver info with details
        driver: delivery.driverDetails ? {
          _id: delivery.driverDetails.driverId,
          name: delivery.driverDetails.name,
          phone: delivery.driverDetails.phone,
          avatarUrl: delivery.driverDetails.avatarUrl,
          rating: delivery.driverId?.userId?.rating || 0,
          vehicle: delivery.driverDetails.vehicle,
          currentLocation: driverLocation,
        } : null,
        
        // Delivery details
        itemDetails: delivery.itemDetails,
        fare: delivery.fare,
        
        // ETA and tracking
        etaMinutes,
        estimatedDistanceKm: delivery.estimatedDistanceKm,
        estimatedDurationMin: delivery.estimatedDurationMin,
        
        // Timeline
        timeline: timeline.sort((a, b) => new Date(a.time) - new Date(b.time)),
        
        // Progress
        progress: {
          step: currentStep,
          percentage: getDeliveryProgressPercentage(delivery.status),
          message: getDeliveryStatusMessage(delivery.status),
        },
        
        // Tracking data
        canTrack: ["assigned", "picked_up", "in_transit"].includes(delivery.status),
        tracking: delivery.tracking || null,
        
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Get customer active delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get active delivery",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Helper function to calculate delivery progress percentage
 */
const getDeliveryProgressPercentage = (status) => {
  const progressMap = {
    "created": 10,
    "assigned": 30,
    "picked_up": 60,
    "in_transit": 80,
    "delivered": 100,
    "cancelled": 0,
    "failed": 0,
  };
  return progressMap[status] || 10;
};

/**
 * Helper function to get status message
 */
const getDeliveryStatusMessage = (status) => {
  const messages = {
    "created": "Looking for available drivers...",
    "assigned": "Driver assigned and heading to pickup",
    "picked_up": "Package picked up, heading to destination",
    "in_transit": "On the way to delivery location",
    "delivered": "Package delivered successfully",
    "cancelled": "Delivery cancelled",
    "failed": "Delivery failed",
  };
  return messages[status] || "Processing your delivery";
};

/**
 * @desc    Get delivery status updates in real-time
 * @route   GET /api/deliveries/:deliveryId/updates
 * @access  Private (Customer/Driver)
 */
export const getDeliveryUpdates = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .select("status pickup dropoff driverId driverDetails tracking estimatedPickupTime pickedUpAt");

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Check access permissions
    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get driver current location
    let driverLocation = null;
    let etaMinutes = null;

    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId)
        .select("currentLocation location");

      if (driver) {
        if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
          driverLocation = {
            lat: driver.currentLocation.lat,
            lng: driver.currentLocation.lng,
            updatedAt: driver.currentLocation.updatedAt,
          };
        }

        // Calculate ETA
        if (driverLocation) {
          if (delivery.status === "picked_up" || delivery.status === "in_transit") {
            // Calculate to dropoff
            const distance = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              delivery.dropoff.lat,
              delivery.dropoff.lng
            );
            etaMinutes = Math.ceil(distance * 3);
          } else if (delivery.status === "assigned") {
            // Calculate to pickup
            const distance = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              delivery.pickup.lat,
              delivery.pickup.lng
            );
            etaMinutes = Math.ceil(distance * 3);
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        deliveryId: delivery._id,
        status: delivery.status,
        driverLocation,
        etaMinutes,
        tracking: delivery.tracking || null,
        lastUpdate: new Date(),
        canTrack: ["assigned", "picked_up", "in_transit"].includes(delivery.status),
      },
    });
  } catch (error) {
    console.error("❌ Get delivery updates error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery updates",
    });
  }
};

/**
 * @desc    Get driver's delivery statistics
 * @route   GET /api/deliveries/driver/stats
 * @access  Private (Driver)
 */
export const getDriverDeliveryStats = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Get stats for different periods
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [todayStats, weekStats, monthStats, allTimeStats] = await Promise.all([
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
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            averageRating: { $avg: "$rating" },
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
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
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
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
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
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            averageRating: { $avg: "$rating" },
            averageEarning: { $avg: "$fare.totalFare" },
          },
        },
      ]),
    ]);

    // Get recent deliveries for activity feed
    const recentDeliveries = await Delivery.find({
      driverId: driver._id,
      status: "delivered",
    })
      .sort({ deliveredAt: -1 })
      .limit(5)
      .populate("customerId", "name avatarUrl")
      .select("deliveredAt fare.totalFare tip.amount rating pickup.address dropoff.address");

    res.status(200).json({
      success: true,
      data: {
        today: todayStats[0] || { count: 0, earnings: 0 },
        week: weekStats[0] || { count: 0, earnings: 0 },
        month: monthStats[0] || { count: 0, earnings: 0 },
        allTime: allTimeStats[0] || {
          count: 0,
          earnings: 0,
          averageRating: 0,
          averageEarning: 0,
        },
        recentDeliveries,
        acceptanceRate: driver.totalRequests
          ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
          : 0,
        onlineHours: driver.totalOnlineHours || 0,
        currentStatus: {
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          hasActiveDelivery: !!driver.currentDeliveryId,
        },
      },
    });
  } catch (error) {
    console.error("❌ Get driver delivery stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery statistics",
    });
  }
};