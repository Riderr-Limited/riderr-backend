import Delivery from "../models/delivery.models.js";
import User from "../models/user.models.js";
import Rider from "../models/riders.models.js";
import mongoose from "mongoose";

/**
 * CREATE DELIVERY (Customer only)
 */
export const createDelivery = async (req, res, next) => {
  try {
    const customer = req.user;
    
    if (customer.role !== "customer") {
      const error = new Error("Only customers can create deliveries");
      error.statusCode = 403;
      throw error;
    }

    const {
      pickup, dropoff, type, weightKg, price, companyId,
      estimatedDistanceMeters, estimatedDurationSec, payment
    } = req.body;

    // Validate required fields
    if (!pickup?.address || !pickup?.lat || !pickup?.lng ||
        !dropoff?.address || !dropoff?.lat || !dropoff?.lng ||
        !type) {
      const error = new Error("Pickup, dropoff locations and delivery type are required");
      error.statusCode = 400;
      throw error;
    }

    // Generate reference ID
    const referenceId = `DEL-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const delivery = await Delivery.create({
      referenceId,
      customerId: customer._id,
      companyId: companyId || null,
      pickup,
      dropoff,
      type,
      weightKg,
      price,
      estimatedDistanceMeters,
      estimatedDurationSec,
      payment: payment || { method: "cod", status: "pending" },
      status: "created"
    });

    res.status(201).json({
      success: true,
      message: "Delivery created successfully",
      data: delivery
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET MY DELIVERIES (Customer)
 */
export const getMyDeliveries = async (req, res, next) => {
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
        total, page, limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET COMPANY DELIVERIES (Company Admin)
 */
export const getCompanyDeliveries = async (req, res, next) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;
    
    if (admin.role !== "company_admin" || admin.companyId.toString() !== companyId) {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [deliveries, total] = await Promise.all([
      Delivery.find({ companyId })
        .populate('customerId', 'name phone')
        .populate({
          path: 'riderId',
          populate: { path: 'userId', select: 'name phone' }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Delivery.countDocuments({ companyId })
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * ASSIGN DELIVERY TO RIDER (Company Admin)
 */
export const assignDelivery = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const admin = req.user;
    const { deliveryId } = req.params;
    const { riderId } = req.body;

    const delivery = await Delivery.findById(deliveryId).session(session);
    
    if (!delivery) {
      const error = new Error("Delivery not found");
      error.statusCode = 404;
      throw error;
    }

    if (admin.role !== "company_admin" || 
        admin.companyId.toString() !== delivery.companyId?.toString()) {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    // Verify rider belongs to company
    const rider = await Rider.findOne({ 
      _id: riderId, 
      companyId: admin.companyId 
    }).session(session);

    if (!rider) {
      const error = new Error("Rider not found in your company");
      error.statusCode = 404;
      throw error;
    }

    // Update delivery
    delivery.riderId = riderId;
    delivery.status = "assigned";
    await delivery.save({ session });

    // Update rider status
    rider.currentStatus = "assigned";
    rider.isAvailable = false;
    await rider.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Delivery assigned successfully",
      data: delivery
    });

  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * UPDATE DELIVERY STATUS (Rider)
 */
export const updateDeliveryStatus = async (req, res, next) => {
  try {
    const rider = req.user;
    const { deliveryId } = req.params;
    const { status, proof } = req.body;

    if (rider.role !== "rider") {
      const error = new Error("Only riders can update delivery status");
      error.statusCode = 403;
      throw error;
    }

    // Find rider record first
    const riderRecord = await Rider.findOne({ userId: rider._id });
    if (!riderRecord) {
      const error = new Error("Rider profile not found");
      error.statusCode = 404;
      throw error;
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      riderId: riderRecord._id
    });

    if (!delivery) {
      const error = new Error("Delivery not found or not assigned to you");
      error.statusCode = 404;
      throw error;
    }

    const validTransitions = {
      "created": ["matched", "cancelled"],
      "matched": ["assigned", "cancelled"],
      "assigned": ["accepted", "cancelled"],
      "accepted": ["picked", "cancelled"],
      "picked": ["in_transit", "cancelled"],
      "in_transit": ["delivered", "cancelled"]
    };

    if (!validTransitions[delivery.status]?.includes(status)) {
      const error = new Error(`Cannot change status from ${delivery.status} to ${status}`);
      error.statusCode = 400;
      throw error;
    }

    delivery.status = status;
    
    if (status === "delivered" && proof) {
      delivery.proof = {
        ...proof,
        deliveredAt: new Date()
      };
    }

    await delivery.save();

    res.status(200).json({
      success: true,
      message: "Delivery status updated successfully",
      data: delivery
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET RIDER DELIVERIES (Rider)
 */
export const getRiderDeliveries = async (req, res, next) => {
  try {
    const rider = req.user;
    
    if (rider.role !== "rider") {
      const error = new Error("Only riders can access this endpoint");
      error.statusCode = 403;
      throw error;
    }

    const status = req.query.status;
    // Find rider record first
    const riderRecord = await Rider.findOne({ userId: rider._id });
    if (!riderRecord) {
      const error = new Error("Rider profile not found");
      error.statusCode = 404;
      throw error;
    }

    const query = { riderId: riderRecord._id };
    if (status) query.status = status;

    const deliveries = await Delivery.find(query)
      .populate('customerId', 'name phone')
      .populate('companyId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: deliveries
    });

  } catch (error) {
    next(error);
  }
};

/**
 * GET DELIVERY BY ID
 */
export const getDeliveryById = async (req, res, next) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .populate('customerId', 'name phone')
      .populate('companyId', 'name')
      .populate({
        path: 'riderId',
        populate: { path: 'userId', select: 'name phone' }
      });

    if (!delivery) {
      const error = new Error("Delivery not found");
      error.statusCode = 404;
      throw error;
    }

    // Check access permissions
    let isRiderOwner = false;
    if (delivery.riderId && user.role === "rider") {
      const riderRecord = await Rider.findOne({ _id: delivery.riderId, userId: user._id });
      isRiderOwner = !!riderRecord;
    }

    const hasAccess = 
      user.role === "admin" ||
      delivery.customerId._id.toString() === user._id.toString() ||
      isRiderOwner ||
      (user.role === "company_admin" && delivery.companyId?._id.toString() === user.companyId?.toString());

    if (!hasAccess) {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    res.status(200).json({
      success: true,
      data: delivery
    });

  } catch (error) {
    next(error);
  }
};

/**
 * ADMIN: GET ALL DELIVERIES
 */
export const getAllDeliveries = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      const error = new Error("Admin access required");
      error.statusCode = 403;
      throw error;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [deliveries, total] = await Promise.all([
      Delivery.find()
        .populate('customerId', 'name phone')
        .populate('companyId', 'name')
        .populate({
          path: 'riderId',
          populate: { path: 'userId', select: 'name phone' }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Delivery.countDocuments()
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
};