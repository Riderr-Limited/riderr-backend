// services/payments/commission.service.js
// Riderr's commission on CASH jobs (deliveries and rides).
//
// With cash the rider collects the whole fare, so Riderr's commission is
// recorded as owed (Driver.commission.owed). The next time the rider is paid
// out for an in-app (card/transfer) job, what they owe is deducted from that
// payout first. An admin can also record a commission the rider paid directly.
//
// Each cash Payment keeps its own record in metadata:
//   commissionOwed     the commission for that job
//   commissionPaid     how much of it has been recovered so far
//   commissionStatus   "owed" | "partly_paid" | "paid"
import Payment from "../../models/payments.models.js";
import Driver from "../../models/riders.models.js";
import { splitAmount } from "./payout.service.js";
import { markRefundPending } from "./refund.service.js";
import { sendNotification } from "../../utils/notification.js";

const OPEN = ["owed", "partly_paid"];
const naira = (n) => `₦${Math.round(n || 0).toLocaleString()}`;

/**
 * Riders who owe more than this (in naira) can't go online or take jobs until
 * they pay. COMMISSION_OWED_LIMIT, default 5000. Set 0 to turn the limit off.
 */
export const commissionLimit = () => {
  const v = process.env.COMMISSION_OWED_LIMIT;
  if (v === undefined || v === "") return 5000;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const isOverCommissionLimit = (owed) => {
  const limit = commissionLimit();
  return limit > 0 && Math.round(owed || 0) > limit;
};

/**
 * Individual riders are paid straight to their own bank account, so they must
 * add (and verify) one before they can work. Company riders are paid through
 * their company. Returns null if OK, otherwise the 403 body to send.
 */
export const bankAccountBlock = (driver) => {
  // Same rule as KYC: only riders onboarded as individuals. (Checking
  // companyId alone misfires when the company is populated and missing.)
  if (!driver || driver.onboardingType !== "individual") return null;
  const b = driver.bankDetails || {};
  if (b.accountNumber && b.bankCode && b.verified) return null;
  return {
    success: false,
    code: "BANK_ACCOUNT_REQUIRED",
    message: "Add your bank account so we can pay you, then go online.",
    addBankAccountUrl: "/api/driver/bank-account"
  };
};

/** Filter for riders who can be paid: company riders, or individuals with a verified account. */
export const payableRiderFilter = () => ({
  $or: [{ onboardingType: { $ne: "individual" } }, { "bankDetails.verified": true }]
});

/** Single check used by go-online and accept endpoints. */
export const workBlock = (driver) => bankAccountBlock(driver) || commissionBlock(driver);

/** Mongo filter for riders still under the limit (used by dispatch). */
export const underCommissionLimitFilter = () => {
  const limit = commissionLimit();
  return limit > 0 ? { "commission.owed": { $not: { $gt: limit } } } : {};
};

/**
 * For go-online and accept endpoints: null if the rider may work, otherwise
 * the 403 body to send.
 */
export const commissionBlock = (driver) => {
  const owed = Math.round(driver?.commission?.owed || 0);
  if (!isOverCommissionLimit(owed)) return null;
  return {
    success: false,
    code: "COMMISSION_LIMIT_REACHED",
    message: `You owe ${naira(owed)} in commission from cash jobs, which is over the ${naira(commissionLimit())} limit. Pay it in the app to go back online.`,
    commission: { owed, limit: commissionLimit(), payUrl: "/api/driver/commission/pay" }
  };
};

/**
 * Record the commission on a cash payment as owed by its rider. Safe to call
 * more than once for the same payment: it is only charged once.
 * `payment` must be saved already. Pass `session` inside a transaction.
 */
export const recordCashCommission = async (paymentId, driverId, kind = "delivery", { session } = {}) => {
  const payment = await Payment.findById(paymentId).session(session || null);
  if (!payment || payment.paymentMethod !== "cash") return { charged: false, reason: "Not a cash payment" };
  if (payment.metadata?.commissionStatus) {
    return { charged: false, alreadyRecorded: true, commission: payment.metadata.commissionOwed || 0 };
  }

  const { platformFee, companyAmount } = splitAmount(payment.amount, kind);

  // Claim it atomically so two calls can't both charge the rider.
  const claimed = await Payment.updateOne(
    { _id: payment._id, "metadata.commissionStatus": { $exists: false } },
    {
      $set: {
        platformFee,
        companyAmount,
        paymentType: "cash",
        driverId,
        "metadata.commissionOwed": platformFee,
        "metadata.commissionPaid": 0,
        "metadata.commissionStatus": platformFee > 0 ? "owed" : "paid",
        "metadata.commissionRecordedAt": new Date(),
        "metadata.collectedBy": "driver"
      },
      $push: { auditLog: { action: "cash_commission_owed", timestamp: new Date(), details: { platformFee, driverId } } }
    },
    { session }
  );
  if (!claimed.modifiedCount) return { charged: false, alreadyRecorded: true };

  let overLimit = false;
  if (platformFee > 0) {
    const d = await Driver.findOneAndUpdate(
      { _id: driverId },
      {
        $inc: { "commission.owed": platformFee, "commission.totalCharged": platformFee },
        $set: { "commission.lastChargedAt": new Date() }
      },
      { session, new: true, projection: { commission: 1, userId: 1 } }
    );
    // Over the limit: take them offline until they pay.
    if (d && isOverCommissionLimit(d.commission?.owed)) {
      overLimit = true;
      await Driver.updateOne({ _id: driverId }, { $set: { isOnline: false, currentStatus: "offline" } }, { session });
      sendNotification({
        userId: d.userId,
        type: "payment",
        title: "Pay your commission to keep working",
        message: `You owe ${naira(d.commission.owed)} in commission from cash jobs. You've been taken offline until you pay it in the app.`,
        data: { type: "commission_limit_reached", owed: d.commission.owed, limit: commissionLimit() }
      }).catch(() => {});
    }
  }
  return { charged: true, commission: platformFee, overLimit };
};

/**
 * A cash delivery was delivered: the rider has collected the fare. Mark the
 * cash payment successful (creating it if needed) and charge the commission.
 * Safe to call more than once.
 */
export const recordCashDelivery = async (delivery, driver, { session } = {}) => {
  const driverId = driver?._id || driver;
  const companyId = driver?.companyId?._id || driver?.companyId || delivery.companyId || null;
  const amount = delivery.fare?.totalFare || 0;
  let payment = await Payment.findOne({ deliveryId: delivery._id, paymentMethod: "cash" }).session(session || null);
  if (!payment) {
    payment = new Payment({
      deliveryId: delivery._id,
      customerId: delivery.customerId?._id || delivery.customerId,
      amount,
      currency: "NGN",
      status: "pending",
      paymentMethod: "cash",
      paymentType: "cash",
      ...splitAmount(amount, "delivery"),
      metadata: {}
    });
  }
  if (payment.status !== "successful") {
    payment.status = "successful";
    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    payment.driverId = driverId;
    payment.companyId = companyId;
    payment.metadata = { ...(payment.metadata || {}), cashCollectedAt: new Date(), collectedByDriverId: driverId };
    payment.markModified("metadata");
    await payment.save({ session });
  }
  const commission = await recordCashCommission(payment._id, driverId, "delivery", { session });
  return { paymentId: payment._id, ...commission };
};

/**
 * Take up to `maxAmount` of what the rider owes, for deduction from a payout.
 * Atomic, so two payouts at once can't both deduct the same debt.
 * Returns the amount taken (0 if nothing is owed).
 */
export const reserveCommission = async (driverId, maxAmount, { session } = {}) => {
  if (!driverId || !(maxAmount > 0)) return 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const d = await Driver.findById(driverId).select("commission").session(session || null).lean();
    const owed = Math.max(0, Math.round(d?.commission?.owed || 0));
    const take = Math.min(owed, Math.round(maxAmount));
    if (take <= 0) return 0;
    const r = await Driver.updateOne(
      { _id: driverId, "commission.owed": d.commission.owed },
      {
        $inc: { "commission.owed": -take, "commission.totalDeducted": take },
        $set: { "commission.lastDeductedAt": new Date() }
      },
      { session }
    );
    if (r.modifiedCount) return take;
  }
  return 0; // too much contention: skip the deduction this time rather than block the payout
};

