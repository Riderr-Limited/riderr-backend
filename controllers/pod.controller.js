import mongoose from "mongoose";
import POD from "../models/pod.model.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import { sendNotification } from "../utils/notification.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const addAudit = (pod, action, actor, actorRole, note = "") => {
  pod.auditLog.push({ action, actor: actor._id, actorRole, note });
};

// ─── CREATE POD ORDER ────────────────────────────────────────────────────────
// POST /api/pod
export const createPOD = async (req, res) => {
  try {
    const customer = req.user;
    if (customer.role !== "customer") {
      return res.status(403).json({ success: false, message: "Only customers can create POD orders" });
    }

    const {
      productName, productDescription, productQuantity, productImageUrl,
      productAmount, deliveryFee, handlingFee,
      pickupAddress, pickupLat, pickupLng, pickupInstructions,
      dropoffAddress, dropoffLat, dropoffLng,
      recipientName, recipientPhone, dropoffInstructions,
      merchantId,
      paymentMethod,
      inspectionAllowed, returnWindowHours, returnConditions,
      companyId,
    } = req.body;

    if (!productName || !productAmount || !dropoffAddress || !companyId) {
      return res.status(400).json({ success: false, message: "productName, productAmount, dropoffAddress and companyId are required" });
    }

    // Validate merchant if provided
    let merchant = null;
    if (merchantId) {
      merchant = await User.findById(merchantId).select("name phone");
      if (!merchant) return res.status(404).json({ success: false, message: "Merchant not found" });
    }

    const pod = new POD({
      customerId:    customer._id,
      customerName:  customer.name,
      customerPhone: customer.phone,
      merchantId:    merchantId || null,
      merchantName:  merchant?.name,
      merchantPhone: merchant?.phone,
      companyId:     companyId || null, // optional — customer can pick a company
      product: {
        name:        productName,
        description: productDescription,
        quantity:    productQuantity || 1,
        imageUrl:    productImageUrl,
      },
      pickup: {
        address:      pickupAddress,
        lat:          pickupLat,
        lng:          pickupLng,
        instructions: pickupInstructions,
      },
      dropoff: {
        address:        dropoffAddress,
        lat:            dropoffLat,
        lng:            dropoffLng,
        recipientName,
        recipientPhone,
        instructions:   dropoffInstructions,
      },
      productAmount:  Number(productAmount),
      deliveryFee:    Number(deliveryFee) || 0,
      handlingFee:    Number(handlingFee) || 0,
      paymentMethod:  paymentMethod || "CASH_ON_DELIVERY",
      inspectionAllowed: inspectionAllowed !== false,
      returnWindowHours: returnWindowHours || 24,
      returnConditions,
    });

    addAudit(pod, "POD_CREATED", customer, "customer");
    await pod.save();

    res.status(201).json({
      success: true,
      message: "POD order created successfully",
      data: pod,
    });
  } catch (error) {
    console.error("❌ createPOD error:", error);
    res.status(500).json({ success: false, message: "Failed to create POD order" });
  }
};

// ─── CONFIRM POD (company/merchant confirms product is available) ─────────────
// PATCH /api/pod/:podId/confirm
export const confirmPOD = async (req, res) => {
  try {
    const user = req.user;
    const { podId } = req.params;

    const pod = await POD.findById(podId);
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    if (pod.status !== "POD_REQUESTED") {
      return res.status(400).json({ success: false, message: `Cannot confirm from status: ${pod.status}` });
    }

    // Only company_admin of the selected company or admin can confirm
    if (user.role === "company_admin") {
      if (pod.companyId && pod.companyId.toString() !== user.companyId.toString()) {
        return res.status(403).json({ success: false, message: "This order was not directed to your company" });
      }
      // If no companyId set yet, claim it for this company
      if (!pod.companyId) pod.companyId = user.companyId;
    } else if (user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only company admin or admin can confirm POD orders" });
    }

    pod.status = "CONFIRMED";
    pod.confirmedAt = new Date();
    addAudit(pod, "POD_CONFIRMED", user, user.role);
    await pod.save();

    // Notify customer
    await sendNotification({
      userId: pod.customerId,
      title: "✅ POD Order Confirmed",
      message: `Your Pay-on-Delivery order #${pod.referenceId} has been confirmed. Product is available.`,
      data: { type: "pod_confirmed", podId: pod._id },
    });

    res.status(200).json({ success: true, message: "POD order confirmed", data: pod });
  } catch (error) {
    console.error("❌ confirmPOD error:", error);
    res.status(500).json({ success: false, message: "Failed to confirm POD order" });
  }
};

