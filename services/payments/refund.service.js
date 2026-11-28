// services/payments/refund.service.js
// Refunds are processed MANUALLY by the Riderr team.
//
// When a paid job is cancelled, the payment is marked "refund pending" with
// the amount owed back to the customer (the cancellation fee, if any, is kept).
// An admin then pays the customer back (from the Flutterwave dashboard for
// cards, or by bank transfer) and records it with
//   POST /api/admin/refunds/:paymentId/complete
// which marks the payment refunded and tells the customer.
//
// A payment with a pending refund is never paid out to a rider.
import Payment from "../../models/payments.models.js";
import Delivery from "../../models/delivery.models.js";
import { sendNotification } from "../../utils/notification.js";

export const OPEN_REFUND_STATUSES = ["pending", "processing"];

const naira = (n) => `₦${Math.round(n || 0).toLocaleString()}`;

/**
 * Mark a payment as waiting for a manual refund. Changes the document only;
 * the caller saves it (so it can be part of a transaction).
 * Returns the refund details, or { noRefundNeeded } when there is nothing to refund.
 */
export const markRefundPending = (payment, { amount, reason, cancellationFee = 0, requestedBy = null } = {}) => {
  if (payment.status === "refunded" || payment.refund?.status === "refunded") {
    return { alreadyRefunded: true, amount: payment.refund?.amount || 0 };
  }
  if (OPEN_REFUND_STATUSES.includes(payment.refund?.status)) {
    return { alreadyPending: true, amount: payment.refund.amount };
  }
  const refundAmount = Math.max(0, Math.min(payment.amount, Math.round(amount ?? payment.amount)));
  if (refundAmount === 0) return { noRefundNeeded: true, amount: 0 };

  payment.refund = {
    status: "pending",
    amount: refundAmount,
    cancellationFee,
    requestedAt: new Date(),
    requestedBy,
    reason
  };
  payment.markModified("refund");
  payment.auditLog.push({
    action: "refund_requested",
    timestamp: new Date(),
    details: { amount: refundAmount, cancellationFee, reason, mode: "manual" }
  });
  return { pending: true, amount: refundAmount };
};

/** What the customer is told while a refund waits for the team. */
export const pendingRefundMessage = (amount) =>
  `A refund of ${naira(amount)} has been requested. Our team will process it within ${
    process.env.REFUND_PROCESSING_TIME || "3 working days"
  }.`;

/**
 * An admin has paid the customer back: mark the refund done.
 * `amount` defaults to the requested amount.
 */
export const completeManualRefund = async (paymentId, { adminUserId, reference, note, amount } = {}) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) return { success: false, status: 404, error: "Payment not found" };
  if (payment.status === "refunded" || payment.refund?.status === "refunded") {
    return { success: false, status: 400, error: "This payment has already been refunded" };
  }
  if (payment.paymentMethod === "cash") {
    return { success: false, status: 400, error: "Cash payments are not refunded through the app" };
  }
  if (payment.status !== "successful") {
    return { success: false, status: 400, error: `Only successful payments can be refunded (this one is ${payment.status})` };
  }
  if (payment.escrowDetails?.settledToCompany) {
    return {
      success: false,
      status: 400,
      error: "This payment was already paid out to the rider/company. Recover it from them before refunding."
    };
  }

  const refundAmount = Math.round(amount ?? payment.refund?.amount ?? payment.amount);
  if (!(refundAmount > 0) || refundAmount > payment.amount) {
    return { success: false, status: 400, error: `Refund amount must be between 1 and ${payment.amount}` };
  }

  payment.refund = {
    ...(payment.refund?.toObject?.() || payment.refund || {}),
    status: "refunded",
    amount: refundAmount,
    refundedAt: new Date(),
    requestedAt: payment.refund?.requestedAt || new Date(),
    reason: payment.refund?.reason || note || "Refunded by admin",
    processedBy: adminUserId,
    reference: reference || undefined,
    note: note || undefined
  };
  payment.markModified("refund");
  payment.status = "refunded"; // also marks the ride's payment refunded (model hook)
  payment.auditLog.push({
    action: "refunded",
    timestamp: new Date(),
    performedBy: adminUserId,
    details: { amount: refundAmount, reference, note, mode: "manual" }
  });
  await payment.save();

  if (payment.deliveryId) {
    await Delivery.updateOne({ _id: payment.deliveryId }, { $set: { "payment.status": "refunded" } }).catch(() => {});
  }

  await sendNotification({
    userId: payment.customerId,
    type: "payment",
    title: "Refund sent",
    message: `Your refund of ${naira(refundAmount)} has been sent.${reference ? ` Reference: ${reference}.` : ""}`,
    data: { type: "refund_processed", paymentId: payment._id, amount: refundAmount, rideId: payment.rideId, deliveryId: payment.deliveryId }
  }).catch(() => {});

  return { success: true, payment };
};
