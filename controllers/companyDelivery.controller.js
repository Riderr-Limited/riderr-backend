import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import Company from "../models/company.models.js";
import User from "../models/user.models.js";
import Payment from "../models/payments.models.js";
import mongoose from "mongoose";
import { sendNotification } from "../utils/notification.js";

/**
 * @desc  Get all open delivery requests (no location filter — company sees everything)
 * @route GET /api/company/delivery-requests
 * @access Private (company_admin)
 */
export const getOpenDeliveryRequests = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = "created" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { status };

    // Only show paid or cash deliveries
    query.$or = [
      { "payment.method": "cash" },
      { "payment.method": { $ne: "cash" }, "payment.status": "paid" },
    ];

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate("customerId", "name phone avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
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
    console.error("getOpenDeliveryRequests error:", error);
    res.status(500).json({ success: false, message: "Failed to get delivery requests" });
  }
};

/**
 * @desc  Company accepts a delivery request
 * @route POST /api/company/delivery-requests/:deliveryId/accept
 * @access Private (company_admin)
 */
export const companyAcceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const companyUser = req.user;
    const { deliveryId } = req.params;

    const company = await Company.findById(companyUser.companyId).session(session);
    if (!company || company.status !== "active") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, message: "Company not active" });
    }

    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Delivery not found" });
    }

    if (delivery.status !== "created" || delivery.companyId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: delivery.companyId
          ? "This delivery has already been accepted by a company"
          : `Cannot accept delivery with status: ${delivery.status}`,
      });
    }

    const isCash = delivery.payment?.method === "cash";
    if (!isCash && delivery.payment?.status !== "paid") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Payment not completed for this delivery" });
    }

    // Assign company to delivery (driver assignment happens separately)
    delivery.companyId = company._id;
    delivery.companyDetails = {
      companyId: company._id,
      name: company.name,
      logo: company.logoUrl,
      contactPhone: company.contactPhone,
      address: company.address,
      email: company.contactEmail,
      rating: 0,
    };
    // Keep status "created" so a driver can still accept it, OR set to "assigned" if company self-assigns
    // We keep "created" so company can then assign a driver via the assign-driver endpoint
    await delivery.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: "Company Accepted Your Delivery",
        message: `${company.name} has accepted your delivery request and will assign a driver shortly.`,
        data: { type: "company_accepted", deliveryId: delivery._id, companyName: company.name },
      });
    }

    res.status(200).json({
      success: true,
      message: `Delivery accepted by ${company.name}. Assign a driver to proceed.`,
      data: {
        deliveryId: delivery._id,
        referenceId: delivery.referenceId,
        status: delivery.status,
        companyId: company._id,
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("companyAcceptDelivery error:", error);
    res.status(500).json({ success: false, message: "Failed to accept delivery" });
  }
};

/**
 * @desc  Company assigns one of its drivers to an accepted delivery
 * @route POST /api/company/delivery-requests/:deliveryId/assign-driver
 * @access Private (company_admin)
 */
export const companyAssignDriver = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const companyUser = req.user;
    const { deliveryId } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "driverId is required" });
    }

    const company = await Company.findById(companyUser.companyId).session(session);
    if (!company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Delivery not found" });
    }

    if (delivery.companyId?.toString() !== company._id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, message: "This delivery does not belong to your company" });
    }

    if (!["created", "assigned"].includes(delivery.status) || delivery.driverId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Delivery already has a driver or cannot be assigned" });
    }

    // Verify driver belongs to this company
    const driver = await Driver.findOne({ _id: driverId, companyId: company._id })
      .populate("userId", "name phone avatarUrl rating")
      .session(session);

    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Driver not found in your company" });
    }

    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Driver is not available",
        reasons: {
          offline: !driver.isOnline ? "Driver is offline" : null,
          unavailable: !driver.isAvailable ? "Driver is unavailable" : null,
          busy: driver.currentDeliveryId ? "Driver has an active delivery" : null,
        },
      });
    }

    delivery.driverId = driver._id;
    delivery.status = "assigned";
    delivery.assignedAt = new Date();
    delivery.driverDetails = {
      driverId: driver._id,
      userId: driver.userId._id,
      name: driver.userId.name,
      phone: driver.userId.phone,
      avatarUrl: driver.userId.avatarUrl,
      rating: driver.userId.rating || 0,
      vehicle: {
        type: driver.vehicleType || "bike",
        make: driver.vehicleMake || "",
        model: driver.vehicleModel || "",
        plateNumber: driver.plateNumber || "",
      },
    };

    driver.currentDeliveryId = delivery._id;
    driver.isAvailable = false;
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    driver.acceptedRequests = (driver.acceptedRequests || 0) + 1;

    await delivery.save({ session });
    await driver.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Notify driver
    await sendNotification({
      userId: driver.userId._id,
      title: "New Delivery Assigned",
      message: `You have been assigned a delivery by ${company.name}. Please head to the pickup location.`,
      data: { type: "delivery_assigned_by_company", deliveryId: delivery._id },
    });

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: "Driver Assigned",
        message: `${driver.userId.name} from ${company.name} has been assigned to your delivery.`,
        data: { type: "driver_assigned", deliveryId: delivery._id, driverName: driver.userId.name },
      });
    }

    res.status(200).json({
      success: true,
      message: "Driver assigned successfully",
      data: {
        deliveryId: delivery._id,
        referenceId: delivery.referenceId,
        status: delivery.status,
        driver: delivery.driverDetails,
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("companyAssignDriver error:", error);
    res.status(500).json({ success: false, message: "Failed to assign driver" });
  }
};

/**
 * @desc  Get all deliveries managed by this company (accepted + in-progress + completed)
 * @route GET /api/company/managed-deliveries
 * @access Private (company_admin)
 */
export const getCompanyManagedDeliveries = async (req, res) => {
  try {
    const companyUser = req.user;
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { companyId: companyUser.companyId };
    if (status && status !== "all") query.status = status;

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate("customerId", "name phone avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
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
    console.error("getCompanyManagedDeliveries error:", error);
    res.status(500).json({ success: false, message: "Failed to get managed deliveries" });
  }
};

/**
 * @desc  Company updates delivery status (picked_up → delivered)
 * @route PATCH /api/company/managed-deliveries/:deliveryId/status
 * @access Private (company_admin)
 */
export const companyUpdateDeliveryStatus = async (req, res) => {
  try {
    const companyUser = req.user;
    const { deliveryId } = req.params;
    const { status } = req.body;

    const allowed = ["picked_up", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${allowed.join(", ")}`,
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      companyId: companyUser.companyId,
    });

    if (!delivery) {
      return res.status(404).json({ success: false, message: "Delivery not found or not managed by your company" });
    }

    const transitions = {
      assigned: ["picked_up", "cancelled"],
      picked_up: ["delivered", "cancelled"],
    };

    if (!transitions[delivery.status]?.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${delivery.status} to ${status}`,
      });
    }

    delivery.status = status;
    if (status === "picked_up") delivery.pickedUpAt = new Date();
    if (status === "delivered") delivery.deliveredAt = new Date();
    if (status === "cancelled") {
      delivery.cancelledAt = new Date();
      delivery.cancelledBy = { userId: companyUser._id, role: "company_admin", reason: req.body.reason || "Cancelled by company" };

      // Free up driver
      if (delivery.driverId) {
        await Driver.findByIdAndUpdate(delivery.driverId, {
          currentDeliveryId: null,
          isAvailable: true,
        });
      }
    }

    await delivery.save();

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      const messages = {
        picked_up: "Your package has been picked up and is on the way.",
        delivered: "Your package has been delivered!",
        cancelled: "Your delivery has been cancelled by the company.",
      };
      await sendNotification({
        userId: customer._id,
        title: "Delivery Update",
        message: messages[status],
        data: { type: `delivery_${status}`, deliveryId: delivery._id },
      });
    }

    res.status(200).json({
      success: true,
      message: `Delivery status updated to ${status}`,
      data: { deliveryId: delivery._id, status: delivery.status },
    });
  } catch (error) {
    console.error("companyUpdateDeliveryStatus error:", error);
    res.status(500).json({ success: false, message: "Failed to update delivery status" });
  }
};

/**
 * @desc  Get company delivery stats
 * @route GET /api/company/delivery-stats
 * @access Private (company_admin)
 */
export const getCompanyDeliveryStats = async (req, res) => {
  try {
    const companyUser = req.user;
    const companyId = companyUser.companyId;

    const [total, active, completed, cancelled, earnings] = await Promise.all([
      Delivery.countDocuments({ companyId }),
      Delivery.countDocuments({ companyId, status: { $in: ["created", "assigned", "picked_up"] } }),
      Delivery.countDocuments({ companyId, status: "delivered" }),
      Delivery.countDocuments({ companyId, status: "cancelled" }),
      Delivery.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), status: "delivered" } },
        { $group: { _id: null, total: { $sum: "$fare.totalFare" } } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        active,
        completed,
        cancelled,
        totalEarnings: earnings[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("getCompanyDeliveryStats error:", error);
    res.status(500).json({ success: false, message: "Failed to get delivery stats" });
  }
};
