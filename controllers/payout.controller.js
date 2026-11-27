// controllers/payout.controller.js
// Riders' payout bank account. Individual riders are paid here for card and
// transfer jobs; company riders are paid through their company instead.
import Driver from "../models/riders.models.js";
import { resolveAccountNumber } from "../utils/flutterwave.js";
import { nameMatchScore } from "../services/kyc/kyc.service.js";
import Payment from "../models/payments.models.js";
import { payoutPayment } from "../services/payments/payout.service.js";

const mask = (n) => (n ? `******${String(n).slice(-4)}` : null);

/**
 * @route  GET /api/driver/bank-account
 */
export const getMyBankAccount = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id }).select("bankDetails companyId onboardingType");
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });
    const b = driver.bankDetails || {};
    res.status(200).json({
      success: true,
      data: {
        paidVia: driver.companyId ? "company" : "own_account",
        bankAccount: b.accountNumber
          ? { bankName: b.bankName, bankCode: b.bankCode, accountName: b.accountName, accountNumber: mask(b.accountNumber), verified: !!b.verified }
          : null
      }
    });
  } catch (error) {
    console.error("Get bank account error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  PUT /api/driver/bank-account
 * @body   { bankCode, accountNumber, bankName }
 * Looks the account up with Flutterwave. The account name must match the
 * rider's name (as verified against their NIN), so money can't be redirected
 * to someone else's account.
 */
export const setMyBankAccount = async (req, res) => {
  try {
    const { bankCode, accountNumber, bankName } = req.body || {};
    if (!bankCode || !/^\d{10}$/.test(String(accountNumber || ""))) {
      return res.status(400).json({ success: false, message: "bankCode and a 10-digit accountNumber are required" });
    }

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ success: false, message: "Driver profile not found" });

    const lookup = await resolveAccountNumber(String(accountNumber), String(bankCode));
    if (!lookup?.success || !lookup.data?.accountName) {
      return res.status(400).json({ success: false, message: "We couldn't verify that account. Check the bank and account number." });
    }
    const accountName = lookup.data.accountName;

    // Compare with the NIN name for individuals (most reliable), else the account name.
    const ninName = driver.kyc?.nin?.providerName;
    const reference =
      ninName?.firstName || ninName?.lastName
        ? `${ninName.firstName || ""} ${ninName.middleName || ""} ${ninName.lastName || ""}`
        : req.user.name;
    const parts = String(accountName).trim().split(/\s+/);
    const score = nameMatchScore(reference, {
      firstName: parts[0],
      middleName: parts.slice(1, -1).join(" "),
      lastName: parts.length > 1 ? parts[parts.length - 1] : ""
    });
    if (score < 1) {
      return res.status(400).json({
        success: false,
        message: `This account belongs to "${accountName}". Payouts can only go to an account in your own name.`,
        code: "ACCOUNT_NAME_MISMATCH"
      });
    }

    driver.bankDetails = { accountName, accountNumber: String(accountNumber), bankName: bankName || "", bankCode: String(bankCode), verified: true };
    await driver.save();

    // Pay out anything that was waiting for a bank account.
    let paidOut = 0;
    let paidOutAmount = 0;
    if (!driver.companyId) {
      const waiting = await Payment.find({
        driverId: driver._id,
        status: "successful",
        paymentMethod: { $ne: "cash" },
        "escrowDetails.settledToCompany": { $ne: true },
        "metadata.payoutStatus": "failed"
      }).select("_id");
      for (const p of waiting) {
        const r = await payoutPayment(p._id, driver);
        if (r.success) {
          paidOut++;
          paidOutAmount += r.amount || 0;
        }
      }
    }

    res.status(200).json({
      success: true,
      message: paidOut ? `Bank account saved. ${paidOut} pending payout(s) sent.` : "Bank account saved",
      data: {
        bankName: bankName || "",
        bankCode,
        accountName,
        accountNumber: mask(accountNumber),
        verified: true,
        pendingPayoutsSent: paidOut,
        pendingPayoutsAmount: paidOutAmount
      }
    });
  } catch (error) {
    console.error("Set bank account error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
