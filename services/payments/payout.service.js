// services/payments/payout.service.js
// Pays out the rider's share of an in-app (card/transfer) payment once the job
// is done. Riderr keeps its commission (payment.platformFee); the rest
// (payment.companyAmount) goes to:
//   - the rider's company, if they belong to one (Company.bankAccount), or
//   - the rider themself, for individual riders (Driver.bankDetails).
import Payment from "../../models/payments.models.js";
import Company from "../../models/company.models.js";
import Driver from "../../models/riders.models.js";
import { initiateTransfer } from "../../utils/flutterwave.js";

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
export const resolvePayee = async (driverOrId) => {
  const driver = driverOrId?._id ? driverOrId : await Driver.findById(driverOrId);
  if (!driver) return { error: "Rider not found" };

  if (driver.companyId) {
    const company = await Company.findById(driver.companyId?._id || driver.companyId);
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
export const payoutPayment = async (paymentId, driverOrId) => {
  // Claim the payout atomically so two calls can't both transfer.
  const payment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      status: "successful",
      paymentMethod: { $ne: "cash" },
      "escrowDetails.settledToCompany": { $ne: true },
      "metadata.payoutStatus": { $nin: ["processing", "paid"] }
    },
    { $set: { "metadata.payoutStatus": "processing", "metadata.payoutStartedAt": new Date() } },
    { new: true }
  );
  if (!payment) return { success: false, skipped: true, error: "Not eligible for payout (unpaid, cash, or already paid out)" };

  const fail = async (error, requiresAction) => {
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: { "metadata.payoutStatus": "failed", "metadata.payoutError": error, "metadata.payoutRequiresAction": requiresAction || null },
        $push: { auditLog: { action: "payout_failed", timestamp: new Date(), details: { error } } }
      }
    );
    return { success: false, error, requiresAction };
  };

  const payee = await resolvePayee(driverOrId || payment.driverId);
  if (payee.error || !payee.bank) {
    return fail(payee.error || "No payee", payee.type === "driver" ? "rider_add_bank_account" : "company_add_bank_account");
  }

  const reference = `PAYOUT-${payment.paystackReference || payment._id}-${Date.now()}`;
  const job = payment.rideId ? `ride ${payment.rideId}` : `delivery ${payment.deliveryId}`;
  const result = await initiateTransfer({
    accountBank: payee.bank.bankCode,
    accountNumber: payee.bank.accountNumber,
    amount: payment.companyAmount,
    beneficiaryName: payee.bank.accountName,
    reference,
    reason: `Riderr payout for ${job}`
  });
  if (!result.success) return fail(result.message || "Transfer failed");

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
        "metadata.payee": { type: payee.type, id: payee.id }
      },
      $push: {
        auditLog: {
          action: payee.type === "company" ? "settled_to_company" : "settled_to_driver",
          timestamp: new Date(),
          details: { transferId: result.data.transferCode, amount: payment.companyAmount, payee: payee.type }
        }
      }
    }
  );

  return {
    success: true,
    status: result.data.status,
    transferId: result.data.transferCode,
    transferReference: result.data.reference,
    amount: payment.companyAmount,
    settledAt: new Date(),
    payee: payee.type
  };
};

/**
 * Transfer only: no database writes. For deliveries done by individual riders
 * (no company), called from completeAndSettlePayment() inside its transaction,
 * which records the result itself. Same result shape as settlePaymentToCompany().
 */
export const settlePaymentToDriver = async (payment, driverOrId) => {
  const payee = await resolvePayee(driverOrId);
  if (payee.error || !payee.bank) {
    return { success: false, error: payee.error || "No payee", requiresAction: "rider_add_bank_account" };
  }
  const result = await initiateTransfer({
    accountBank: payee.bank.bankCode,
    accountNumber: payee.bank.accountNumber,
    amount: payment.companyAmount,
    beneficiaryName: payee.bank.accountName,
    reference: `SETTLE-${payment.paystackReference || payment._id}-${Date.now()}`,
    reason: `Riderr payout for delivery ${payment.deliveryId}`
  });
  if (!result.success) return { success: false, error: result.message || "Transfer failed" };
  return {
    success: true,
    transferId: result.data.transferCode,
    transferReference: result.data.reference,
    amount: payment.companyAmount,
    settledAt: new Date(),
    status: result.data.status
  };
};
