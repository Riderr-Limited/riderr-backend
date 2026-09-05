import Errand from "../models/errand.model.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import { sendNotification } from "../utils/notification.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const addAudit = (errand, action, actor, actorRole, note = "") => {
  errand.auditLog.push({ action, actor: actor._id, actorRole, note });
};

const PROHIBITED_KEYWORDS = ["weapon", "drug", "explosive", "illegal", "contraband"];
const isProhibited = (text = "") =>
  PROHIBITED_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));

// ─── CREATE ERRAND ────────────────────────────────────────────────────────────
// POST /api/errands
export const createErrand = async (req, res) => {
  try {
    const customer = req.user;
    if (customer.role !== "customer") {
      return res.status(403).json({ success: false, message: "Only customers can create errands" });
    }

    const {
      errandType, description, specialInstructions, preferredTime,
      pickupAddress, pickupLat, pickupLng, pickupInstructions,
      destinationAddress, destinationLat, destinationLng,
      estimatedItemCost, spendingLimit, customerAdvance,
      serviceFee, paymentMethod,
      companyId,
    } = req.body;

    if (!errandType || !description || !pickupAddress || !companyId) {
      return res.status(400).json({ success: false, message: "errandType, description, pickupAddress and companyId are required" });
    }

    // Safety check
    if (isProhibited(description) || isProhibited(specialInstructions)) {
      return res.status(400).json({ success: false, message: "Errand description contains prohibited content" });
    }

    // Spending limit validation for purchase errands
    if (errandType === "PURCHASE") {
      if (!spendingLimit || spendingLimit <= 0) {
        return res.status(400).json({ success: false, message: "spendingLimit is required for PURCHASE errands" });
      }
      const MAX_SPENDING_LIMIT = Number(process.env.ERRAND_MAX_SPEND || 500000);
      if (spendingLimit > MAX_SPENDING_LIMIT) {
        return res.status(400).json({ success: false, message: `Spending limit cannot exceed ₦${MAX_SPENDING_LIMIT.toLocaleString()}` });
      }
    }

    const errand = new Errand({
      customerId:    customer._id,
      customerName:  customer.name,
      customerPhone: customer.phone,
      errandType,
      description,
      specialInstructions,
      preferredTime:  preferredTime ? new Date(preferredTime) : undefined,
      pickupLocation: {
        address:      pickupAddress,
        lat:          pickupLat,
        lng:          pickupLng,
        instructions: pickupInstructions,
      },
      destination: {
        address: destinationAddress,
        lat:     destinationLat,
        lng:     destinationLng,
      },
      estimatedItemCost: Number(estimatedItemCost) || 0,
      spendingLimit:     Number(spendingLimit) || 0,
      customerAdvance:   Number(customerAdvance) || 0,
      serviceFee:        Number(serviceFee) || 0,
      paymentMethod:     paymentMethod || "CASH",
      companyId:         companyId || null, // optional — customer can pick a company
    });

    addAudit(errand, "ERRAND_CREATED", customer, "customer");
    await errand.save();

    res.status(201).json({
      success: true,
      message: "Errand created successfully",
      data: errand,
    });
  } catch (error) {
    console.error("❌ createErrand error:", error);
    res.status(500).json({ success: false, message: "Failed to create errand" });
  }
};

