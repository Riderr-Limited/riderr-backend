// services/payments/payout.service.js
// Pays out the rider's share of an in-app (card/transfer) payment once the job
// is done. Riderr keeps its commission (payment.platformFee); the rest
// (payment.companyAmount) goes to:
//   - the rider's company, if they belong to one (Company.bankAccount), or
//   - the rider themself, for individual riders (Driver.bankDetails).
import mongoose from "mongoose";
import Payment from "../../models/payments.models.js";
import Company from "../../models/company.models.js";
import Driver from "../../models/riders.models.js";
import { initiateTransfer } from "../../utils/flutterwave.js";
import { reserveCommission, releaseCommission, allocateRecovered } from "./commission.service.js";

export const platformFeePercent = (kind = "delivery") => {
  const specific = kind === "ride" ? parseFloat(process.env.RIDE_PLATFORM_FEE_PERCENTAGE) : NaN;
  if (Number.isFinite(specific)) return specific;
  return parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 10;
};

/** Split an amount into Riderr's commission and the payee's share. */
export const splitAmount = (amount, kind = "delivery") => {
  const platformFee = Math.round((amount * platformFeePercent(kind)) / 100);
  return { platformFee, companyAmount: amount - platformFee };
};

/** Who gets paid for a job done by this rider, and their bank details. */
export const resolvePayee = async (driverOrId, { companyId } = {}) => {
  // An ObjectId also has an _id (pointing to itself), so check for a real
  // rider record before using it as one.
  const isDoc = driverOrId && typeof driverOrId === "object" && !(driverOrId instanceof mongoose.Types.ObjectId) && "userId" in driverOrId;
  const driver = isDoc ? driverOrId : driverOrId ? await Driver.findById(driverOrId) : null;
  if (!driver && !companyId) return { error: "Rider not found" };

  // A job that belongs to a company (e.g. a delivery the company accepted)
  // is paid to that company.
  const payCompanyId = companyId || driver?.companyId;
  if (payCompanyId) {
    const company = await Company.findById(payCompanyId?._id || payCompanyId);
    if (!company) return { error: "Company not found" };
    const b = company.bankAccount || {};
    if (!b.accountNumber || !b.bankCode || !b.accountName) {
      return { type: "company", id: company._id, name: company.name, error: "Company bank account is not set up" };
    }
    return { type: "company", id: company._id, name: company.name, bank: b };
  }

  const b = driver.bankDetails || {};
  if (!b.accountNumber || !b.bankCode || !b.accountName) {
    return { type: "driver", id: driver._id, error: "Rider has not added a bank account" };
  }
  if (!b.verified) {
    return { type: "driver", id: driver._id, error: "Rider's bank account is not verified" };
  }
  return { type: "driver", id: driver._id, bank: b };
};

/**
 * Transfer the payee's share for a successful in-app payment. Safe to call
 * more than once: only the first call moves money.
 * Returns { success, status, transferId, transferReference, error, requiresAction }.
 */
export const payoutPayment = async (paymentId, driverOrId, { companyId } = {}) => {
  // Claim the payout atomically so two calls can't both transfer.
  const payment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      status: "successful",
      paymentMethod: { $ne: "cash" },
      purpose: { $ne: "commission" },
      "escrowDetails.settledToCompany": { $ne: true },
      "metadata.payoutStatus": { $nin: ["processing", "paid"] },
      // Never pay out a payment that is being refunded to the customer.
      "refund.status": { $nin: ["pending", "processing", "refunded"] }
    },
    { $set: { "metadata.payoutStatus": "processing", "metadata.payoutStartedAt": new Date() } },
    { new: true }
  );
  if (!payment) return { success: false, skipped: true, error: "Not eligible for payout (unpaid, cash, or already paid out)" };

  const driverId = payment.driverId || (driverOrId instanceof mongoose.Types.ObjectId ? driverOrId : driverOrId?._id || driverOrId);
  let deducted = 0;

  const fail = async (error, requiresAction) => {
    if (deducted) await releaseCommission(driverId, deducted);
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: { "metadata.payoutStatus": "failed", "metadata.payoutError": error, "metadata.payoutRequiresAction": requiresAction || null },
        $push: { auditLog: { action: "payout_failed", timestamp: new Date(), details: { error } } }
      }
    );
    return { success: false, error, requiresAction };
  };

  const payee = await resolvePayee(driverOrId || payment.driverId, { companyId: companyId || payment.companyId });
  if (payee.error || !payee.bank) {
    return fail(payee.error || "No payee", payee.type === "driver" ? "rider_add_bank_account" : "company_add_bank_account");
  }

  // Take any commission the rider owes from cash jobs out of this payout.
  deducted = await reserveCommission(driverId, payment.companyAmount);
  const transferAmount = payment.companyAmount - deducted;

  const reference = `PAYOUT-${payment.paystackReference || payment._id}-${Date.now()}`;
  const job = payment.rideId ? `ride ${payment.rideId}` : `delivery ${payment.deliveryId}`;
  let result;
  if (transferAmount > 0) {
    result = await initiateTransfer({
      accountBank: payee.bank.bankCode,
      accountNumber: payee.bank.accountNumber,
      amount: transferAmount,
      beneficiaryName: payee.bank.accountName,
      reference,
      reason: `Riderr payout for ${job}`
    });
    if (!result.success) return fail(result.message || "Transfer failed");
  } else {
    // The whole share went to paying off cash commission: nothing to send.
    result = { success: true, data: { transferCode: null, reference: null, status: "not_needed" } };
  }
  if (deducted) await allocateRecovered(driverId, deducted, "payout", { payoutPaymentId: payment._id });

  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        "escrowDetails.settledToCompany": true,
        "escrowDetails.settlementDate": new Date(),
        "escrowDetails.paystackTransferId": result.data.transferCode,
        "metadata.payoutStatus": "paid",
        "metadata.payoutError": null,
        "metadata.settlementReference": result.data.reference,
        "metadata.settlementStatus": result.data.status,
        "metadata.payee": { type: payee.type, id: payee.id },
        "metadata.commissionDeducted": deducted,
        "metadata.amountTransferred": transferAmount
      },
      $push: {
        auditLog: {
          action: payee.type === "company" ? "settled_to_company" : "settled_to_driver",
          timestamp: new Date(),
          details: { transferId: result.data.transferCode, amount: transferAmount, commissionDeducted: deducted, payee: payee.type }
        }
      }
    }
  );

  return {
    success: true,
    status: result.data.status,
    transferId: result.data.transferCode,
    transferReference: result.data.reference,
    amount: transferAmount,
    commissionDeducted: deducted,
    settledAt: new Date(),
    payee: payee.type
  };
};
