// services/payments/ridePayment.service.js
// In-app payments for rides. The customer pays by card or bank transfer
// BEFORE the ride is sent to riders; Riderr keeps its commission and the
// rest is paid out to the rider (or their company) when the ride completes.
import crypto from "crypto";
import Payment from "../../models/payments.models.js";
import Ride from "../../models/ride.model.js";
import { refundPayment } from "../../controllers/payment.controller.js";
import { splitAmount, payoutPayment, platformFeePercent } from "./payout.service.js";

export const RIDE_PAYMENT_WINDOW_MINUTES = () => Number(process.env.RIDE_PAYMENT_WINDOW_MINUTES) || 10;

/** Which payment methods customers may choose for rides. */
export const allowedRidePaymentMethods = () => {
  const methods = ["card", "bank_transfer"];
  if (process.env.RIDE_ALLOW_CASH === "true") methods.push("cash");
  return methods;
};

/** "transfer" and "bank" are accepted as aliases for bank_transfer. */
export const normaliseRidePaymentMethod = (m) => {
  const v = String(m || "").toLowerCase();
  if (["transfer", "bank", "bank_transfer"].includes(v)) return "bank_transfer";
  return v;
};

/**
 * Card rides: create the pending Payment now; the app then charges the card
 * with POST /api/payments/charge-card { reference }.
 * Transfer rides: the app calls POST /api/payments/initiate-bank-transfer { rideId }.
 */
export const createRideCardPayment = async (ride, customer) => {
  const amount = ride.estimatedFare;
  const { platformFee, companyAmount } = splitAmount(amount, "ride");
  const reference = `RIDERR-RIDE-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const payment = await Payment.create({
    rideId: ride._id,
    customerId: customer._id,
    amount,
    currency: "NGN",
    gateway: "flutterwave",
    gatewayReference: reference,
    paystackReference: reference,
    status: "pending",
    paymentMethod: "card",
    companyAmount,
    platformFee,
    paymentType: "escrow",
    escrowDetails: { platformPercentage: platformFeePercent("ride") },
    metadata: { kind: "ride", customerEmail: customer.email, customerName: customer.name, platform: "in-app" }
  });
  await Ride.updateOne({ _id: ride._id }, { $set: { "payment.reference": reference } });
  return { paymentId: payment._id, reference, amount, breakdown: { total: amount, platformFee, riderReceives: companyAmount } };
};

export const findRidePayment = (rideId) =>
  Payment.findOne({ rideId, paymentMethod: { $ne: "cash" } }).sort({ createdAt: -1 });

/** Refund a ride's payment, optionally keeping a cancellation fee. */
export const refundRide = async (rideId, reason, keepAmount = 0) => {
  const payment = await Payment.findOne({ rideId, status: "successful", paymentMethod: { $ne: "cash" } });
  if (!payment) return { success: true, noRefundNeeded: true };
  const amount = Math.max(0, payment.amount - keepAmount);
  const result = await refundPayment(payment._id, reason, amount);
  return { ...result, refundAmount: amount };
};

/** Pay the rider/company their share for a completed, prepaid ride. */
export const payoutRide = async (rideId, driver) => {
  const payment = await Payment.findOne({ rideId, status: "successful", paymentMethod: { $ne: "cash" } });
  if (!payment) return { success: false, skipped: true, error: "No in-app payment for this ride" };
  if (driver && !payment.driverId) {
    await Payment.updateOne({ _id: payment._id }, { $set: { driverId: driver._id, companyId: driver.companyId || null } });
  }
  return payoutPayment(payment._id, driver);
};

/**
 * Cash rides (only if RIDE_ALLOW_CASH=true): the rider collects the whole
 * fare, so record the commission they owe Riderr.
 */
export const recordCashRideCommission = async (ride, driver) => {
  const exists = await Payment.exists({ rideId: ride._id, paymentMethod: "cash" });
  if (exists) return null;
  const amount = ride.actualFare || ride.estimatedFare;
  const { platformFee, companyAmount } = splitAmount(amount, "ride");
  return Payment.create({
    rideId: ride._id,
    customerId: ride.customerId,
    driverId: driver._id,
    companyId: driver.companyId || null,
    amount,
    currency: "NGN",
    status: "successful",
    paidAt: new Date(),
    paymentMethod: "cash",
    paymentType: "cash",
    companyAmount,
    platformFee,
    metadata: { kind: "ride", commissionOwed: platformFee, commissionStatus: "owed", collectedBy: "driver" }
  });
};
