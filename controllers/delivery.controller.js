// controllers/delivery.controller.js
import DeliveryPerson from "../models/deliveryPerson.model.js";
import Delivery from "../models/delivery.models.js";
import mongoose from "mongoose";

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * @desc    Get nearby delivery persons for delivery
 * @route   GET /api/deliveries/nearby-riders
 * @access  Private (Customer)
 */
export const getNearbyRidersForDelivery = async (req, res) => {
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
    const maxDistance = parseFloat(radius);

    // Find nearby delivery persons for deliveries
    const deliveryPersons = await DeliveryPerson.findNearby(
      longitude,
      latitude,
      maxDistance,
      'delivery',
      vehicleType
    );

    res.status(200).json({
      success: true,
      message: `Found ${deliveryPersons.length} nearby delivery persons`,
      data: deliveryPersons.map(person => ({
        _id: person._id,
        userId: person.userId,
        companyId: person.companyId,
        licenseNumber: person.licenseNumber,
        vehicleType: person.vehicleType,
        vehiclePlate: person.vehiclePlate,
        vehicleColor: person.vehicleColor,
        vehicleModel: person.vehicleModel,
        isAvailable: person.isAvailable,
        isVerified: person.isVerified,
        isOnline: person.isOnline,
        currentLocation: person.currentLocation,
        totalDeliveries: person.totalDeliveries,
        averageRating: person.averageRating,
        distance: person._doc.distance || 0,
        distanceText: `${(person._doc.distance || 0).toFixed(1)} km away`,
        estimatedArrival: Math.ceil((person._doc.distance || 0) * 3),
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
 * @desc    Create a new delivery with optional delivery person assignment
 * @route   POST /api/deliveries
 * @access  Private (Customer)
 */
export const createDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const customer = req.user;
    
    if (customer.role !== "customer") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only customers can create deliveries"
      });
    }

    const {
      pickupAddress, pickupLat, pickupLng, pickupName,
      dropoffAddress, dropoffLat, dropoffLng, dropoffName,
      itemType, itemDescription, itemWeight, itemValue,
      customerName, customerPhone, recipientName, recipientPhone,
      estimatedDistance, estimatedDuration, deliveryInstructions,
      deliveryPersonId // Optional: pre-selected delivery person
    } = req.body;

    // Validate required fields
    if (!pickupAddress || !pickupLat || !pickupLng ||
        !dropoffAddress || !dropoffLat || !dropoffLng ||
        !itemType || !customerName || !customerPhone || !recipientName || !recipientPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Create delivery object
    const deliveryData = {
      customerId: customer._id,
      customerName,
      customerPhone,
      recipientName,
      recipientPhone,
      pickup: {
        address: pickupAddress,
        lat: parseFloat(pickupLat),
        lng: parseFloat(pickupLng),
        name: pickupName || pickupAddress
      },
      dropoff: {
        address: dropoffAddress,
        lat: parseFloat(dropoffLat),
        lng: parseFloat(dropoffLng),
        name: dropoffName || dropoffAddress
      },
      itemType: itemType,
      itemDescription,
      itemWeight: itemWeight || 1,
      itemValue: itemValue || 0,
      estimatedDistanceMeters: estimatedDistance || 5000,
      estimatedDurationSec: estimatedDuration || 600,
      deliveryInstructions,
      status: 'created',
      meta: {
        platform: req.headers['x-platform'] || 'web',
        ipAddress: req.ip
      }
    };

    // If delivery person is pre-selected, validate and assign
    if (deliveryPersonId) {
      const deliveryPerson = await DeliveryPerson.findById(deliveryPersonId).session(session);
      
      if (!deliveryPerson) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Selected delivery person not found"
        });
      }

      if (!deliveryPerson.isAvailableForDelivery()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Selected delivery person is not available"
        });
      }

      // Assign delivery person and update status
      deliveryData.deliveryPersonId = deliveryPersonId;
      deliveryData.companyId = deliveryPerson.companyId;
      deliveryData.status = 'assigned';
      deliveryData.assignedAt = new Date();

      // Update delivery person status
      deliveryPerson.currentDeliveryId = null; // Will be set after delivery is saved
      deliveryPerson.isAvailable = false;
      await deliveryPerson.save({ session });
    }

    // Create delivery
    const delivery = new Delivery(deliveryData);
    await delivery.save({ session });

    // Update delivery person's currentDeliveryId if assigned
    if (deliveryPersonId) {
      await DeliveryPerson.findByIdAndUpdate(
        deliveryPersonId,
        { currentDeliveryId: delivery._id },
        { session }
      );
    }

    await session.commitTransaction();

    // Populate delivery data for response
    await delivery.populate([
      { path: 'deliveryPersonId', populate: { path: 'userId', select: 'name phone avatarUrl' } },
      { path: 'companyId', select: 'name logo contactPhone' }
    ]);

    res.status(201).json({
      success: true,
      message: deliveryPersonId 
        ? "Delivery created and assigned successfully" 
        : "Delivery request created successfully",
      data: delivery
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Create delivery error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const query = { customerId: customer._id };
    if (status) query.status = status;

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('companyId', 'name contactPhone logo')
        .populate({
          path: 'deliveryPersonId',
          populate: { 
            path: 'userId', 
            select: 'name phone avatarUrl' 
          }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Delivery.countDocuments(query)
    ]);

    // Format deliveries with location names
    const formattedDeliveries = deliveries.map(delivery => {
      const deliveryObj = delivery.toObject();
      
      return {
        ...deliveryObj,
        pickup: {
          ...deliveryObj.pickup,
          displayName: deliveryObj.pickup.name || deliveryObj.pickup.address,
        },
        dropoff: {
          ...deliveryObj.dropoff,
          displayName: deliveryObj.dropoff.name || deliveryObj.dropoff.address,
        },
        summary: {
          from: deliveryObj.pickup.name || deliveryObj.pickup.address.split(',')[0],
          to: deliveryObj.dropoff.name || deliveryObj.dropoff.address.split(',')[0],
          status: deliveryObj.status,
          itemType: deliveryObj.itemType
        }
      };
    });

    res.status(200).json({
      success: true,
      data: formattedDeliveries,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error("Get my deliveries error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get delivery person's deliveries
 * @route   GET /api/deliveries/delivery-person
 * @access  Private (Delivery Person)
 */
export const getDeliveryPersonDeliveries = async (req, res) => {
  try {
    const user = req.user;
    
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

    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { deliveryPersonId: deliveryPerson._id };
    if (status) query.status = status;

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('customerId', 'name phone')
        .populate('companyId', 'name')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Delivery.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get delivery person deliveries error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get delivery by ID
 * @route   GET /api/deliveries/:deliveryId
 * @access  Private
 */
export const getDeliveryById = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .populate('customerId', 'name phone email')
      .populate('companyId', 'name contactPhone')
      .populate({
        path: 'deliveryPersonId',
        populate: { path: 'userId', select: 'name phone avatarUrl' }
      });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Check access permissions
    let hasAccess = false;

    if (user.role === "admin") {
      hasAccess = true;
    } else if (user.role === "customer" && delivery.customerId._id.toString() === user._id.toString()) {
      hasAccess = true;
    } else if (user.role === "rider") {
      const deliveryPerson = await DeliveryPerson.findOne({ userId: user._id });
      if (deliveryPerson && delivery.deliveryPersonId?._id.toString() === deliveryPerson._id.toString()) {
        hasAccess = true;
      }
    } else if (user.role === "company_admin" && delivery.companyId?._id.toString() === user.companyId?.toString()) {
      hasAccess = true;
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    res.status(200).json({
      success: true,
      data: delivery
    });

  } catch (error) {
    console.error("Get delivery by ID error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get all deliveries (Admin)
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

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status;
    const companyId = req.query.companyId;

    const query = {};
    if (status) query.status = status;
    if (companyId) query.companyId = companyId;

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('customerId', 'name phone')
        .populate('companyId', 'name')
        .populate({
          path: 'deliveryPersonId',
          populate: { path: 'userId', select: 'name phone' }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Delivery.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get all deliveries error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Assign delivery to delivery person
 * @route   PATCH /api/deliveries/:deliveryId/assign
 * @access  Private (Company Admin)
 */
export const assignDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { deliveryId } = req.params;
    const { deliveryPersonId } = req.body;

    const delivery = await Delivery.findById(deliveryId).session(session);
    
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    if (delivery.status !== 'created') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery cannot be assigned"
      });
    }

    const deliveryPerson = await DeliveryPerson.findById(deliveryPersonId).session(session);
    if (!deliveryPerson) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery person not found"
      });
    }

    if (!deliveryPerson.isAvailableForDelivery()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery person is not available"
      });
    }

    if (delivery.companyId && deliveryPerson.companyId?.toString() !== delivery.companyId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery person does not belong to this company"
      });
    }

    // Assign delivery to delivery person
    delivery.deliveryPersonId = deliveryPersonId;
    if (!delivery.companyId && deliveryPerson.companyId) {
      delivery.companyId = deliveryPerson.companyId;
    }
    delivery.status = 'assigned';
    delivery.assignedAt = new Date();
    await delivery.save({ session });

    // Update delivery person status
    deliveryPerson.currentDeliveryId = delivery._id;
    deliveryPerson.isAvailable = false;
    await deliveryPerson.save({ session });

    await session.commitTransaction();

    // Populate delivery data
    await delivery.populate([
      { path: 'customerId', select: 'name phone' },
      { 
        path: 'deliveryPersonId',
        populate: { path: 'userId', select: 'name phone avatarUrl' }
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Delivery assigned successfully",
      data: delivery
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Assign delivery error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Update delivery status
 * @route   PATCH /api/deliveries/:deliveryId/status
 * @access  Private (Delivery Person)
 */
export const updateDeliveryStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { status, location } = req.body;

    if (!['picked_up', 'in_transit', 'delivered', 'returned', 'failed'].includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid status"
      });
    }

    const deliveryPerson = await DeliveryPerson.findOne({ userId: user._id }).session(session);
    if (!deliveryPerson) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery person profile not found"
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      deliveryPersonId: deliveryPerson._id
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Validate status transition
    const validTransitions = {
      'assigned': ['picked_up', 'cancelled'],
      'picked_up': ['in_transit', 'returned'],
      'in_transit': ['delivered', 'failed', 'returned'],
      'delivered': [],
      'returned': [],
      'failed': [],
      'cancelled': []
    };

    if (!validTransitions[delivery.status]?.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${delivery.status} to ${status}`
      });
    }

    // Update delivery status
    delivery.status = status;
    
    // Update timestamps based on status
    if (status === 'picked_up') {
      delivery.pickedUpAt = new Date();
    } else if (status === 'in_transit') {
      delivery.inTransitAt = new Date();
    } else if (status === 'delivered') {
      delivery.deliveredAt = new Date();
    } else if (status === 'returned') {
      delivery.returnedAt = new Date();
    } else if (status === 'failed') {
      delivery.failedAt = new Date();
    }

    // Update tracking location if provided
    if (location && location.lat && location.lng) {
      delivery.meta = delivery.meta || {};
      delivery.meta.trackingLocation = {
        lat: parseFloat(location.lat),
        lng: parseFloat(location.lng),
        timestamp: new Date()
      };
      
      if (!delivery.meta.trackingHistory) {
        delivery.meta.trackingHistory = [];
      }
      delivery.meta.trackingHistory.push({
        lat: parseFloat(location.lat),
        lng: parseFloat(location.lng),
        timestamp: new Date()
      });
    }

    await delivery.save({ session });

    // If delivery is completed, make delivery person available again
    if (['delivered', 'returned', 'failed'].includes(status)) {
      deliveryPerson.currentDeliveryId = null;
      deliveryPerson.isAvailable = true;
      deliveryPerson.totalDeliveries = (deliveryPerson.totalDeliveries || 0) + 1;
      await deliveryPerson.save({ session });
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: `Delivery status updated to ${status}`,
      data: delivery
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Update delivery status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get company deliveries
 * @route   GET /api/deliveries/company/:companyId
 * @access  Private (Company Admin)
 */
export const getCompanyDeliveries = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;
    
    if (admin.role !== "company_admin" && admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }
    
    if (admin.role === "company_admin" && admin.companyId?.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot access another company's deliveries"
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const query = { companyId };
    if (status) query.status = status;

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('customerId', 'name phone')
        .populate({
          path: 'deliveryPersonId',
          populate: { path: 'userId', select: 'name phone avatarUrl' }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Delivery.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get company deliveries error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};
