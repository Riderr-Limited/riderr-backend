// controllers/finance.controller.js
// Manual refunds and cash commission (admin), and the rider's own commission view.
import mongoose from "mongoose";
import crypto from "crypto";
import Payment from "../models/payments.models.js";
import Driver from "../models/riders.models.js";
import { completeManualRefund } from "../services/payments/refund.service.js";
import { getCommissionSummary, settleCommissionManually } from "../services/payments/commission.service.js";
import { payoutPayment } from "../services/payments/payout.service.js";
import { createDedicatedVirtualAccount } from "../utils/flutterwave.js";

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
          job: p.purpose === "commission" ? { type: "commission_overpayment", driverId: p.driverId } : p.rideId ? { type: "ride", id: p.rideId } : { type: "delivery", id: p.deliveryId },
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
          ? `You owe ₦${summary.owed.toLocaleString()} in commission from cash jobs. Pay it in the app, or it will be deducted from your next card or transfer job.${
              summary.overLimit ? ` You're over the ₦${summary.limit.toLocaleString()} limit, so you can't go online until you pay.` : ""
            }`
          : "You don't owe any commission."
      }
    });
  } catch (error) {
    console.error("Get my commission error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  POST /api/driver/commission/pay
 * @body   { method: "card" | "bank_transfer", amount? }   (amount defaults to everything owed)
 * The rider pays Riderr the commission they owe from cash jobs.
 *   card          -> returns a reference; charge it with the usual
 *                    POST /api/payments/charge-card { reference, cardDetails }
 *                    (then /submit-otp or /submit-pin if asked).
 *   bank_transfer -> returns a one-off account to transfer into; it's
 *                    confirmed automatically by the Flutterwave webhook.
 * Poll GET /api/payments/status/:reference, or GET /api/driver/commission.
 */
export const payMyCommission = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id }).select("_id commission");
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const raw = String(req.body?.method || "").toLowerCase();
    const method = ["transfer", "bank", "bank_transfer"].includes(raw) ? "bank_transfer" : raw;
    if (!["card", "bank_transfer"].includes(method)) {
      return res.status(400).json({ success: false, message: 'method must be "card" or "bank_transfer"' });
    }

    const owed = Math.round(driver.commission?.owed || 0);
    if (owed <= 0) return res.status(400).json({ success: false, message: "You don't owe any commission" });
    const amount = req.body?.amount != null ? Math.round(Number(req.body.amount)) : owed;
    const minimum = Math.min(owed, 100);
    if (!(amount >= minimum) || amount > owed) {
      return res.status(400).json({ success: false, message: `Amount must be between ₦${minimum} and ₦${owed.toLocaleString()}` });
    }

    // Reuse an unfinished payment for the same amount and method.
    const existing = await Payment.findOne({
      purpose: "commission",
      driverId: driver._id,
      status: "pending",
      amount,
      paymentMethod: method === "card" ? "card" : "bank_transfer_dedicated",
      createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) }
    }).sort({ createdAt: -1 });
    if (existing) return res.status(200).json({ success: true, message: "Payment details", data: commissionPaymentResponse(existing) });

    const reference = `RIDERR-COMM-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    let bankDetails = null;
    if (method === "bank_transfer") {
      const va = await createDedicatedVirtualAccount({ email: req.user.email, amount, metadata: { reference, amount } });
      if (!va.success || !va.data?.accountNumber) {
        // No fallback account: money sent somewhere we can't match
        // automatically would never be credited to the rider.
        return res.status(503).json({ success: false, message: "Bank transfer is unavailable right now. Please pay by card or try again shortly." });
      }
      bankDetails = {
        bankName: va.data.bankName,
        accountNumber: va.data.accountNumber,
        accountName: va.data.accountName,
        amount,
        reference,
        expiresAt: va.data.expiresAt,
        instructions: [`Transfer exactly ₦${amount.toLocaleString()}`, "Payment is confirmed automatically"]
      };
    }

    const payment = await Payment.create({
      purpose: "commission",
      driverId: driver._id,
      customerId: req.user._id, // the payer (lets the existing card endpoints find it)
      amount,
      currency: "NGN",
      gateway: "flutterwave",
      gatewayReference: reference,
      paystackReference: reference,
      status: "pending",
      paymentMethod: method === "card" ? "card" : "bank_transfer_dedicated",
      paymentType: "direct",
      platformFee: amount,
      companyAmount: 0,
      metadata: {
        kind: "commission",
        owedAtStart: owed,
        ...(bankDetails ? { bankTransferDetails: bankDetails, transferType: "flutterwave_virtual" } : {})
      }
    });

    res.status(201).json({ success: true, message: "Payment created", data: commissionPaymentResponse(payment) });
  } catch (error) {
    console.error("Pay commission error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const commissionPaymentResponse = (p) => ({
  paymentId: p._id,
  reference: p.paystackReference,
  amount: p.amount,
  method: p.paymentMethod === "card" ? "card" : "bank_transfer",
  ...(p.paymentMethod === "card"
    ? { next: { endpoint: "POST /api/payments/charge-card", body: { reference: p.paystackReference, cardDetails: "{ number, cvv, expiry_month, expiry_year, pin? }" } } }
    : { bankDetails: p.metadata?.bankTransferDetails }),
  polling: { url: `/api/payments/status/${p.paystackReference}`, intervalSeconds: 5 }
});

/**
 * @route  GET /api/admin/payouts?status=failed|processing
 * Payouts that need attention. "processing" ones older than a few minutes may
 * have been interrupted: check Flutterwave before retrying them.
 */
export const listPayouts = async (req, res) => {
  try {
    const { limit, page: p, skip } = page(req.query);
    const status = req.query.status === "processing" ? "processing" : "failed";
    const filter = { "metadata.payoutStatus": status };
    const [items, total] = await Promise.all([
      Payment.find(filter).sort({ updatedAt: 1 }).skip(skip).limit(limit).lean(),
      Payment.countDocuments(filter)
    ]);
    res.status(200).json({
      success: true,
      data: {
        payouts: items.map((x) => ({
          paymentId: x._id,
          job: x.rideId ? { type: "ride", id: x.rideId } : { type: "delivery", id: x.deliveryId },
          driverId: x.driverId,
          companyId: x.companyId,
          amount: x.companyAmount,
          status: x.metadata?.payoutStatus,
          error: x.metadata?.payoutError || null,
          requiresAction: x.metadata?.payoutRequiresAction || null,
          startedAt: x.metadata?.payoutStartedAt
        })),
        pagination: { page: p, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error("List payouts error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  POST /api/admin/payouts/:paymentId/retry
 * @body   { confirmedNotSent? }  required for a payout stuck in "processing":
 *         only send it after checking in Flutterwave that no transfer went out.
 */
export const retryPayout = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    const status = payment.metadata?.payoutStatus;
    if (status === "paid" || payment.escrowDetails?.settledToCompany) {
      return res.status(400).json({ success: false, message: "This payout has already been sent" });
    }
    if (status === "processing") {
      if (req.body?.confirmedNotSent !== true) {
        return res.status(409).json({
          success: false,
          code: "PAYOUT_IN_PROGRESS",
          message: "This payout may already have been sent. Check Flutterwave, then retry with { confirmedNotSent: true } if no transfer went out."
        });
      }
      await Payment.updateOne(
        { _id: payment._id, "metadata.payoutStatus": "processing" },
        { $set: { "metadata.payoutStatus": "failed" }, $push: { auditLog: { action: "payout_reset", performedBy: req.user._id, timestamp: new Date() } } }
      );
    }
    const r = await payoutPayment(payment._id, payment.driverId, { companyId: payment.companyId });
    if (!r.success) return res.status(400).json({ success: false, message: r.error, requiresAction: r.requiresAction || null });
    res.status(200).json({ success: true, message: "Payout sent", data: r });
  } catch (error) {
    console.error("Retry payout error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