// ─── ASSIGN RIDER ─────────────────────────────────────────────────────────────
// POST /api/errands/:errandId/assign
export const assignRiderToErrand = async (req, res) => {
  try {
    const user = req.user;
    const { errandId } = req.params;
    const { driverId } = req.body;

    if (!driverId) return res.status(400).json({ success: false, message: "driverId is required" });

    const errand = await Errand.findById(errandId);
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found" });

    // Access control
    if (user.role === "company_admin") {
      if (errand.companyId && errand.companyId.toString() !== user.companyId.toString()) {
        return res.status(403).json({ success: false, message: "This errand was not directed to your company" });
      }
      if (!errand.companyId) errand.companyId = user.companyId;
    } else if (user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (!["REQUESTED", "SEARCHING_RIDER"].includes(errand.status)) {
      return res.status(400).json({ success: false, message: `Cannot assign rider from status: ${errand.status}` });
    }

    const driver = await Driver.findById(driverId).populate("userId", "name phone _id");
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

    if (!driver.isOnline || !driver.isAvailable) {
      return res.status(400).json({ success: false, message: "Driver is not available" });
    }

    errand.driverId = driver._id;
    // Set companyId from driver's company (same pattern as delivery flow)
    if (driver.companyId) errand.companyId = driver.companyId;
    errand.status = "RIDER_ASSIGNED";
    errand.assignedAt = new Date();
    addAudit(errand, "RIDER_ASSIGNED", user, user.role, `Driver: ${driver.userId?.name}`);
    await errand.save();

    if (driver.userId) {
      await sendNotification({
        userId: driver.userId._id,
        title: "📋 New Errand Assigned",
        message: `You have been assigned an errand: ${errand.description.substring(0, 60)}...`,
        data: {
          type: "errand_assigned",
          errandId: errand._id,
          errandType: errand.errandType,
          spendingLimit: errand.spendingLimit,
          customerAdvance: errand.customerAdvance,
        },
      });
    }

    res.status(200).json({ success: true, message: "Rider assigned to errand", data: errand });
  } catch (error) {
    console.error("❌ assignRiderToErrand error:", error);
    res.status(500).json({ success: false, message: "Failed to assign rider" });
  }
};

// ─── RIDER ACCEPTS ERRAND ─────────────────────────────────────────────────────
// PATCH /api/errands/:errandId/accept
export const acceptErrand = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can accept errands" });
    }

    const { errandId } = req.params;
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const errand = await Errand.findOne({ _id: errandId, driverId: driver._id });
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found or not assigned to you" });

    if (errand.status !== "RIDER_ASSIGNED") {
      return res.status(400).json({ success: false, message: `Cannot accept from status: ${errand.status}` });
    }

    errand.status = "ACCEPTED";
    errand.acceptedAt = new Date();
    addAudit(errand, "ERRAND_ACCEPTED", driverUser, "driver");
    await errand.save();

    await sendNotification({
      userId: errand.customerId,
      title: "✅ Rider Accepted Your Errand",
      message: `A rider has accepted your errand and will begin shortly.`,
      data: { type: "errand_accepted", errandId: errand._id },
    });

    res.status(200).json({ success: true, message: "Errand accepted", data: errand });
  } catch (error) {
    console.error("❌ acceptErrand error:", error);
    res.status(500).json({ success: false, message: "Failed to accept errand" });
  }
};

// ─── START ERRAND (IN PROGRESS) ───────────────────────────────────────────────
// PATCH /api/errands/:errandId/start
export const startErrand = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can start errands" });
    }

    const { errandId } = req.params;
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const errand = await Errand.findOne({ _id: errandId, driverId: driver._id });
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found or not assigned to you" });

    if (errand.status !== "ACCEPTED") {
      return res.status(400).json({ success: false, message: `Cannot start from status: ${errand.status}` });
    }

    errand.status = "IN_PROGRESS";
    errand.startedAt = new Date();
    addAudit(errand, "ERRAND_STARTED", driverUser, "driver");
    await errand.save();

    await sendNotification({
      userId: errand.customerId,
      title: "🏃 Errand In Progress",
      message: `Your rider has started your errand.`,
      data: { type: "errand_in_progress", errandId: errand._id },
    });

    res.status(200).json({ success: true, message: "Errand started", data: errand });
  } catch (error) {
    console.error("❌ startErrand error:", error);
    res.status(500).json({ success: false, message: "Failed to start errand" });
  }
};

// ─── MARK AT PICKUP ───────────────────────────────────────────────────────────
// PATCH /api/errands/:errandId/at-pickup
export const markAtPickup = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can update this status" });
    }

    const { errandId } = req.params;
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const errand = await Errand.findOne({ _id: errandId, driverId: driver._id });
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found or not assigned to you" });

    if (errand.status !== "IN_PROGRESS") {
      return res.status(400).json({ success: false, message: `Cannot update from status: ${errand.status}` });
    }

    errand.status = "AT_PICKUP";
    addAudit(errand, "AT_PICKUP", driverUser, "driver");
    await errand.save();

    await sendNotification({
      userId: errand.customerId,
      title: "📍 Rider At Pickup",
      message: `Your rider has arrived at the pickup location.`,
      data: { type: "errand_at_pickup", errandId: errand._id },
    });

    res.status(200).json({ success: true, message: "Status updated to at pickup", data: errand });
  } catch (error) {
    console.error("❌ markAtPickup error:", error);
    res.status(500).json({ success: false, message: "Failed to update errand status" });
  }
};