/** Give back a reservation when the payout it was for didn't go through. */
export const releaseCommission = async (driverId, amount, { session } = {}) => {
  if (!driverId || !(amount > 0)) return;
  await Driver.updateOne(
    { _id: driverId },
    { $inc: { "commission.owed": amount, "commission.totalDeducted": -amount } },
    { session }
  );
};

/**
 * Mark `amount` as recovered on the rider's oldest open cash payments.
 * `via` is "payout" (deducted from an in-app payout) or "manual" (admin).
 */
export const allocateRecovered = async (driverId, amount, via, details = {}, { session } = {}) => {
  let left = Math.round(amount);
  if (left <= 0) return [];
  const open = await Payment.find({ driverId, paymentMethod: "cash", "metadata.commissionStatus": { $in: OPEN } })
    .sort({ createdAt: 1 })
    .session(session || null);
  const touched = [];
  for (const p of open) {
    if (left <= 0) break;
    const owed = p.metadata.commissionOwed || 0;
    const paid = p.metadata.commissionPaid || 0;
    const portion = Math.min(owed - paid, left);
    if (portion <= 0) continue;
    left -= portion;
    const newPaid = paid + portion;
    await Payment.updateOne(
      { _id: p._id },
      {
        $set: {
          "metadata.commissionPaid": newPaid,
          "metadata.commissionStatus": newPaid >= owed ? "paid" : "partly_paid",
          ...(newPaid >= owed ? { "metadata.commissionPaidAt": new Date() } : {})
        },
        $push: { auditLog: { action: "cash_commission_recovered", timestamp: new Date(), details: { amount: portion, via, ...details } } }
      },
      { session }
    );
    touched.push({ paymentId: p._id, amount: portion });
  }
  return touched;
};

