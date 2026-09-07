import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import Delivery from "../models/delivery.models.js";
import POD from "../models/pod.model.js";
import Errand from "../models/errand.model.js";
import ManualRecord from "../models/manualRecord.model.js";
import bcrypt from "bcryptjs";
import { sendNotification } from "../utils/notification.js";
import mongoose from "mongoose";

// ─── RIDER MANAGEMENT ────────────────────────────────────────────────────────

// GET /api/company-dashboard/riders
export const listRiders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const companyId = req.user.companyId;

    const query = { companyId };
    if (status === "online") query.isOnline = true;
    if (status === "offline") query.isOnline = false;
    if (status === "suspended") query.isSuspended = true;
    if (status === "pending") query.approvalStatus = "pending";
    if (status === "approved") query.approvalStatus = "approved";

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let driversQuery = Driver.find(query)
      .populate("userId", "name phone email avatarUrl")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    if (search) {
      const users = await User.find({
        $or: [
          { name: new RegExp(search, "i") },
          { phone: new RegExp(search, "i") },
        ],
      }).select("_id");
      const userIds = users.map((u) => u._id);
      query.$or = [
        { userId: { $in: userIds } },
        { plateNumber: new RegExp(search, "i") },
      ];
      driversQuery = Driver.find(query)
        .populate("userId", "name phone email avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
    }

    const [drivers, total] = await Promise.all([
      driversQuery,
      Driver.countDocuments(query),
    ]);

    // Attach last 30-day stats per driver
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const driversWithStats = await Promise.all(
      drivers.map(async (driver) => {
        const [riderr, manual] = await Promise.all([
          Delivery.aggregate([
            { $match: { driverId: driver._id, status: "delivered", deliveredAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, count: { $sum: 1 }, earnings: { $sum: "$fare.totalFare" } } },
          ]),
          ManualRecord.aggregate([
            { $match: { driverId: driver._id, status: "COMPLETED", createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, count: { $sum: 1 }, earnings: { $sum: "$totalAmount" } } },
          ]),
        ]);
        return {
          ...driver.toObject(),
          stats30Days: {
            ridderrDeliveries: riderr[0]?.count || 0,
            ridderrEarnings: riderr[0]?.earnings || 0,
            manualDeliveries: manual[0]?.count || 0,
            manualEarnings: manual[0]?.earnings || 0,
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: driversWithStats,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error("❌ listRiders error:", error);
    res.status(500).json({ success: false, message: "Failed to list riders" });
  }
};

// POST /api/company-dashboard/riders
export const addRider = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const companyId = req.user.companyId;
    const { name, email, phone, password, vehicleType, plateNumber, vehicleColor, vehicleMake, vehicleModel } = req.body;

    if (!name || !email || !phone || !password || !vehicleType || !plateNumber || !vehicleColor) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "name, email, phone, password, vehicleType, plateNumber and vehicleColor are required" });
    }

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] }).session(session);
    if (existing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ success: false, message: "User with this email or phone already exists" });
    }

    const existingPlate = await Driver.findOne({ plateNumber: plateNumber.toUpperCase().trim() }).session(session);
    if (existingPlate) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ success: false, message: "Vehicle with this plate number already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await User.create([{
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      phone,
      role: "driver",
      companyId,
      isActive: true,
      isVerified: false,
    }], { session });

    const tempLicense = `TEMP-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
    const licenseExpiry = new Date();
    licenseExpiry.setFullYear(licenseExpiry.getFullYear() + 1);

    const [driver] = await Driver.create([{
      userId: newUser._id,
      companyId,
      vehicleType,
      vehicleColor,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      plateNumber: plateNumber.toUpperCase().trim(),
      licenseNumber: tempLicense,
      licenseExpiry,
      approvalStatus: "pending",
      isOnline: false,
      isAvailable: false,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: "Rider added successfully",
      data: {
        user: { _id: newUser._id, name: newUser.name, email: newUser.email, phone: newUser.phone },
        driver: { _id: driver._id, vehicleType, plateNumber: driver.plateNumber, approvalStatus: driver.approvalStatus },
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("❌ addRider error:", error);
    res.status(500).json({ success: false, message: "Failed to add rider" });
  }
};

// PATCH /api/company-dashboard/riders/:driverId/approve
export const approveRider = async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await Driver.findOne({ _id: driverId, companyId: req.user.companyId });
    if (!driver) return res.status(404).json({ success: false, message: "Rider not found" });

    driver.approvalStatus = "approved";
    driver.isVerified = true;
    driver.approvedBy = req.user._id;
    driver.approvedAt = new Date();
    await driver.save();

    const driverUser = await User.findById(driver.userId);
    if (driverUser) {
      await sendNotification({
        userId: driverUser._id,
        title: "✅ Account Approved",
        message: "Your rider account has been approved. You can now go online and accept deliveries.",
        data: { type: "driver_approved" },
      });
    }

    res.status(200).json({ success: true, message: "Rider approved", data: { approvalStatus: driver.approvalStatus } });
  } catch (error) {
    console.error("❌ approveRider error:", error);
    res.status(500).json({ success: false, message: "Failed to approve rider" });
  }
};

// PATCH /api/company-dashboard/riders/:driverId/suspend
export const suspendRider = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: "Reason is required" });

    const driver = await Driver.findOne({ _id: driverId, companyId: req.user.companyId });
    if (!driver) return res.status(404).json({ success: false, message: "Rider not found" });

    driver.isSuspended = true;
    driver.suspensionReason = reason;
    driver.suspendedAt = new Date();
    driver.isOnline = false;
    driver.isAvailable = false;
    await driver.save();

    const driverUser = await User.findById(driver.userId);
    if (driverUser) {
      await sendNotification({
        userId: driverUser._id,
        title: "⚠️ Account Suspended",
        message: `Your account has been suspended. Reason: ${reason}`,
        data: { type: "driver_suspended", reason },
      });
    }

    res.status(200).json({ success: true, message: "Rider suspended" });
  } catch (error) {
    console.error("❌ suspendRider error:", error);
    res.status(500).json({ success: false, message: "Failed to suspend rider" });
  }
};

// PATCH /api/company-dashboard/riders/:driverId/activate
export const activateRider = async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await Driver.findOne({ _id: driverId, companyId: req.user.companyId });
    if (!driver) return res.status(404).json({ success: false, message: "Rider not found" });

    driver.isSuspended = false;
    driver.suspensionReason = "";
    driver.suspendedAt = null;
    await driver.save();

    const driverUser = await User.findById(driver.userId);
    if (driverUser) {
      await sendNotification({
        userId: driverUser._id,
        title: "✅ Account Reactivated",
        message: "Your rider account has been reactivated.",
        data: { type: "driver_reactivated" },
      });
    }

    res.status(200).json({ success: true, message: "Rider activated" });
  } catch (error) {
    console.error("❌ activateRider error:", error);
    res.status(500).json({ success: false, message: "Failed to activate rider" });
  }
};

// GET /api/company-dashboard/riders/:driverId/deliveries
export const getRiderDeliveries = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { page = 1, limit = 10, type = "all" } = req.query;
    const companyId = req.user.companyId;

    const driver = await Driver.findOne({ _id: driverId, companyId });
    if (!driver) return res.status(404).json({ success: false, message: "Rider not found" });

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [ridderrDeliveries, podOrders, errands, manualRecords] = await Promise.all([
      type === "all" || type === "delivery"
        ? Delivery.find({ driverId: driver._id }).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean()
        : [],
      type === "all" || type === "pod"
        ? POD.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean()
        : [],
      type === "all" || type === "errand"
        ? Errand.find({ driverId: driver._id }).sort({ createdAt: -1 }).lean()
        : [],
      type === "all" || type === "manual"
        ? ManualRecord.find({ driverId: driver._id, companyId }).sort({ createdAt: -1 }).lean()
        : [],
    ]);

    res.status(200).json({
      success: true,
      data: {
        driver: { _id: driver._id, plateNumber: driver.plateNumber, vehicleType: driver.vehicleType },
        deliveries: ridderrDeliveries,
        podOrders,
        errands,
        manualRecords,
        summary: {
          totalDeliveries: ridderrDeliveries.length,
          totalPOD: podOrders.length,
          totalErrands: errands.length,
          totalManual: manualRecords.length,
        },
      },
    });
  } catch (error) {
    console.error("❌ getRiderDeliveries error:", error);
    res.status(500).json({ success: false, message: "Failed to get rider deliveries" });
  }
};

// ─── DASHBOARD OVERVIEW ───────────────────────────────────────────────────────

// GET /api/company-dashboard/overview
export const getDashboardOverview = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalRiders, onlineRiders, pendingRiders,
      ridderrStats, podStats, errandStats, manualStats,
    ] = await Promise.all([
      Driver.countDocuments({ companyId }),
      Driver.countDocuments({ companyId, isOnline: true }),
      Driver.countDocuments({ companyId, approvalStatus: "pending" }),

      Delivery.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), createdAt: { $gte: monthAgo } } },
        { $group: { _id: "$status", count: { $sum: 1 }, earnings: { $sum: "$fare.totalFare" } } },
      ]),

      POD.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), createdAt: { $gte: monthAgo } } },
        { $group: { _id: "$status", count: { $sum: 1 }, collected: { $sum: "$amountToCollect" } } },
      ]),

      Errand.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), createdAt: { $gte: monthAgo } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      ManualRecord.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), createdAt: { $gte: monthAgo } } },
        { $group: { _id: "$serviceType", count: { $sum: 1 }, total: { $sum: "$totalAmount" } } },
      ]),
    ]);

    const formatStats = (arr) => arr.reduce((acc, s) => { acc[s._id] = { count: s.count }; return acc; }, {});

    res.status(200).json({
      success: true,
      data: {
        riders: { total: totalRiders, online: onlineRiders, pending: pendingRiders, offline: totalRiders - onlineRiders },
        ridderrDeliveries: formatStats(ridderrStats),
        podOrders: formatStats(podStats),
        errands: formatStats(errandStats),
        manualRecords: formatStats(manualStats),
        period: "last_30_days",
      },
    });
  } catch (error) {
    console.error("❌ getDashboardOverview error:", error);
    res.status(500).json({ success: false, message: "Failed to get dashboard overview" });
  }
};

// ─── ALL DELIVERIES (RIDERR) ──────────────────────────────────────────────────

// GET /api/company-dashboard/deliveries
export const getAllDeliveries = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { status, driverId, page = 1, limit = 10, startDate, endDate } = req.query;

    const companyDrivers = await Driver.find({ companyId }).select("_id").lean();
    const driverIds = companyDrivers.map((d) => d._id);

    const query = { driverId: { $in: driverIds } };
    if (status && status !== "all") query.status = status;
    if (driverId) query.driverId = driverId;
    if (startDate && endDate) query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate("customerId", "name phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Delivery.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error("❌ getAllDeliveries error:", error);
    res.status(500).json({ success: false, message: "Failed to get deliveries" });
  }
};

// ─── MANUAL RECORDS ───────────────────────────────────────────────────────────

// POST /api/company-dashboard/manual-records
export const createManualRecord = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const {
      driverId, serviceType, customServiceLabel,
      description, pickupAddress, dropoffAddress,
      customerName, customerPhone,
      amount, deliveryFee, amountPaid,
      paymentMethod, status, deliveryDate, notes,
    } = req.body;

    if (!serviceType || !description) {
      return res.status(400).json({ success: false, message: "serviceType and description are required" });
    }

    if (serviceType === "OTHER" && !customServiceLabel) {
      return res.status(400).json({ success: false, message: "customServiceLabel is required when serviceType is OTHER" });
    }

    // Validate driver belongs to this company
    let driverName, driverPhone;
    if (driverId) {
      const driver = await Driver.findOne({ _id: driverId, companyId }).populate("userId", "name phone");
      if (!driver) return res.status(404).json({ success: false, message: "Rider not found in your company" });
      driverName = driver.userId?.name;
      driverPhone = driver.userId?.phone;
    }

    const record = new ManualRecord({
      companyId,
      driverId: driverId || null,
      driverName,
      driverPhone,
      serviceType,
      customServiceLabel,
      description,
      pickupAddress,
      dropoffAddress,
      customerName,
      customerPhone,
      amount: Number(amount) || 0,
      deliveryFee: Number(deliveryFee) || 0,
      amountPaid: Number(amountPaid) || 0,
      paymentMethod: paymentMethod || "CASH",
      status: status || "COMPLETED",
      deliveryDate: deliveryDate ? new Date(deliveryDate) : new Date(),
      notes,
      recordedBy: req.user._id,
    });

    await record.save();

    res.status(201).json({ success: true, message: "Manual record created", data: record });
  } catch (error) {
    console.error("❌ createManualRecord error:", error);
    res.status(500).json({ success: false, message: "Failed to create manual record" });
  }
};

// GET /api/company-dashboard/manual-records
export const listManualRecords = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { serviceType, driverId, paymentStatus, status, page = 1, limit = 10, startDate, endDate } = req.query;

    const query = { companyId };
    if (serviceType && serviceType !== "all") query.serviceType = serviceType;
    if (driverId) query.driverId = driverId;
    if (paymentStatus && paymentStatus !== "all") query.paymentStatus = paymentStatus;
    if (status && status !== "all") query.status = status;
    if (startDate && endDate) query.deliveryDate = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [records, total] = await Promise.all([
      ManualRecord.find(query)
        .populate("driverId", "plateNumber vehicleType")
        .sort({ deliveryDate: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ManualRecord.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: records,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error("❌ listManualRecords error:", error);
    res.status(500).json({ success: false, message: "Failed to list manual records" });
  }
};

// GET /api/company-dashboard/manual-records/:recordId
export const getManualRecord = async (req, res) => {
  try {
    const record = await ManualRecord.findOne({ _id: req.params.recordId, companyId: req.user.companyId })
      .populate("driverId", "plateNumber vehicleType userId")
      .populate("recordedBy", "name");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    console.error("❌ getManualRecord error:", error);
    res.status(500).json({ success: false, message: "Failed to get record" });
  }
};

// PATCH /api/company-dashboard/manual-records/:recordId
export const updateManualRecord = async (req, res) => {
  try {
    const record = await ManualRecord.findOne({ _id: req.params.recordId, companyId: req.user.companyId });
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const allowed = ["description", "pickupAddress", "dropoffAddress", "customerName", "customerPhone",
      "amount", "deliveryFee", "amountPaid", "paymentMethod", "status", "deliveryDate", "notes", "driverId"];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) record[field] = req.body[field];
    });

    await record.save();
    res.status(200).json({ success: true, message: "Record updated", data: record });
  } catch (error) {
    console.error("❌ updateManualRecord error:", error);
    res.status(500).json({ success: false, message: "Failed to update record" });
  }
};

// DELETE /api/company-dashboard/manual-records/:recordId
export const deleteManualRecord = async (req, res) => {
  try {
    const record = await ManualRecord.findOneAndDelete({ _id: req.params.recordId, companyId: req.user.companyId });
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    res.status(200).json({ success: true, message: "Record deleted" });
  } catch (error) {
    console.error("❌ deleteManualRecord error:", error);
    res.status(500).json({ success: false, message: "Failed to delete record" });
  }
};

// ─── MANUAL RECORDS SUMMARY ───────────────────────────────────────────────────

// GET /api/company-dashboard/manual-records/summary
export const getManualRecordsSummary = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { startDate, endDate } = req.query;

    const dateFilter = startDate && endDate
      ? { $gte: new Date(startDate), $lte: new Date(endDate) }
      : { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };

    const [byType, byPayment, byDriver] = await Promise.all([
      ManualRecord.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), deliveryDate: dateFilter } },
        { $group: { _id: "$serviceType", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" }, totalPaid: { $sum: "$amountPaid" } } },
        { $sort: { count: -1 } },
      ]),
      ManualRecord.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), deliveryDate: dateFilter } },
        { $group: { _id: "$paymentStatus", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } },
      ]),
      ManualRecord.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), deliveryDate: dateFilter, driverId: { $ne: null } } },
        { $group: { _id: "$driverId", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" }, driverName: { $first: "$driverName" } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: { byType, byPayment, topDrivers: byDriver },
    });
  } catch (error) {
    console.error("❌ getManualRecordsSummary error:", error);
    res.status(500).json({ success: false, message: "Failed to get summary" });
  }
};
