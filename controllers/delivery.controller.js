import User from "../models/user.models.js";
import Rider from "../models/rider.model.js"; // Updated import
import Company from "../models/company.models.js";
import Delivery from "../models/delivery.models.js";
import mongoose from "mongoose";

/**
 * @desc    Create a new delivery
 * @route   POST /api/deliveries
 * @access  Private (Customer)
 */
export const createDelivery = async (req, res) => {
  try {
    const customer = req.user;
    
    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can create deliveries"
      });
    }

    const {
      pickupAddress, pickupLat, pickupLng,
      dropoffAddress, dropoffLat, dropoffLng,
      itemType, itemDescription, itemWeight, itemValue,
      customerName, customerPhone, recipientName, recipientPhone,
      estimatedDistance, estimatedDuration, deliveryInstructions
    } = req.body;

    // Validate required fields
    if (!pickupAddress || !pickupLat || !pickupLng ||
        !dropoffAddress || !dropoffLat || !dropoffLng ||
        !itemType || !customerName || !customerPhone || !recipientName || !recipientPhone) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Create delivery - using model field names
    const delivery = new Delivery({
      customerId: customer._id,
      customerName,
      customerPhone,
      recipientName,
      recipientPhone,
      pickup: {
        address: pickupAddress,
        lat: parseFloat(pickupLat),
        lng: parseFloat(pickupLng)
      },
      dropoff: {
        address: dropoffAddress,
        lat: parseFloat(dropoffLat),
        lng: parseFloat(dropoffLng)
      },
      itemType: itemType, // This matches the model
      itemDescription,
      itemWeight: itemWeight || 1,
      itemValue: itemValue || 0,
      estimatedDistanceMeters: estimatedDistance || 5000,
      estimatedDurationSec: estimatedDuration || 600,
      deliveryInstructions,
      status: 'created', // Use 'created' instead of 'pending' to match model enum
      meta: {
        platform: req.headers['x-platform'] || 'web',
        ipAddress: req.ip
      }
    });

    await delivery.save();

    res.status(201).json({
      success: true,
      message: "Delivery request created successfully",
      data: delivery
    });

  } catch (error) {
    console.error("Create delivery error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const query = { customerId: customer._id };
    if (status) query.status = status;

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate('companyId', 'name contactPhone')
        .populate({
          path: 'riderId',
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

    res.status(200).json({
      success: true,
      data: deliveries,
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
 * @desc    Get company's deliveries
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
          path: 'riderId',
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
    console.error("Get company deliveries error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get rider's deliveries
 * @route   GET /api/deliveries/rider
 * @access  Private (Rider)
 */
export const getRiderDeliveries = async (req, res) => {
  try {
    const riderUser = req.user;
    
    if (riderUser.role !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const rider = await Rider.findOne({ userId: riderUser._id });
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found"
      });
    }

    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { riderId: rider._id };
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
    console.error("Get rider deliveries error:", error);
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
        path: 'riderId',
        populate: { path: 'userId', select: 'name phone' }
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
      const rider = await Rider.findOne({ userId: user._id });
      if (rider && delivery.riderId?._id.toString() === rider._id.toString()) {
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
          path: 'riderId',
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
 * @desc    Assign delivery to rider
 * @route   PATCH /api/deliveries/:deliveryId/assign
 * @access  Private (Company Admin)
 */
export const assignDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { deliveryId } = req.params;
    const { riderId } = req.body;

    const delivery = await Delivery.findById(deliveryId).session(session);
    
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    if (delivery.status !== 'created') { // Changed from 'pending' to 'created'
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Delivery cannot be assigned"
      });
    }

    const rider = await Rider.findById(riderId).session(session);
    if (!rider) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Rider not found"
      });
    }

    if (!rider.isAvailable) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Rider is not available"
      });
    }

    // Check if rider is in same company (if delivery has company assigned)
    if (delivery.companyId && rider.companyId?.toString() !== delivery.companyId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Rider does not belong to this company"
      });
    }

    // Assign delivery to rider
    delivery.riderId = riderId;
    if (!delivery.companyId && rider.companyId) {
      delivery.companyId = rider.companyId;
    }
    delivery.status = 'assigned';
    delivery.assignedAt = new Date();
    await delivery.save({ session });

    // Update rider status
    rider.currentDeliveryId = delivery._id;
    rider.isAvailable = false;
    await rider.save({ session });

    await session.commitTransaction();

    // Populate delivery data
    await delivery.populate([
      { path: 'customerId', select: 'name phone' },
      { 
        path: 'riderId',
        populate: { path: 'userId', select: 'name phone' }
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Delivery assigned to rider successfully",
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
 * @access  Private (Rider)
 */
export const updateDeliveryStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const riderUser = req.user;
    const { deliveryId } = req.params;
    const { status, location } = req.body;

    // Update status validation to match model
    if (!['picked_up', 'in_transit', 'delivered', 'returned', 'failed'].includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid status"
      });
    }

    const rider = await Rider.findOne({ userId: riderUser._id }).session(session);
    if (!rider) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Rider profile not found"
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      riderId: rider._id
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found"
      });
    }

    // Validate status transition (updated to match model)
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
      // Add tracking location to meta
      delivery.meta = delivery.meta || {};
      delivery.meta.trackingLocation = {
        lat: parseFloat(location.lat),
        lng: parseFloat(location.lng),
        timestamp: new Date()
      };
      
      // You might want to add this to a tracking history array
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

    // If delivery is completed, make rider available again
    if (['delivered', 'returned', 'failed'].includes(status)) {
      rider.currentDeliveryId = null;
      rider.isAvailable = true;
      rider.totalDeliveries = (rider.totalDeliveries || 0) + 1;
      await rider.save({ session });
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