// ─── RECORD EXPENSE ───────────────────────────────────────────────────────────
// POST /api/errands/:errandId/expense
export const recordExpense = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can record expenses" });
    }

    const { errandId } = req.params;
    const { actualSpend, receiptUrl, note } = req.body;

    if (actualSpend === undefined || actualSpend < 0) {
      return res.status(400).json({ success: false, message: "actualSpend is required and must be >= 0" });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const errand = await Errand.findOne({ _id: errandId, driverId: driver._id });
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found or not assigned to you" });

    if (!["IN_PROGRESS", "AT_PICKUP"].includes(errand.status)) {
      return res.status(400).json({ success: false, message: "Can only record expense while errand is in progress" });
    }

    // Enforce spending limit
    if (errand.spendingLimit > 0 && Number(actualSpend) > errand.spendingLimit) {
      return res.status(400).json({
        success: false,
        message: `Spend of ₦${actualSpend} exceeds approved limit of ₦${errand.spendingLimit}. Customer approval required.`,
        data: { spendingLimit: errand.spendingLimit, requestedSpend: actualSpend },
      });
    }

    errand.actualSpend = Number(actualSpend);
    errand.balanceReturned = Math.max(0, (errand.customerAdvance || 0) - Number(actualSpend));
    if (receiptUrl) errand.receiptUrl = receiptUrl;
    addAudit(errand, "EXPENSE_RECORDED", driverUser, "driver", note || `Spent: ₦${actualSpend}`);
    await errand.save();

    res.status(200).json({
      success: true,
      message: "Expense recorded",
      data: {
        actualSpend: errand.actualSpend,
        customerAdvance: errand.customerAdvance,
        balanceReturned: errand.balanceReturned,
      },
    });
  } catch (error) {
    console.error("❌ recordExpense error:", error);
    res.status(500).json({ success: false, message: "Failed to record expense" });
  }
};

// ─── COMPLETE ERRAND (AWAITING CONFIRMATION) ──────────────────────────────────
// PATCH /api/errands/:errandId/complete
export const completeErrand = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can mark errand complete" });
    }

    const { errandId } = req.params;
    const { completionProof, note } = req.body;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const errand = await Errand.findOne({ _id: errandId, driverId: driver._id });
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found or not assigned to you" });

    if (!["IN_PROGRESS", "AT_PICKUP"].includes(errand.status)) {
      return res.status(400).json({ success: false, message: `Cannot complete from status: ${errand.status}` });
    }

    errand.status = "AWAITING_CONFIRMATION";
    if (completionProof) errand.completionProof = completionProof;
    addAudit(errand, "TASK_COMPLETED_AWAITING_CONFIRMATION", driverUser, "driver", note || "");
    await errand.save();

    await sendNotification({
      userId: errand.customerId,
      title: "✅ Errand Completed",
      message: `Your errand has been completed. Please confirm to close the order.${errand.balanceReturned > 0 ? ` Balance to return: ₦${errand.balanceReturned.toLocaleString()}` : ""}`,
      data: { type: "errand_awaiting_confirmation", errandId: errand._id, balanceReturned: errand.balanceReturned },
    });

    res.status(200).json({ success: true, message: "Errand completed. Awaiting customer confirmation.", data: errand });
  } catch (error) {
    console.error("❌ completeErrand error:", error);
    res.status(500).json({ success: false, message: "Failed to complete errand" });
  }
};

// ─── CUSTOMER CONFIRMS COMPLETION ─────────────────────────────────────────────
// PATCH /api/errands/:errandId/confirm-completion
export const confirmErrandCompletion = async (req, res) => {
  try {
    const user = req.user;
    const { errandId } = req.params;

    const errand = await Errand.findById(errandId);
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found" });

    const isCustomer = user._id.toString() === errand.customerId.toString();
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (errand.status !== "AWAITING_CONFIRMATION") {
      return res.status(400).json({ success: false, message: `Cannot confirm from status: ${errand.status}` });
    }

    errand.status = "COMPLETED";
    errand.paymentStatus = "PAID";
    errand.completedAt = new Date();
    addAudit(errand, "ERRAND_CONFIRMED_COMPLETED", user, user.role);
    await errand.save();

    // Notify driver
    if (errand.driverId) {
      const driver = await Driver.findById(errand.driverId).populate("userId", "_id name");
      if (driver?.userId) {
        await sendNotification({
          userId: driver.userId._id,
          title: "🎉 Errand Confirmed",
          message: `Customer confirmed completion of errand #${errand.referenceId}.`,
          data: { type: "errand_completed", errandId: errand._id },
        });
      }
    }

    res.status(200).json({ success: true, message: "Errand confirmed and completed", data: errand });
  } catch (error) {
    console.error("❌ confirmErrandCompletion error:", error);
    res.status(500).json({ success: false, message: "Failed to confirm errand completion" });
  }
};