/**
 * An admin records commission the rider paid Riderr directly (e.g. by bank
 * transfer), reducing what they owe.
 */
export const settleCommissionManually = async (driverId, amount, adminUserId, note) => {
  const take = await reserveCommission(driverId, amount);
  if (take <= 0) return { success: false, error: "This rider doesn't owe any commission" };
  // reserveCommission counted it as deducted from a payout; move it to "manual".
  await Driver.updateOne(
    { _id: driverId },
    { $inc: { "commission.totalDeducted": -take, "commission.totalSettledManually": take } }
  );
  const allocations = await allocateRecovered(driverId, take, "manual", { by: adminUserId, note });
  return { success: true, amount: take, allocations };
};

/** What a rider owes and the cash jobs it comes from. */
export const getCommissionSummary = async (driverId) => {
  const driver = await Driver.findById(driverId).select("commission").lean();
  const open = await Payment.find({ driverId, paymentMethod: "cash", "metadata.commissionStatus": { $in: OPEN } })
    .sort({ createdAt: 1 })
    .select("amount deliveryId rideId createdAt metadata.commissionOwed metadata.commissionPaid metadata.commissionStatus")
    .lean();
  const owed = Math.round(driver?.commission?.owed || 0);
  return {
    owed,
    limit: commissionLimit(),
    overLimit: isOverCommissionLimit(owed),
    totalPaidByRider: driver?.commission?.totalPaidByRider || 0,
    totalCharged: driver?.commission?.totalCharged || 0,
    totalDeducted: driver?.commission?.totalDeducted || 0,
    totalSettledManually: driver?.commission?.totalSettledManually || 0,
    openJobs: open.map((p) => ({
      paymentId: p._id,
      job: p.rideId ? { type: "ride", id: p.rideId } : { type: "delivery", id: p.deliveryId },
      fare: p.amount,
      commission: p.metadata?.commissionOwed || 0,
      recovered: p.metadata?.commissionPaid || 0,
      status: p.metadata?.commissionStatus,
      date: p.createdAt
    }))
  };
};

/**
 * A rider's own commission payment (card or transfer) succeeded: reduce what
 * they owe. Runs once per payment (called from the Payment model hook, so it
 * works for every way a payment can be confirmed). If they paid more than
 * they now owe (e.g. a payout deduction cleared it meanwhile), the extra goes
 * to the manual refund queue.
 */
export const applyCommissionPayment = async (paymentId) => {
  const claimed = await Payment.findOneAndUpdate(
    { _id: paymentId, purpose: "commission", status: "successful", "metadata.commissionApplied": { $ne: true } },
    { $set: { "metadata.commissionApplied": true, "metadata.commissionAppliedAt": new Date() } },
    { new: true }
  );
  if (!claimed) return { applied: false };

  const driverId = claimed.driverId;
  const take = await reserveCommission(driverId, claimed.amount);
  if (take > 0) {
    // reserveCommission counted it as a payout deduction; it was paid by the rider.
    await Driver.updateOne(
      { _id: driverId },
      { $inc: { "commission.totalDeducted": -take, "commission.totalPaidByRider": take } }
    );
    await allocateRecovered(driverId, take, "rider_payment", { paymentId: claimed._id });
  }
  const surplus = claimed.amount - take;
  if (surplus > 0) {
    const p = await Payment.findById(claimed._id);
    markRefundPending(p, { amount: surplus, reason: "Rider paid more commission than they owed" });
    await p.save();
  }
  await Payment.updateOne({ _id: claimed._id }, { $set: { "metadata.commissionCleared": take, "metadata.commissionSurplus": surplus } });

  const d = await Driver.findById(driverId).select("commission userId").lean();
  sendNotification({
    userId: d.userId,
    type: "payment",
    title: "Commission payment received",
    message: `We received ${naira(take)}. You now owe ${naira(d.commission?.owed)}.${
      isOverCommissionLimit(d.commission?.owed) ? "" : " You can go online."
    }${surplus > 0 ? ` The extra ${naira(surplus)} will be refunded to you.` : ""}`,
    data: { type: "commission_paid", amount: take, owed: d.commission?.owed || 0 }
  }).catch(() => {});
  return { applied: true, amount: take, surplus, owed: d.commission?.owed || 0 };
};
