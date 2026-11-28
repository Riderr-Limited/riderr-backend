// controllers/finance.controller.js
// Manual refunds and cash commission (admin), and the rider's own commission view.
import mongoose from "mongoose";
import Payment from "../models/payments.models.js";
import Driver from "../models/riders.models.js";
import { completeManualRefund } from "../services/payments/refund.service.js";
import { getCommissionSummary, settleCommissionManually } from "../services/payments/commission.service.js";

const page = (q) => {
  const limit = Math.min(100, Math.max(1, parseInt(q.limit) || 20));
  const p = Math.max(1, parseInt(q.page) || 1);
  return { limit, page: p, skip: (p - 1) * limit };
};

/**
 * @route  GET /api/admin/refunds?status=pending|refunded|all
 * Refunds waiting for the team (default), with what's needed to pay them back.
 */
export const listRefunds = async (req, res) => {
  try {
    const { limit, page: p, skip } = page(req.query);
    const status = req.query.status || "pending";
    const filter =
      status === "all"
        ? { "refund.status": { $in: ["pending", "processing", "refunded"] } }
        : status === "refunded"
          ? { "refund.status": "refunded" }
          : { "refund.status": { $in: ["pending", "processing"] }, status: "successful" };

    const [items, total, totals] = await Promise.all([
      Payment.find(filter)
        .sort({ "refund.requestedAt": 1 })
        .skip(skip)
        .limit(limit)
        .populate("customerId", "name email phone")
        .lean(),
      Payment.countDocuments(filter),
      Payment.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: "$refund.amount" } } }])
    ]);

    res.status(200).json({
      success: true,
      data: {
        refunds: items.map((p) => ({
          paymentId: p._id,
          job: p.rideId ? { type: "ride", id: p.rideId } : { type: "delivery", id: p.deliveryId },
          customer: p.customerId
            ? { id: p.customerId._id, name: p.customerId.name, email: p.customerId.email, phone: p.customerId.phone }
            : null,
          paidAmount: p.amount,
          refundAmount: p.refund?.amount,
          cancellationFee: p.refund?.cancellationFee || 0,
          paymentMethod: p.paymentMethod,
          // Find the transaction in the Flutterwave dashboard with these.
          transactionReference: p.paystackReference || p.gatewayReference,
          flutterwaveTransactionId: p.webhookData?.id || p.metadata?.flwTransactionId || null,
          reason: p.refund?.reason,
          requestedAt: p.refund?.requestedAt,
          status: p.refund?.status,
          refundedAt: p.refund?.refundedAt,
          refundReference: p.refund?.reference
        })),
        totalAmount: totals[0]?.amount || 0,
        pagination: { page: p, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error("List refunds error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  POST /api/admin/refunds/:paymentId/complete
 * @body   { reference?, note?, amount? }
 * Record that the team has paid the customer back. The customer is notified.
 */
export const completeRefund = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }
    const { reference, note, amount } = req.body || {};
    const r = await completeManualRefund(paymentId, {
      adminUserId: req.user._id,
      reference,
      note,
      amount: amount != null ? Number(amount) : undefined
    });
    if (!r.success) return res.status(r.status || 400).json({ success: false, message: r.error });
    res.status(200).json({
      success: true,
      message: "Refund recorded and the customer has been notified",
      data: { paymentId: r.payment._id, refund: r.payment.refund, status: r.payment.status }
    });
  } catch (error) {
    console.error("Complete refund error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  GET /api/admin/commissions
 * Riders who owe commission from cash jobs, most owed first.
 */
export const listCommissionOwed = async (req, res) => {
  try {
    const { limit, page: p, skip } = page(req.query);
    const filter = { "commission.owed": { $gt: 0 } };
    const [drivers, total, totals] = await Promise.all([
      Driver.find(filter)
        .sort({ "commission.owed": -1 })
        .skip(skip)
        .limit(limit)
        .select("userId companyId onboardingType commission")
        .populate("userId", "name phone email")
        .populate("companyId", "name")
        .lean(),
      Driver.countDocuments(filter),
      Driver.aggregate([{ $match: filter }, { $group: { _id: null, owed: { $sum: "$commission.owed" } } }])
    ]);
    res.status(200).json({
      success: true,
      data: {
        riders: drivers.map((d) => ({
          driverId: d._id,
          name: d.userId?.name,
          phone: d.userId?.phone,
          company: d.companyId?.name || null,
          onboardingType: d.onboardingType,
          owed: d.commission?.owed || 0,
          lastChargedAt: d.commission?.lastChargedAt
        })),
        totalOwed: totals[0]?.owed || 0,
        pagination: { page: p, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error("List commission owed error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/** @route GET /api/admin/commissions/:driverId */
export const getDriverCommission = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.driverId) || !(await Driver.exists({ _id: req.params.driverId }))) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }
    res.status(200).json({ success: true, data: await getCommissionSummary(req.params.driverId) });
  } catch (error) {
    console.error("Get rider commission error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  POST /api/admin/commissions/:driverId/settle
 * @body   { amount, note? }
 * Record commission a rider paid Riderr directly (e.g. by bank transfer).
 */
export const settleDriverCommission = async (req, res) => {
  try {
    const amount = Math.round(Number(req.body?.amount));
    if (!(amount > 0)) return res.status(400).json({ success: false, message: "amount must be a positive number" });
    if (!mongoose.Types.ObjectId.isValid(req.params.driverId)) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }
    const r = await settleCommissionManually(req.params.driverId, amount, req.user._id, req.body?.note);
    if (!r.success) return res.status(400).json({ success: false, message: r.error });
    res.status(200).json({
      success: true,
      message: r.amount < amount ? `Recorded ₦${r.amount.toLocaleString()} (all the rider owed).` : "Payment recorded",
      data: { recorded: r.amount, ...(await getCommissionSummary(req.params.driverId)) }
    });
  } catch (error) {
    console.error("Settle commission error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  GET /api/driver/commission
 * What the rider owes Riderr from cash jobs. It is deducted from their next
 * in-app payout.
 */
export const getMyCommission = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id }).select("_id");
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });
    const summary = await getCommissionSummary(driver._id);
    res.status(200).json({
      success: true,
      data: {
        ...summary,
        message: summary.owed
          ? `You owe ₦${summary.owed.toLocaleString()} in commission from cash jobs. It will be deducted from your next card or transfer job.`
          : "You don't owe any commission."
      }
    });
  } catch (error) {
    console.error("Get my commission error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