// ─── MARK READY FOR DELIVERY ─────────────────────────────────────────────────
// PATCH /api/pod/:podId/ready
export const markReadyForDelivery = async (req, res) => {
  try {
    const user = req.user;
    const { podId } = req.params;

    const pod = await POD.findById(podId);
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    if (pod.status !== "CONFIRMED") {
      return res.status(400).json({ success: false, message: `Cannot mark ready from status: ${pod.status}` });
    }

    if (!["company_admin", "admin"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    pod.status = "READY_FOR_DELIVERY";
    pod.readyAt = new Date();
    addAudit(pod, "READY_FOR_DELIVERY", user, user.role);
    await pod.save();

    res.status(200).json({ success: true, message: "POD order marked ready for delivery", data: pod });
  } catch (error) {
    console.error("❌ markReadyForDelivery error:", error);
    res.status(500).json({ success: false, message: "Failed to update POD order" });
  }
};

// ─── ASSIGN DRIVER ────────────────────────────────────────────────────────────
// POST /api/pod/:podId/assign
export const assignDriverToPOD = async (req, res) => {
  try {
    const user = req.user;
    const { podId } = req.params;
    const { driverId } = req.body;

    if (!driverId) return res.status(400).json({ success: false, message: "driverId is required" });

    if (!["company_admin", "admin"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const pod = await POD.findById(podId);
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    if (!["CONFIRMED", "READY_FOR_DELIVERY"].includes(pod.status)) {
      return res.status(400).json({ success: false, message: `Cannot assign driver from status: ${pod.status}` });
    }

    const driver = await Driver.findById(driverId).populate("userId", "name phone");
    if (!driver) return res.status(404).json({ success: false, message: "Driver not found" });

    pod.driverId = driver._id;
    // Set companyId from the driver's company (same pattern as delivery flow)
    if (driver.companyId) pod.companyId = driver.companyId;
    pod.status = "OUT_FOR_DELIVERY";
    pod.outForDeliveryAt = new Date();
    addAudit(pod, "DRIVER_ASSIGNED", user, user.role, `Driver: ${driver.userId?.name}`);
    await pod.save();

    // Notify driver
    if (driver.userId) {
      await sendNotification({
        userId: driver.userId._id,
        title: "📦 New POD Delivery",
        message: `You have been assigned a Pay-on-Delivery order #${pod.referenceId}. Collect ₦${pod.amountToCollect?.toLocaleString()} from customer.`,
        data: { type: "pod_assigned", podId: pod._id, amountToCollect: pod.amountToCollect },
      });
    }

    // Notify customer
    await sendNotification({
      userId: pod.customerId,
      title: "🚗 Driver On The Way",
      message: `A driver has been assigned to your POD order #${pod.referenceId} and is heading to you.`,
      data: { type: "pod_out_for_delivery", podId: pod._id },
    });

    res.status(200).json({ success: true, message: "Driver assigned to POD order", data: pod });
  } catch (error) {
    console.error("❌ assignDriverToPOD error:", error);
    res.status(500).json({ success: false, message: "Failed to assign driver" });
  }
};

// ─── DRIVER MARKS AWAITING CUSTOMER ──────────────────────────────────────────
// PATCH /api/pod/:podId/awaiting
export const markAwaitingCustomer = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can update this status" });
    }

    const { podId } = req.params;
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const pod = await POD.findOne({ _id: podId, driverId: driver._id });
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found or not assigned to you" });

    if (pod.status !== "OUT_FOR_DELIVERY") {
      return res.status(400).json({ success: false, message: `Cannot update from status: ${pod.status}` });
    }

    pod.status = "AWAITING_CUSTOMER";
    pod.awaitingCustomerAt = new Date();
    addAudit(pod, "AWAITING_CUSTOMER", driverUser, "driver", "Driver arrived at delivery location");
    await pod.save();

    await sendNotification({
      userId: pod.customerId,
      title: "🔔 Driver Has Arrived",
      message: `Your driver has arrived with your POD order #${pod.referenceId}. Please inspect and pay ₦${pod.amountToCollect?.toLocaleString()}.`,
      data: { type: "pod_awaiting_customer", podId: pod._id, amountToCollect: pod.amountToCollect },
    });

    res.status(200).json({ success: true, message: "Status updated to awaiting customer", data: pod });
  } catch (error) {
    console.error("❌ markAwaitingCustomer error:", error);
    res.status(500).json({ success: false, message: "Failed to update POD status" });
  }
};

// ─── RECORD PAYMENT (DELIVERED & PAID) ───────────────────────────────────────
// POST /api/pod/:podId/payment
export const recordPODPayment = async (req, res) => {
  try {
    const driverUser = req.user;
    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can record POD payment" });
    }

    const { podId } = req.params;
    const { paymentReference, note } = req.body;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const pod = await POD.findOne({ _id: podId, driverId: driver._id });
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found or not assigned to you" });

    if (pod.status !== "AWAITING_CUSTOMER") {
      return res.status(400).json({ success: false, message: `Cannot record payment from status: ${pod.status}` });
    }

    pod.status = "DELIVERED_PAID";
    pod.paymentStatus = "COLLECTED";
    pod.paymentReference = paymentReference || `CASH-${Date.now()}`;
    pod.paymentCollectedAt = new Date();
    pod.deliveredAt = new Date();
    addAudit(pod, "PAYMENT_COLLECTED", driverUser, "driver", note || `Cash collected: ₦${pod.amountToCollect}`);
    await pod.save();

    // Notify customer
    await sendNotification({
      userId: pod.customerId,
      title: "✅ Payment Recorded",
      message: `Payment of ₦${pod.amountToCollect?.toLocaleString()} recorded for POD order #${pod.referenceId}. Thank you!`,
      data: { type: "pod_delivered_paid", podId: pod._id },
    });

    // Notify merchant if exists
    if (pod.merchantId) {
      await sendNotification({
        userId: pod.merchantId,
        title: "💰 POD Payment Collected",
        message: `Payment of ₦${pod.productAmount?.toLocaleString()} collected for your product in order #${pod.referenceId}. Settlement pending.`,
        data: { type: "pod_payment_collected", podId: pod._id },
      });
    }

    res.status(200).json({ success: true, message: "Payment recorded. Order delivered and paid.", data: pod });
  } catch (error) {
    console.error("❌ recordPODPayment error:", error);
    res.status(500).json({ success: false, message: "Failed to record payment" });
  }
};