// ─── CANCEL ERRAND ────────────────────────────────────────────────────────────
// PATCH /api/errands/:errandId/cancel
export const cancelErrand = async (req, res) => {
  try {
    const user = req.user;
    const { errandId } = req.params;
    const { reason } = req.body;

    if (!reason) return res.status(400).json({ success: false, message: "Cancellation reason is required" });

    const errand = await Errand.findById(errandId);
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found" });

    const isCustomer = user._id.toString() === errand.customerId.toString();
    const isAdmin = user.role === "admin";
    const isCompanyAdmin = user.role === "company_admin";

    if (!isCustomer && !isAdmin && !isCompanyAdmin) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const cancellableStatuses = ["REQUESTED", "SEARCHING_RIDER", "RIDER_ASSIGNED", "ACCEPTED"];
    if (!cancellableStatuses.includes(errand.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel from status: ${errand.status}` });
    }

    errand.status = "CANCELLED";
    errand.cancelledAt = new Date();
    errand.cancelledBy = { userId: user._id, role: user.role, reason };
    addAudit(errand, "CANCELLED", user, user.role, reason);
    await errand.save();

    // Notify driver if assigned
    if (errand.driverId) {
      const driver = await Driver.findById(errand.driverId).populate("userId", "_id");
      if (driver?.userId) {
        await sendNotification({
          userId: driver.userId._id,
          title: "❌ Errand Cancelled",
          message: `Errand #${errand.referenceId} has been cancelled. Reason: ${reason}`,
          data: { type: "errand_cancelled", errandId: errand._id },
        });
      }
    }

    res.status(200).json({ success: true, message: "Errand cancelled", data: errand });
  } catch (error) {
    console.error("❌ cancelErrand error:", error);
    res.status(500).json({ success: false, message: "Failed to cancel errand" });
  }
};

// ─── RAISE DISPUTE ────────────────────────────────────────────────────────────
// POST /api/errands/:errandId/dispute
export const raiseErrandDispute = async (req, res) => {
  try {
    const user = req.user;
    const { errandId } = req.params;
    const { details } = req.body;

    if (!details) return res.status(400).json({ success: false, message: "Dispute details are required" });

    const errand = await Errand.findById(errandId);
    if (!errand) return res.status(404).json({ success: false, message: "Errand not found" });

    const isCustomer = user._id.toString() === errand.customerId.toString();
    if (!isCustomer && user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    errand.disputeRaised = true;
    errand.disputeDetails = details;
    addAudit(errand, "DISPUTE_RAISED", user, user.role, details);
    await errand.save();

    res.status(200).json({ success: true, message: "Dispute raised. Support team will review.", data: errand });
  } catch (error) {
    console.error("❌ raiseErrandDispute error:", error);
    res.status(500).json({ success: false, message: "Failed to raise dispute" });
  }
};

// ─── GET ERRAND DETAILS ───────────────────────────────────────────────────────
// GET /api/errands/:errandId
export const getErrandDetails = async (req, res) => {
  try {
    const user = req.user;
    const { errandId } = req.params;

    const errand = await Errand.findById(errandId)
      .populate("customerId", "name phone avatarUrl")
      .populate("companyId", "name logo")
      .populate("driverId");

    if (!errand) return res.status(404).json({ success: false, message: "Errand not found" });

    const isCustomer = user._id.toString() === errand.customerId._id.toString();
    const isAdmin = user.role === "admin";
    const isCompanyAdmin = user.role === "company_admin" && user.companyId?.toString() === errand.companyId?._id?.toString();

    let isDriver = false;
    if (user.role === "driver" && errand.driverId) {
      const driver = await import("../models/riders.models.js").then((m) => m.default.findOne({ userId: user._id }));
      isDriver = driver && errand.driverId._id?.toString() === driver._id.toString();
    }

    if (!isCustomer && !isAdmin && !isCompanyAdmin && !isDriver) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.status(200).json({ success: true, data: errand });
  } catch (error) {
    console.error("❌ getErrandDetails error:", error);
    res.status(500).json({ success: false, message: "Failed to get errand" });
  }
};

// ─── LIST ERRANDS ─────────────────────────────────────────────────────────────
// GET /api/errands
export const listErrands = async (req, res) => {
  try {
    const user = req.user;
    const { status, page = 1, limit = 10 } = req.query;

    let query = {};

    if (user.role === "customer") {
      query.customerId = user._id;
    } else if (user.role === "company_admin") {
      // See their company errands AND unassigned REQUESTED errands directed to them
      query.$or = [
        { companyId: user.companyId },
        { companyId: null, status: "REQUESTED" },
      ];
    } else if (user.role === "driver") {
      const driver = await Driver.findOne({ userId: user._id });
      if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });
      query.driverId = driver._id;
    } else if (user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (status && status !== "all") query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [errands, total] = await Promise.all([
      Errand.find(query)
        .populate("customerId", "name phone")
        .populate("companyId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Errand.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: errands,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error("❌ listErrands error:", error);
    res.status(500).json({ success: false, message: "Failed to list errands" });
  }
};