// ─── REJECT / RETURN ─────────────────────────────────────────────────────────
// POST /api/pod/:podId/reject
export const rejectPOD = async (req, res) => {
  try {
    const user = req.user;
    const { podId } = req.params;
    const { reason } = req.body;

    if (!reason) return res.status(400).json({ success: false, message: "Rejection reason is required" });

    const pod = await POD.findById(podId);
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    // Customer or driver can reject when awaiting customer
    const isCustomer = user._id.toString() === pod.customerId.toString();
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (pod.status !== "AWAITING_CUSTOMER") {
      return res.status(400).json({ success: false, message: `Cannot reject from status: ${pod.status}` });
    }

    if (!pod.inspectionAllowed) {
      return res.status(400).json({ success: false, message: "Merchant does not allow inspection/rejection for this order" });
    }

    pod.status = "REJECTED_RETURN";
    pod.paymentStatus = "UNPAID";
    pod.rejectionReason = reason;
    pod.rejectedAt = new Date();
    pod.returnStatus = "PENDING";
    addAudit(pod, "POD_REJECTED", user, user.role, reason);
    await pod.save();

    // Notify driver
    if (pod.driverId) {
      const driver = await Driver.findById(pod.driverId).populate("userId", "_id");
      if (driver?.userId) {
        await sendNotification({
          userId: driver.userId._id,
          title: "❌ POD Rejected",
          message: `Customer rejected POD order #${pod.referenceId}. Reason: ${reason}. Please return the product.`,
          data: { type: "pod_rejected", podId: pod._id },
        });
      }
    }

    // Notify merchant
    if (pod.merchantId) {
      await sendNotification({
        userId: pod.merchantId,
        title: "↩️ Product Returned",
        message: `Customer rejected your product in POD order #${pod.referenceId}. Reason: ${reason}.`,
        data: { type: "pod_rejected", podId: pod._id },
      });
    }

    res.status(200).json({ success: true, message: "POD order rejected. Return workflow initiated.", data: pod });
  } catch (error) {
    console.error("❌ rejectPOD error:", error);
    res.status(500).json({ success: false, message: "Failed to reject POD order" });
  }
};

// ─── SETTLE (platform marks merchant as settled) ─────────────────────────────
// PATCH /api/pod/:podId/settle
export const settlePOD = async (req, res) => {
  try {
    const user = req.user;
    if (!["admin", "company_admin"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { podId } = req.params;
    const { settlementAmount, note } = req.body;

    const pod = await POD.findById(podId);
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    if (pod.status !== "DELIVERED_PAID") {
      return res.status(400).json({ success: false, message: `Cannot settle from status: ${pod.status}` });
    }

    pod.status = "SETTLED";
    pod.paymentStatus = "SETTLED";
    pod.settlementAmount = settlementAmount || pod.productAmount;
    pod.settledAt = new Date();
    addAudit(pod, "SETTLED", user, user.role, note || `Settled ₦${pod.settlementAmount}`);
    await pod.save();

    if (pod.merchantId) {
      await sendNotification({
        userId: pod.merchantId,
        title: "💳 Settlement Processed",
        message: `₦${pod.settlementAmount?.toLocaleString()} has been settled to you for POD order #${pod.referenceId}.`,
        data: { type: "pod_settled", podId: pod._id },
      });
    }

    res.status(200).json({ success: true, message: "POD order settled", data: pod });
  } catch (error) {
    console.error("❌ settlePOD error:", error);
    res.status(500).json({ success: false, message: "Failed to settle POD order" });
  }
};

// ─── CANCEL POD ───────────────────────────────────────────────────────────────
// PATCH /api/pod/:podId/cancel
export const cancelPOD = async (req, res) => {
  try {
    const user = req.user;
    const { podId } = req.params;
    const { reason } = req.body;

    if (!reason) return res.status(400).json({ success: false, message: "Cancellation reason is required" });

    const pod = await POD.findById(podId);
    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    const isCustomer = user._id.toString() === pod.customerId.toString();
    const isCompanyAdmin = user.role === "company_admin";
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isCompanyAdmin && !isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const cancellableStatuses = ["POD_REQUESTED", "CONFIRMED", "READY_FOR_DELIVERY"];
    if (!cancellableStatuses.includes(pod.status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel from status: ${pod.status}` });
    }

    pod.status = "CANCELLED";
    pod.cancelledAt = new Date();
    pod.cancelledBy = { userId: user._id, role: user.role, reason };
    addAudit(pod, "CANCELLED", user, user.role, reason);
    await pod.save();

    res.status(200).json({ success: true, message: "POD order cancelled", data: pod });
  } catch (error) {
    console.error("❌ cancelPOD error:", error);
    res.status(500).json({ success: false, message: "Failed to cancel POD order" });
  }
};

// ─── GET POD DETAILS ──────────────────────────────────────────────────────────
// GET /api/pod/:podId
export const getPODDetails = async (req, res) => {
  try {
    const user = req.user;
    const { podId } = req.params;

    const pod = await POD.findById(podId)
      .populate("customerId", "name phone avatarUrl")
      .populate("merchantId", "name phone")
      .populate("companyId", "name logo contactPhone")
      .populate("driverId");

    if (!pod) return res.status(404).json({ success: false, message: "POD order not found" });

    const isCustomer = user._id.toString() === pod.customerId._id.toString();
    const isAdmin = user.role === "admin";
    const isCompanyAdmin = user.role === "company_admin" && user.companyId?.toString() === pod.companyId?._id?.toString();
    const isMerchant = pod.merchantId && user._id.toString() === pod.merchantId._id?.toString();

    if (!isCustomer && !isAdmin && !isCompanyAdmin && !isMerchant) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.status(200).json({ success: true, data: pod });
  } catch (error) {
    console.error("❌ getPODDetails error:", error);
    res.status(500).json({ success: false, message: "Failed to get POD order" });
  }
};

// ─── LIST POD ORDERS ──────────────────────────────────────────────────────────
// GET /api/pod
export const listPODOrders = async (req, res) => {
  try {
    const user = req.user;
    const { status, page = 1, limit = 10 } = req.query;

    let query = {};

    if (user.role === "customer") {
      query.customerId = user._id;
    } else if (user.role === "company_admin") {
      // See both: unassigned new orders (companyId null) AND their own company orders
      query.$or = [
        { companyId: user.companyId },
        { companyId: null, status: "POD_REQUESTED" },
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
    const [pods, total] = await Promise.all([
      POD.find(query)
        .populate("customerId", "name phone")
        .populate("companyId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      POD.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: pods,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    console.error("❌ listPODOrders error:", error);
    res.status(500).json({ success: false, message: "Failed to list POD orders" });
  }
};
