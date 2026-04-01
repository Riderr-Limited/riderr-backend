// controllers/payment.controller.js - MOBILE-FIRST PAYMENT FLOW
import Payment from "../models/payments.models.js";
import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import Company from "../models/company.models.js";
import User from "../models/user.models.js";
import {
  gatewayChargeCard,
  gatewaySubmitOtp,
  gatewaySubmitPin,
  createDedicatedVirtualAccount,
  getGatewayProvider,
  verifyPayment,
  initiateTransfer,
  createTransferRecipient,
  initiateRefund,
  getBankList,
  verifyWebhookSignature,
} from "../utils/paymentGateway.js";
import { sendNotification } from "../utils/notification.js";
import mongoose from "mongoose";
import crypto from "crypto";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PLATFORM_FEE_PCT = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 10;

/**
 * MOBILE-FIRST PAYMENT FLOW
 *
 * Single initialize endpoint handles:
 * - Card & transfer payment methods
 * - Inline card charging (no separate endpoints)
 * - Consistent response format
 * - Clear next-step instructions for mobile UX
 */

/**
 * Helper: Generate bank transfer details with priority handling
 */
async function generateBankTransferDetails(
  customer,
  delivery,
  amount,
  reference,
) {
  try {
    console.log(
      `ðŸ’³ Generating bank transfer details for ${reference} (${IS_PRODUCTION ? "LIVE" : "TEST"})`,
    );

    let bankDetails = null;
    let paymentMethod = "bank_transfer";
    let priority = "medium";

    // Priority 1: Try Paystack dedicated virtual account (instant verification)
    try {
      console.log("ðŸ”„ Attempting Paystack dedicated virtual account...");
      const accountData = await createDedicatedVirtualAccount({
        email: customer.email,
        first_name: customer.name.split(" ")[0] || customer.name,
        last_name: customer.name.split(" ")[1] || customer.name,
        phone: customer.phone,
        preferred_bank: "wema-bank",
        amount: amount,
        metadata: {
          deliveryId: delivery._id.toString(),
          reference: reference,
          amount: amount,
        },
      });

      if (accountData && accountData.success && accountData.data) {
        const account = accountData.data;
        bankDetails = {
          type: "dedicated_virtual",
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          reference: reference,
          amount: amount,
          formatted: `â‚¦${amount.toLocaleString()}`,
          narration: "Not required",
          expiresAt: null,
        };
        paymentMethod = "bank_transfer_dedicated";
        priority = "high";
        console.log(
          `âœ… Dedicated virtual account created: ${account.accountNumber}`,
        );
      }
    } catch (err) {
      console.warn("âš ï¸ Dedicated account failed:", err.message);
    }

    // Priority 2: Use company bank account
    if (!bankDetails && delivery.companyId?.bankAccount?.accountNumber) {
      console.log("ðŸ’¼ Using company bank account");
      bankDetails = {
        type: "company_account",
        bankName: delivery.companyId.bankAccount.bankName || "Company Bank",
        accountNumber: delivery.companyId.bankAccount.accountNumber,
        accountName:
          delivery.companyId.bankAccount.accountName || delivery.companyId.name,
        reference: reference,
        amount: amount,
        formatted: `â‚¦${amount.toLocaleString()}`,
        narration: `Riderr-${reference}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      paymentMethod = "company_bank_transfer";
      priority = "medium";
    }

    // Priority 3: Use platform account (always succeeds)
    if (!bankDetails) {
      console.log("🔧 Using platform fallback account");
      bankDetails = {
        type: "platform_account",
        bankName: process.env.PLATFORM_BANK_NAME || "Zenith Bank",
        accountNumber: process.env.PLATFORM_ACCOUNT_NUMBER || "1012345678",
        accountName: process.env.PLATFORM_ACCOUNT_NAME || "RIDERR TECHNOLOGIES LTD",
        reference: reference,
        amount: amount,
        formatted: `₦${amount.toLocaleString()}`,
        narration: `Riderr-${reference}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
      paymentMethod = "manual_bank_transfer";
      priority = "low";
    }

    return { bankDetails, paymentMethod, priority };
  } catch (error) {
    console.error("âŒ Bank transfer generation error:", error);
    throw error;
  }
}

/**
 * @desc    UNIFIED: Initialize payment (card or transfer, single endpoint)
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 * @mobile  Optimized for mobile consumption
 *
 * Request body:
 * {
 *   deliveryId: "xyz",
 *   paymentType: "card" | "transfer",
 *   cardDetails?: { number, cvv, expiry_month, expiry_year, pin? }
 * }
 *
 * Response: Unified format for both payment types
 */
export const initializeDeliveryPayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, paymentType, cardDetails } = req.body;

    // Validate customer role
    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can make payments",
        code: "INVALID_ROLE",
      });
    }

    // Validate payment type
    if (!paymentType || !["card", "transfer"].includes(paymentType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment type",
        code: "INVALID_PAYMENT_TYPE",
        supportedTypes: ["card", "transfer"],
      });
    }

    console.log(
      `ðŸ’³ [PAYMENT INIT] Customer: ${customer._id}, Delivery: ${deliveryId}, Type: ${paymentType}`,
    );

    // Find and validate delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    }).populate("companyId");

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
        code: "DELIVERY_NOT_FOUND",
      });
    }

    // Payment allowed on created (before assignment) or assigned (rider accepted, awaiting payment)
    if (!["created", "assigned"].includes(delivery.status)) {
      return res.status(400).json({
        success: false,
        message: "Payment can only be made for pending or assigned deliveries",
        code: "INVALID_DELIVERY_STATUS",
        currentStatus: delivery.status,
      });
    }

    // Check for existing active payment
    const existingPayment = await Payment.findOne({
      deliveryId: delivery._id,
      status: { $in: ["successful", "processing", "pending"] },
    });

    if (existingPayment && paymentType === "transfer") {
      // Already has bank details — reuse them
      if (
        existingPayment.paymentMethod === "bank_transfer_dedicated" ||
        existingPayment.metadata?.bankTransferDetails
      ) {
        return res.status(200).json({
          success: true,
          message: "Using existing transfer details",
          code: "TRANSFER_REUSED",
          data: formatTransferResponse(existingPayment, delivery),
        });
      }

      // Has pending payment but no bank details yet — generate virtual account now
      try {
        const { bankDetails, paymentMethod: pm } = await generateBankTransferDetails(
          customer,
          delivery,
          existingPayment.amount,
          existingPayment.paystackReference,
        );

        existingPayment.paymentMethod = pm;
        existingPayment.metadata = {
          ...existingPayment.metadata,
          bankTransferDetails: bankDetails,
          platform: "in-app",
        };
        existingPayment.markModified("metadata");
        await existingPayment.save();

        delivery.payment.method = "transfer";
        delivery.payment.reference = existingPayment.paystackReference;
        await delivery.save();

        return res.status(200).json({
          success: true,
          message: "Bank transfer details ready",
          data: formatTransferResponse(existingPayment, delivery),
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: err.message || "Failed to generate bank transfer details",
          code: "TRANSFER_INIT_ERROR",
        });
      }
    }

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already initialized for this delivery",
        code: "PAYMENT_EXISTS",
        paymentId: existingPayment._id,
      });
    }

    // Calculate amounts
    const totalAmount = delivery.fare.totalFare;
    const platformFee = Math.round((totalAmount * PLATFORM_FEE_PCT) / 100);
    const companyAmount = totalAmount - platformFee;
    const reference = generatePaymentReference();

    console.log(
      `ðŸ’° Amounts: Total=â‚¦${totalAmount}, Platform=â‚¦${platformFee} (10%), Company=â‚¦${companyAmount} (90%)`,
    );

    // Route based on payment type
    if (paymentType === "transfer") {
      return handleTransferInitialization(req, res, {
        customer,
        delivery,
        totalAmount,
        platformFee,
        companyAmount,
        reference,
      });
    } else {
      // Card: inline charge immediately for mobile UX
      return handleCardChargeInline(req, res, {
        customer,
        delivery,
        totalAmount,
        platformFee,
        companyAmount,
        reference,
        cardDetails,
      });
    }
  } catch (error) {
    console.error("âŒ Initialize payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize payment",
      code: "INIT_ERROR",
      error: IS_PRODUCTION ? undefined : error.message,
    });
  }
};

/**
 * Handle transfer payment initialization
 */
async function handleTransferInitialization(
  req,
  res,
  { customer, delivery, totalAmount, platformFee, companyAmount, reference },
) {
  try {
    const { bankDetails, paymentMethod, priority } =
      await generateBankTransferDetails(
        customer,
        delivery,
        totalAmount,
        reference,
      );

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      companyId: delivery.companyId?._id,
      amount: totalAmount,
      currency: "NGN",
      gateway: getGatewayProvider(),
      gatewayReference: reference,
      paystackReference: reference,
      status: "pending",
      paymentMethod: paymentMethod,
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: "escrow",
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        bankTransferDetails: bankDetails,
        platform: "in-app",
        paymentPriority: priority,
      },
    });

    await payment.save();

    // Update delivery
    delivery.payment.status = "pending_payment";
    delivery.payment.method = "transfer";
    delivery.payment.reference = reference;
    await delivery.save();

    console.log(`âœ… Transfer initialized - Reference: ${reference}`);

    return res.status(200).json({
      success: true,
      message: "Bank transfer details ready",
      data: formatTransferResponse(payment, delivery),
    });
  } catch (error) {
    console.error("âŒ Transfer initialization error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate transfer details",
      code: "TRANSFER_INIT_ERROR",
      fallback: "Please try card payment instead",
      error: IS_PRODUCTION ? undefined : error.message,
    });
  }
}

/**
 * Handle card payment - inline charge for mobile
 */
async function handleCardChargeInline(
  req,
  res,
  {
    customer,
    delivery,
    totalAmount,
    platformFee,
    companyAmount,
    reference,
    cardDetails,
  },
) {
  try {
    // Validate card details
    if (!cardDetails) {
      // If no card details, return error asking for card
      const payment = new Payment({
        deliveryId: delivery._id,
        customerId: customer._id,
        companyId: delivery.companyId?._id,
        amount: totalAmount,
        currency: "NGN",
        gateway: getGatewayProvider(),
        gatewayReference: reference,
        paystackReference: reference,
        status: "pending",
        paymentMethod: "card",
        companyAmount: companyAmount,
        platformFee: platformFee,
        paymentType: "escrow",
        metadata: {
          customerEmail: customer.email,
          customerName: customer.name,
          platform: "in-app",
        },
      });
      await payment.save();

      delivery.payment.status = "pending_payment";
      delivery.payment.method = "card";
      delivery.payment.reference = reference;
      await delivery.save();

      return res.status(200).json({
        success: true,
        message: "Ready for card payment",
        code: "CARD_AWAITING_DETAILS",
        requiresCardDetails: true,
        data: {
          paymentId: payment._id,
          reference: reference,
          amount: totalAmount,
          amountFormatted: `â‚¦${totalAmount.toLocaleString()}`,
          paymentType: "card",
          status: "pending_card_details",
          breakdown: {
            total: totalAmount,
            platformFee: platformFee,
            companyAmount: companyAmount,
          },
        },
      });
    }

    // Validate card fields
    if (
      !cardDetails.number ||
      !cardDetails.cvv ||
      !cardDetails.expiry_month ||
      !cardDetails.expiry_year
    ) {
      return res.status(400).json({
        success: false,
        message: "Complete card details required",
        code: "CARD_DETAILS_INCOMPLETE",
        requiredFields: ["number", "cvv", "expiry_month", "expiry_year"],
      });
    }

    console.log(
      `ðŸ’³ Charging card - Reference: ${reference}, Amount: â‚¦${totalAmount}`,
    );

    // Create payment record first
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      companyId: delivery.companyId?._id,
      amount: totalAmount,
      currency: "NGN",
      gateway: getGatewayProvider(),
      gatewayReference: reference,
      paystackReference: reference,
      status: "processing",
      paymentMethod: "card",
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: "escrow",
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        platform: "in-app",
      },
    });

    await payment.save();

    // Attempt card charge
    const chargeResult = await gatewayChargeCard({
      email: customer.email,
      amount: totalAmount,
      currency: "NGN",
      card: {
        number: cardDetails.number,
        cvv: cardDetails.cvv,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        pin: cardDetails.pin || null,
      },
      metadata: {
        deliveryId: delivery._id.toString(),
        customerId: customer._id.toString(),
        reference: reference,
      },
    });

    // Handle charge response
    const chargeData = chargeResult.data;

    // OTP Required
    if (chargeData.status === "send_otp") {
      payment.status = "processing";
      payment.metadata = {
        ...payment.metadata,
        requiresOtp: true,
        cardLast4: cardDetails.number.slice(-4),
        chargeReference: chargeResult.paystackReference || reference,
      };
      payment.markModified("metadata");
      await payment.save();

      return res.status(200).json({
        success: true,
        message: "OTP sent to your registered phone",
        code: "CARD_OTP_REQUIRED",
        data: {
          paymentId: payment._id,
          reference: reference,
          amount: totalAmount,
          status: "pending_otp",
          nextAction: "submit_otp",
          otpMessage: chargeData.display_text || "Enter OTP",
        },
      });
    }

    // PIN Required
    if (chargeData.status === "send_pin") {
      payment.status = "processing";
      payment.metadata = {
        ...payment.metadata,
        requiresPin: true,
        cardLast4: cardDetails.number.slice(-4),
        chargeReference: chargeResult.paystackReference || reference,
      };
      payment.markModified("metadata");
      await payment.save();

      return res.status(200).json({
        success: true,
        message: "Card requires PIN",
        code: "CARD_PIN_REQUIRED",
        data: {
          paymentId: payment._id,
          reference: reference,
          amount: totalAmount,
          status: "pending_pin",
          nextAction: "submit_pin",
        },
      });
    }

    // Charge successful
    if (chargeData.status === "success") {
      payment.status = "successful";
      payment.paidAt = new Date();
      payment.verifiedAt = new Date();
      payment.metadata = {
        ...payment.metadata,
        cardLast4: cardDetails.number.slice(-4),
        cardType: chargeData.authorization?.card_type,
        bank: chargeData.authorization?.bank,
        chargeId: chargeData.id,
      };
      await payment.save();

      // Update delivery
      delivery.payment.status = "paid";
      delivery.payment.paidAt = new Date();
      await delivery.save();

      // Send notification
      await sendNotification({
        userId: customer._id,
        title: "âœ… Payment Successful",
        message: `Payment of â‚¦${totalAmount.toLocaleString()} confirmed`,
        data: {
          type: "payment_success",
          deliveryId: delivery._id,
          paymentId: payment._id,
        },
      });

      console.log(`âœ… Card payment successful - Reference: ${reference}`);

      return res.status(200).json({
        success: true,
        message: "Payment successful!",
        code: "PAYMENT_SUCCESSFUL",
        data: formatPaymentSuccessResponse(payment, delivery),
      });
    }

    // Charge declined or error
    if (chargeData.status === "failed" || !chargeResult.success) {
      payment.status = "failed";
      payment.metadata = {
        ...payment.metadata,
        failureReason: chargeResult.message || "Card declined",
        cardLast4: cardDetails.number.slice(-4),
      };
      await payment.save();

      return res.status(400).json({
        success: false,
        message: chargeResult.message || "Card charge failed",
        code: "CARD_CHARGE_FAILED",
        data: {
          paymentId: payment._id,
          reference: reference,
          reason:
            chargeData.status === "failed"
              ? chargeData.message || "Card declined"
              : chargeResult.message,
        },
      });
    }

    // Unexpected status
    throw new Error(`Unexpected charge status: ${chargeData.status}`);
  } catch (error) {
    console.error("âŒ Card charge error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process card payment",
      code: "CARD_CHARGE_ERROR",
      error: IS_PRODUCTION ? undefined : error.message,
    });
  }
}

/**
 * @desc    Charge card with card details
 * @route   POST /api/payments/charge-card
 * @access  Private (Customer)
 */
export const chargeCard = async (req, res) => {
  try {
    const customer = req.user;
    const { reference, cardDetails } = req.body;

    console.log(
      `ðŸ’³ Customer ${customer._id} charging card for ${reference} (${IS_PRODUCTION ? "LIVE" : "TEST"})`,
    );

    if (!reference) {
      return res.status(400).json({
        success: false,
        message:
          "Payment reference is required. Call /api/payments/initialize first.",
      });
    }

    // Validate card details
    if (
      !cardDetails ||
      !cardDetails.number ||
      !cardDetails.cvv ||
      !cardDetails.expiry_month ||
      !cardDetails.expiry_year
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Complete card details required (number, cvv, expiry_month, expiry_year)",
        example: {
          number: "5061010000000000043",
          cvv: "123",
          expiry_month: "12",
          expiry_year: "25",
          pin: "1234", // Optional, for Nigerian cards
        },
      });
    }

    // Find payment
    const payment = await Payment.findOne({
      paystackReference: reference,
      customerId: customer._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found. Initialize payment first.",
      });
    }

    if (payment.status === "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment already completed",
      });
    }

    const amount = payment.amount;

    // âœ… Always use real charge (works in both test and live)
    try {
      const chargeResult = await gatewayChargeCard({
        email: customer.email,
        amount: amount,
        currency: "NGN",
        card: {
          number: cardDetails.number,
          cvv: cardDetails.cvv,
          expiry_month: cardDetails.expiry_month,
          expiry_year: cardDetails.expiry_year,
          pin: cardDetails.pin || null,
        },
        metadata: {
          deliveryId: payment.deliveryId.toString(),
          customerId: customer._id.toString(),
          reference: reference,
          environment: IS_PRODUCTION ? "production" : "development",
        },
      });

      if (!chargeResult.success) {
        return res.status(400).json({
          success: false,
          message: chargeResult.message || "Card charge failed",
          error: chargeResult.error,
        });
      }

      const chargeData = chargeResult.data;

      // Handle OTP requirement

      if (chargeData.status === "send_otp") {
        // âœ… FIX: Use chargeResult.paystackReference, not chargeData.reference.
        // chargeData is response.data.data â€” reference may not be in there.
        // We now return it explicitly from chargeCardViaPaystack.
        const paystackRef = chargeResult.paystackReference;

        console.log("ðŸ” OTP required");
        console.log("   Internal ref  :", reference);
        console.log("   Paystack ref  :", paystackRef);

        if (!paystackRef) {
          // Safety net: if we still can't get Paystack's reference, log the
          // full chargeResult so you can see what came back
          console.error(
            "âŒ CRITICAL: paystackReference is undefined. Full chargeResult:",
          );
          console.error(JSON.stringify(chargeResult, null, 2));
        }

        payment.status = "processing";
        payment.metadata = {
          ...payment.metadata,
          requiresOtp: true,
          requiresPin: false,
          cardLast4: cardDetails.number.slice(-4),
          chargeReference: paystackRef || reference, // fallback to internal ref
        };
        payment.markModified("metadata");
        await payment.save();

        return res.status(200).json({
          success: true,
          requiresOtp: true,
          message: "OTP sent to your phone number",
          data: {
            paymentId: payment._id,
            reference: reference,
            amount: payment.amount,
            displayMessage:
              chargeData.display_text ||
              "Please enter the OTP sent to your phone",
          },
        });
      }

      // Handle PIN requirement
      if (chargeData.status === "send_pin") {
        const paystackRef = chargeResult.paystackReference;

        console.log("ðŸ” PIN required | Paystack ref:", paystackRef);

        payment.status = "processing";
        payment.metadata = {
          ...payment.metadata,
          requiresPin: true,
          requiresOtp: false,
          cardLast4: cardDetails.number.slice(-4),
          chargeReference: paystackRef || reference,
        };
        payment.markModified("metadata");
        await payment.save();

        return res.status(200).json({
          success: true,
          requiresPin: true,
          message: "Card requires PIN",
          data: {
            paymentId: payment._id,
            reference: reference,
            amount: payment.amount,
            displayMessage: "Please enter your card PIN",
          },
        });
      }

      if (chargeData.status === "success") {
        payment.status = "successful";
        payment.paidAt = new Date();
        payment.verifiedAt = new Date();
        payment.webhookData = chargeData;
        payment.metadata = {
          ...payment.metadata,
          cardLast4: cardDetails.number.slice(-4),
          cardType:
            chargeData.authorization?.card_type || chargeData.card?.type,
          bank: chargeData.authorization?.bank || chargeData.card?.issuer,
          escrowStatus: "held",
          escrowHeldAt: new Date(),
          flwRef: chargeData.flw_ref,
        };
        payment.markModified("metadata");
        await payment.save();

        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery) {
          delivery.payment.status = "paid";
          delivery.payment.paidAt = new Date();
          await delivery.save();
        }

        await sendNotification({
          userId: customer._id,
          title: "âœ… Payment Successful",
          message: `Your payment of â‚¦${payment.amount.toLocaleString()} is confirmed. Finding a driver for you...`,
          data: {
            type: "payment_successful",
            deliveryId: payment.deliveryId,
            paymentId: payment._id,
            amount: payment.amount,
          },
        });

        return res.status(200).json({
          success: true,
          requiresOtp: false,
          message: "Payment successful!",
          data: {
            paymentId: payment._id,
            reference: reference,
            amount: payment.amount,
            deliveryId: payment.deliveryId,
          },
        });
      }

      return res.status(400).json({
        success: false,
        message: `Unexpected payment status: ${chargeData.status}`,
      });
    } catch (chargeError) {
      console.error("âŒ Paystack charge error:", chargeError);
      return res.status(500).json({
        success: false,
        message: "Failed to process card payment",
        error: IS_PRODUCTION ? undefined : chargeError.message,
      });
    }
  } catch (error) {
    console.error("âŒ Charge card error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process card payment",
      error: IS_PRODUCTION ? undefined : error.message,
    });
  }
};

/**
 * Helper: Handle in-app bank transfer (NO CHECKOUT URL)
 */

/**
 * @desc    Verify bank transfer manually (for manual transfers)
 * @route   POST /api/payments/verify-bank-transfer
 * @access  Private (Customer)
 */
export const verifyBankTransferManually = async (req, res) => {
  try {
    const customer = req.user;
    const { reference, proofOfPayment } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    const payment = await Payment.findOne({
      paystackReference: reference,
      customerId: customer._id,
      paymentMethod: { $in: ["bank_transfer", "manual_bank_transfer"] },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Bank transfer payment not found",
      });
    }

    if (payment.status === "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment already verified",
      });
    }

    // Update payment with proof
    payment.metadata = {
      ...payment.metadata,
      proofOfPayment: proofOfPayment || null,
      verificationRequested: true,
      verificationRequestedAt: new Date(),
    };
    payment.status = "processing"; // Changed from pending to processing
    await payment.save();

    // Notify admin/support for manual verification
    // In production, you'd send this to your support team

    res.status(200).json({
      success: true,
      message:
        "Transfer submitted for verification. We will confirm payment within 5-10 minutes.",
      data: {
        paymentId: payment._id,
        reference: reference,
        status: "processing",
        estimatedVerificationTime: "5-10 minutes",
        nextSteps: [
          "We are verifying your bank transfer",
          "You will receive a notification once confirmed",
          "Estimated time: 5-10 minutes",
          "Contact support if not confirmed within 30 minutes",
        ],
      },
    });
  } catch (error) {
    console.error("âŒ Verify bank transfer error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit transfer for verification",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Initiate bank transfer payment
 * @route   POST /api/payments/initiate-bank-transfer
 * @access  Private (Customer)
 */
export const initiateBankTransfer = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId } = req.body;

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const amount = delivery.fare.totalFare;
    const platformFee = Math.round((amount * PLATFORM_FEE_PCT) / 100);
    const companyAmount = amount - platformFee;

    const reference = `RIDERR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    let bankDetails = null;
    let paymentMethod = "bank_transfer";

    try {
      // Try Flutterwave virtual account
      const vaResult = await createDedicatedVirtualAccount({
        email: customer.email,
        amount: amount,
        metadata: { reference, amount },
      });

      if (vaResult.success && vaResult.data) {
        const va = vaResult.data;
        bankDetails = {
          bankName: va.bankName,
          accountNumber: va.accountNumber,
          accountName: va.accountName,
          reference: reference,
          amount: amount,
          type: "flutterwave_virtual",
          narration: "Not required",
          expiresAt: va.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
          instructions: [
            `Transfer exactly ₦${amount.toLocaleString()}`,
            "Payment confirmed automatically",
          ],
        };
        paymentMethod = "bank_transfer_dedicated";
        console.log(`✅ Flutterwave virtual account created for ${reference}`);
      } else {
        throw new Error(vaResult.message || "Virtual account unavailable");
      }
    } catch (vaError) {
      console.warn("⚠️ Virtual account failed, using manual method:", vaError.message);
      bankDetails = {
        bankName: process.env.PLATFORM_BANK_NAME || process.env.FALLBACK_BANK_NAME || "Zenith Bank",
        accountNumber: process.env.PLATFORM_ACCOUNT_NUMBER || process.env.FALLBACK_ACCOUNT_NUMBER || "1012345678",
        accountName: process.env.PLATFORM_ACCOUNT_NAME || process.env.FALLBACK_ACCOUNT_NAME || "RIDERR NIG LTD",
        reference: reference,
        amount: amount,
        type: "manual_transfer",
        narration: `Riderr-${reference}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        instructions: [
          `Transfer exactly ₦${amount.toLocaleString()}`,
          `Use "${reference}" as narration`,
          "Payment valid for 24 hours",
        ],
      };
      paymentMethod = "manual_bank_transfer";
    }

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      amount: amount,
      currency: "NGN",
      gateway: getGatewayProvider(),
      gatewayReference: reference,
      paystackReference: reference,
      status: "pending",
      paymentMethod: paymentMethod,
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: "escrow",
      paystackAuthorizationUrl: bankDetails.authorizationUrl || null,
      paystackAccessCode: bankDetails.accessCode || null,
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        bankTransferDetails: bankDetails,
        platform: "in-app",
        pendingSettlement: true,
        transferType: bankDetails.type,
      },
    });

    await payment.save();

    delivery.payment.status = "pending_payment";
    delivery.payment.reference = reference;
    await delivery.save();

    console.log(
      `âœ… Bank transfer initiated (${bankDetails.type}) for delivery ${deliveryId}`,
    );

    res.status(200).json({
      success: true,
      message: "Bank transfer details generated successfully",
      data: {
        paymentId: payment._id,
        reference: reference,
        amount: amount,
        bankDetails: bankDetails,
        transferType: bankDetails.type,
        paymentBreakdown: {
          totalAmount: `â‚¦${amount.toLocaleString()}`,
          platformFee: `â‚¦${platformFee.toLocaleString()} (10%)`,
          companyReceives: `â‚¦${companyAmount.toLocaleString()} (90%)`,
          escrowStatus: "Payment held securely until delivery completion",
        },
        nextSteps: [
          "Open your banking app",
          `Transfer exactly ₦${amount.toLocaleString()} to the account shown`,
          "Return to this app — payment confirms automatically",
        ],
        polling: {
          url: `/api/payments/status/${reference}`,
          intervalSeconds: 5,
          timeoutMinutes: 30,
        },
        support: {
          email: process.env.SUPPORT_EMAIL || "support@riderr.com",
          phone: process.env.SUPPORT_PHONE || "+234 800 000 0000",
          hours: "9AM - 6PM, Mon - Fri",
        },
      },
    });
  } catch (error) {
    console.error("âŒ Initiate bank transfer error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate bank transfer",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
/**
 * @desc    Verify escrow payment (called after customer pays)
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 * @flow    Step 2b: Verify payment completed, mark delivery as "paid" and ready for driver acceptance
 */
export const verifyDeliveryPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.params;

    console.log(`ðŸ” [STEP 2b] Verifying payment: ${reference}`);

    // Verify with Paystack
    const verificationResult = await verifyPayment(reference);

    if (!verificationResult.success) {
      await session.abortTransaction();
      session.endSession();
      console.error(
        `âŒ Paystack verification failed:`,
        verificationResult.message,
      );
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
        error: verificationResult.message,
      });
    }

    const paymentData = verificationResult.data;

    // Find payment record
    const payment = await Payment.findOne({
      paystackReference: reference,
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Check if already verified
    if (payment.status === "successful") {
      await session.abortTransaction();
      session.endSession();
      console.log(`â„¹ï¸ Payment already verified: ${reference}`);
      return res.status(200).json({
        success: true,
        message: "Payment already verified",
        data: {
          paymentId: payment._id,
          status: payment.status,
          amount: payment.amount,
          paidAt: payment.paidAt,
          deliveryId: payment.deliveryId,
        },
      });
    }

    // Check payment status from gateway
    if (paymentData.status !== "success") {
      payment.status = "failed";
      payment.failureReason = paymentData.gateway_response || "Payment failed";
      await payment.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.error(
        `âŒ Payment failed - Gateway response: ${paymentData.gateway_response}`,
      );
      return res.status(400).json({
        success: false,
        message: "Payment was not successful",
        data: {
          status: paymentData.status,
          message: paymentData.gateway_response,
        },
      });
    }

    // âœ… Payment successful - Update payment record
    payment.status = "successful";
    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    payment.metadata = {
      ...payment.metadata,
      channel: paymentData.channel,
      cardType: paymentData.authorization?.card_type,
      bank: paymentData.authorization?.bank,
      lastFourDigits: paymentData.authorization?.last4,
      flwRef: paymentData.flw_ref,
      // Funds held in escrow
      escrowStatus: "held",
      escrowHeldAt: new Date(),
    };
    payment.webhookData = paymentData;

    await payment.save({ session });

    // Update delivery - Now PAID and ready for driver acceptance
    const delivery = await Delivery.findById(payment.deliveryId).session(
      session,
    );

    if (delivery) {
      delivery.payment.status = "paid"; // âœ… Payment received and held in escrow
      delivery.payment.paidAt = new Date();
      delivery.payment.reference = reference;
      delivery.status = "created"; // Keep as "created" - waiting for driver to accept
      await delivery.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    console.log(
      `âœ… Payment verified and funds held in escrow - Reference: ${reference}`,
    );

    // Notify customer
    await sendNotification({
      userId: payment.customerId,
      title: "âœ… Payment Successful",
      message: `Your payment of â‚¦${payment.amount.toLocaleString()} is confirmed. Finding a driver for you...`,
      data: {
        type: "payment_successful",
        deliveryId: delivery._id,
        paymentId: payment._id,
        amount: payment.amount,
      },
    });

    res.status(200).json({
      success: true,
      message:
        "Payment successful! Funds are held securely. Looking for available drivers...",
      data: {
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        paidAt: payment.paidAt,
        deliveryId: payment.deliveryId,
        reference: payment.paystackReference,
        escrowMessage:
          "Payment held securely. Will be released to company after delivery completion.",
        nextStep: "Waiting for driver to accept your delivery request",
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("âŒ Verify payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Complete delivery and trigger payment settlement
 * @route   POST /api/payments/complete-and-settle/:deliveryId
 * @access  Private (Customer - for verification)
 * @flow    Step 5: Customer verifies delivery, triggers automatic payment settlement
 */
export const completeAndSettlePayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const customer = req.user;
    const { deliveryId } = req.params;
    const { review, verified } = req.body;

    console.log(
      `ðŸ“¦ [SETTLEMENT] Customer ${customer._id} verifying delivery ${deliveryId}`,
    );

    if (!verified) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please confirm that you received the delivery",
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    })
      .populate("driverId")
      .populate("companyId")
      .session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    if (!["delivered", "completed"].includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery must be completed before verification. Current status: ${delivery.status}`,
      });
    }

    // Find payment
    const payment = await Payment.findOne({
      deliveryId: delivery._id,
      status: "successful",
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Payment not found or not successful",
      });
    }

    // Check if already settled
    if (payment.escrowDetails?.settledToCompany) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Payment has already been settled",
        data: {
          settledAt: payment.escrowDetails.settlementDate,
          transferId: payment.escrowDetails.paystackTransferId,
        },
      });
    }

    // Store customer verification
    payment.metadata = {
      ...payment.metadata,
      customerVerifiedAt: new Date(),
      customerVerified: true,
    };
    payment.markModified("metadata");

    // Set company ID if not set
    if (!payment.companyId && delivery.companyId) {
      payment.companyId = delivery.companyId._id;
    }

    await payment.save({ session });

    // Update delivery
    delivery.status = "completed";
    delivery.completedAt = new Date();
    delivery.review = review;
    delivery.ratedAt = new Date();
    delivery.payment.status = "completed";
    await delivery.save({ session });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // AUTOMATIC SETTLEMENT - This is where money moves!
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    console.log(
      "ðŸ’¸ [SETTLEMENT] Initiating automatic transfer to company...",
    );

    const settlementResult = await settlePaymentToCompany(
      payment,
      delivery.companyId,
    );

    if (settlementResult.success) {
      // âœ… Transfer successful - update payment record
      payment.escrowDetails.settledToCompany = true;
      payment.escrowDetails.settlementDate = new Date();
      payment.escrowDetails.paystackTransferId = settlementResult.transferId;

      payment.metadata = {
        ...payment.metadata,
        settlementStatus: settlementResult.status, // 'success', 'pending', 'failed'
        settlementReference: settlementResult.transferReference,
        settledAt: settlementResult.settledAt,
      };
      payment.markModified("metadata");

      // Add to audit log
      payment.auditLog.push({
        action: "settled_to_company",
        timestamp: new Date(),
        details: {
          transferId: settlementResult.transferId,
          amount: payment.companyAmount,
          status: settlementResult.status,
        },
      });

      await payment.save({ session });

      // Update company stats
      if (delivery.companyId) {
        const company = await Company.findById(delivery.companyId._id).session(
          session,
        );
        if (company) {
          company.totalEarnings =
            (company.totalEarnings || 0) + payment.companyAmount;
          company.totalDeliveries = (company.totalDeliveries || 0) + 1;
          company.lastPaymentReceived = new Date();
          await company.save({ session });
        }
      }

      // Update driver stats
      if (delivery.driverId) {
        const driver = await Driver.findById(delivery.driverId._id).session(
          session,
        );
        if (driver) {
          driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
          driver.lastDeliveryDate = new Date();
          await driver.save({ session });
        }
      }

      await session.commitTransaction();
      session.endSession();

      console.log(`âœ… [SETTLEMENT COMPLETE] Transfer successful!`);
      console.log(`   Transfer ID: ${settlementResult.transferId}`);
      console.log(`   Amount: â‚¦${payment.companyAmount.toLocaleString()}`);
      console.log(`   Status: ${settlementResult.status}`);

      // Notify company
      try {
        if (delivery.companyId) {
          await sendNotification({
            userId:
              delivery.companyId.userId ||
              delivery.companyId.ownerId ||
              delivery.companyId.owner,
            title: "ðŸ’° Payment Received",
            message: `â‚¦${payment.companyAmount.toLocaleString()} has been transferred to your bank account for delivery #${delivery.referenceId}`,
            data: {
              type: "payment_settled",
              deliveryId: delivery._id,
              paymentId: payment._id,
              amount: payment.companyAmount,
              transferId: settlementResult.transferId,
            },
          });
        }
      } catch (notificationError) {
        console.error(
          "âš ï¸ Notification error (non-critical):",
          notificationError,
        );
      }

      // Notify driver
      try {
        if (delivery.driverId) {
          const driver = await Driver.findById(delivery.driverId._id).populate(
            "userId",
          );
          if (driver && driver.userId) {
            await sendNotification({
              userId: driver.userId._id,
              title: "âœ… Delivery Completed & Payment Settled",
              message: `Delivery completed! Company received payment for delivery #${delivery.referenceId}`,
              data: {
                type: "delivery_completed",
                deliveryId: delivery._id,
              },
            });
          }
        }
      } catch (notificationError) {
        console.error(
          "âš ï¸ Notification error (non-critical):",
          notificationError,
        );
      }

      return res.status(200).json({
        success: true,
        message: "Delivery verified and payment settled successfully!",
        data: {
          deliveryId: delivery._id,
          paymentId: payment._id,
          status: "completed",
          review: review,
          settlement: {
            success: true,
            companyReceived: `â‚¦${payment.companyAmount.toLocaleString()}`,
            platformFee: `â‚¦${payment.platformFee.toLocaleString()}`,
            settledAt: payment.escrowDetails.settlementDate,
            transferId: settlementResult.transferId,
            transferStatus: settlementResult.status,
            settled: payment.escrowDetails.settledToCompany,
          },
        },
      });
    } else {
      // âŒ Transfer failed - rollback and notify
      await session.abortTransaction();
      session.endSession();

      console.error("âŒ [SETTLEMENT FAILED]", settlementResult.error);

      // Update payment with failure info (don't mark as settled)
      payment.metadata = {
        ...payment.metadata,
        settlementAttempted: true,
        settlementFailedAt: new Date(),
        settlementError: settlementResult.error,
        requiresManualSettlement: true,
      };
      payment.markModified("metadata");

      payment.auditLog.push({
        action: "settlement_failed",
        timestamp: new Date(),
        details: {
          error: settlementResult.error,
          amount: payment.companyAmount,
        },
      });

      await payment.save();

      return res.status(500).json({
        success: false,
        message: "Delivery verified but automatic settlement failed",
        error: settlementResult.error,
        data: {
          deliveryId: delivery._id,
          paymentId: payment._id,
          deliveryStatus: "completed",
          review: review,
          settlement: {
            success: false,
            error: settlementResult.error,
            companyAmount: payment.companyAmount,
            requiresAction: "Contact support to complete manual settlement",
          },
        },
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("âŒ Complete and settle payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete delivery and settle payment",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

async function settlePaymentToCompany(payment, company) {
  try {
    console.log(
      `ðŸ’¸ [SETTLEMENT] Starting settlement for payment ${payment._id}`,
    );
    console.log(`   Amount: â‚¦${payment.companyAmount.toLocaleString()}`);
    console.log(`   Company: ${company.name}`);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 1: Validate company has account number (that's all we need!)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (!company.bankAccount?.accountNumber) {
      console.error("âŒ Company account number not configured");
      return {
        success: false,
        error: "Company account number not configured",
        requiresAction: "company_add_account_number",
      };
    }

    if (!company.bankAccount?.accountName) {
      console.error("âŒ Company account name not configured");
      return {
        success: false,
        error: "Company account name not configured",
        requiresAction: "company_add_account_name",
      };
    }

    if (!company.bankAccount?.bankCode) {
      return {
        success: false,
        error:
          "Company bank code not configured. Company must update bank details with their bank code.",
        requiresAction: "company_add_bank_code",
      };
    }

    console.log(`âœ… Account found: ${company.bankAccount.accountNumber}`);
    console.log(`   Name: ${company.bankAccount.accountName}`);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 2 & 3: Create recipient (Paystack) or transfer directly (Flutterwave)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const transferReference = `SETTLE-${payment.paystackReference}`;
    const provider = getGatewayProvider();

    if (provider === "flutterwave") {
      // Flutterwave: transfer directly using account details (no recipient code)
      console.log(
        `ðŸ’° Initiating Flutterwave transfer of â‚¦${payment.companyAmount.toLocaleString()}...`,
      );

      const transferResult = await initiateTransfer({
        accountBank: company.bankAccount.bankCode,
        accountNumber: company.bankAccount.accountNumber,
        amount: payment.companyAmount,
        beneficiaryName: company.bankAccount.accountName,
        reference: transferReference,
        reason: `Settlement for delivery ${payment.deliveryId}`,
      });

      if (!transferResult.success) {
        console.error(
          "âŒ Flutterwave transfer failed:",
          transferResult.message,
        );
        return {
          success: false,
          error: transferResult.message,
          flutterwaveError: transferResult.error,
        };
      }

      console.log(`âœ… Flutterwave transfer successful!`);
      return {
        success: true,
        transferId: transferResult.data.transferCode,
        transferReference: transferResult.data.reference,
        amount: payment.companyAmount,
        settledAt: new Date(),
        status: transferResult.data.status,
      };
    }

    // Paystack: create recipient then transfer
    if (!company.paystackRecipientCode) {
      console.log("ðŸ“ Creating Paystack recipient (bank auto-detected)...");

      const recipientResult = await createTransferRecipient({
        accountName: company.bankAccount.accountName,
        accountNumber: company.bankAccount.accountNumber,
        bankCode: company.bankAccount.bankCode,
        companyId: company._id.toString(),
      });

      if (!recipientResult.success) {
        console.error(
          "âŒ Failed to create recipient:",
          recipientResult.message,
        );
        return {
          success: false,
          error: recipientResult.message,
          paystackError: recipientResult.error,
        };
      }

      // Save recipient code AND the bank info Paystack detected
      company.paystackRecipientCode = recipientResult.data.recipientCode;

      // Update bank details with what Paystack detected
      company.bankAccount.bankName = recipientResult.data.bankName;
      company.bankAccount.bankCode = recipientResult.data.bankCode;
      company.bankAccount.verified = true;
      company.bankAccount.verifiedAt = new Date();

      await company.save();

      console.log(
        `âœ… Recipient created: ${recipientResult.data.recipientCode}`,
      );
      console.log(
        `   Bank detected by Paystack: ${recipientResult.data.bankName}`,
      );
    } else {
      console.log(
        `âœ… Using existing recipient: ${company.paystackRecipientCode}`,
      );
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 3: Initiate Paystack transfer
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    console.log(
      `ðŸ’° Initiating Paystack transfer of â‚¦${payment.companyAmount.toLocaleString()}...`,
    );

    const transferResult = await initiateTransfer({
      amount: payment.companyAmount,
      recipientCode: company.paystackRecipientCode,
      reference: transferReference,
      reason: `Settlement for delivery ${payment.deliveryId}`,
    });

    if (!transferResult.success) {
      console.error("âŒ Transfer failed:", transferResult.message);

      // If "Recipient not found", clear recipient code so it recreates next time
      if (transferResult.message?.includes("Recipient not found")) {
        console.log("ðŸ”„ Clearing invalid recipient code...");
        company.paystackRecipientCode = null;
        await company.save();
      }

      return {
        success: false,
        error: transferResult.message,
        paystackError: transferResult.error,
      };
    }

    console.log(`âœ… Transfer successful!`);
    console.log(`   Transfer Code: ${transferResult.data.transferCode}`);
    console.log(`   Status: ${transferResult.data.status}`);

    return {
      success: true,
      transferId: transferResult.data.transferCode,
      transferReference: transferResult.data.reference,
      amount: payment.companyAmount,
      settledAt: new Date(),
      status: transferResult.data.status,
    };
  } catch (error) {
    console.error("âŒ Settlement error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * @desc    Mobile payment callback handler
 * @route   GET /api/payments/mobile-callback
 * @access  Public
 */
export const mobilePaymentCallback = async (req, res) => {
  try {
    const { reference, trxref } = req.query;
    const paymentReference = reference || trxref;

    if (!paymentReference) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="3;url=riderrapp://payment/error" />
        </head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>Payment Error</h1>
          <p>No payment reference found. Redirecting to app...</p>
        </body>
        </html>
      `);
    }

    const payment = await Payment.findOne({
      paystackReference: paymentReference,
    });

    if (!payment) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="3;url=riderrapp://payment/not-found" />
        </head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>Payment Not Found</h1>
          <p>Redirecting to app...</p>
        </body>
        </html>
      `);
    }

    if (payment.status === "successful") {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Successful</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #10B981 0%, #059669 100%);
              color: white;
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
            }
            .success-icon { font-size: 80px; margin-bottom: 20px; }
            h1 { font-size: 32px; margin-bottom: 20px; }
            p { font-size: 18px; margin-bottom: 30px; max-width: 400px; }
            .amount {
              font-size: 28px; font-weight: bold; margin: 20px 0;
              background: rgba(255,255,255,0.2); padding: 10px 30px; border-radius: 10px;
            }
            .button {
              background: white; color: #059669; padding: 15px 40px;
              border-radius: 25px; text-decoration: none; font-weight: bold;
              font-size: 18px; margin-top: 20px; display: inline-block; cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="success-icon">âœ…</div>
          <h1>Payment Successful!</h1>
          <p>Your payment has been received and held securely until delivery completion.</p>
          <div class="amount">â‚¦${payment.amount.toLocaleString()}</div>
          <p>Finding a driver for you...</p>
          <div class="button" onclick="redirectToApp()">Return to App</div>
          
          <script>
            function redirectToApp() {
              window.location.href = 'riderrapp://payment/success/${payment.paystackReference}';
              setTimeout(() => {
                window.location.href = 'https://riderrapp.com/payment-success?reference=${payment.paystackReference}';
              }, 500);
            }
            setTimeout(redirectToApp, 5000);
          </script>
        </body>
        </html>
      `);
    } else if (payment.status === "pending") {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Processing Payment</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial; text-align: center; padding: 50px; }
            .spinner {
              border: 8px solid #f3f3f3; border-top: 8px solid #10B981;
              border-radius: 50%; width: 60px; height: 60px;
              animation: spin 1s linear infinite; margin: 0 auto 20px;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <h2>Processing Payment...</h2>
          <p>Please wait while we confirm your payment.</p>
          <script>
            async function checkPayment() {
              try {
                const response = await fetch('/api/payments/verify/${paymentReference}');
                const data = await response.json();
                if (data.success && data.data.status === 'successful') {
                  window.location.reload();
                } else if (data.success === false) {
                  window.location.href = 'riderrapp://payment/failed/${paymentReference}';
                } else {
                  setTimeout(checkPayment, 2000);
                }
              } catch (error) {
                setTimeout(checkPayment, 2000);
              }
            }
            setTimeout(checkPayment, 2000);
          </script>
        </body>
        </html>
      `);
    } else {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Failed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: Arial; text-align: center; padding: 50px;
              background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%); color: white;
            }
            .error-icon { font-size: 80px; margin-bottom: 20px; }
            button {
              background: white; color: #DC2626; padding: 15px 30px;
              border: none; border-radius: 25px; font-size: 16px; margin: 10px; cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="error-icon">âŒ</div>
          <h1>Payment Failed</h1>
          <p>${payment.failureReason || "Payment could not be processed"}</p>
          <button onclick="window.location.href = 'riderrapp://payment/retry/${paymentReference}'">
            Try Again
          </button>
          <button onclick="window.location.href = 'riderrapp://home'">
            Go Home
          </button>
        </body>
        </html>
      `);
    }
  } catch (error) {
    console.error("Mobile callback error:", error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1>Server Error</h1>
        <p>Something went wrong. Please return to the app.</p>
        <script>
          setTimeout(() => {
            window.location.href = 'riderrapp://payment/error';
          }, 3000);
        </script>
      </body>
      </html>
    `);
  }
};

/**
 * @desc    Check payment status
 * @route   GET /api/payments/status/:reference
 * @access  Private
 */
export const checkPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params;

    const payment = await Payment.findOne({
      paystackReference: reference,
    }).select("status amount paidAt failureReason deliveryId metadata");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        status: payment.status,
        amount: payment.amount,
        paidAt: payment.paidAt,
        failureReason: payment.failureReason,
        deliveryId: payment.deliveryId,
        reference: reference,
        escrowStatus: payment.metadata?.escrowStatus || "pending",
      },
    });
  } catch (error) {
    console.error("Check payment status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check payment status",
    });
  }
};

/**
 * @desc    Handle Paystack webhook
 * @route   POST /api/payments/webhook
 * @access  Public (Paystack)
 */
export const handlePaystackWebhook = async (req, res) => {
  try {
    const event = req.body;
    const signature = req.headers["verif-hash"];

    if (!verifyWebhookSignature(event, signature)) {
      console.warn("âš ï¸ Invalid Flutterwave webhook signature");
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    }

    const status = (event.data?.status || "").toLowerCase();
    const txRef = event.data?.tx_ref;
    const flwRef = event.data?.flw_ref;
    const eventType = event.event;

    console.log(
      `ðŸ“¨ Flutterwave webhook: event=${eventType} tx_ref=${txRef} status=${status}`,
    );

    // â”€â”€ Charge success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (eventType === "charge.completed" && status === "successful") {
      const payment =
        (await Payment.findOne({ gatewayReference: txRef })) ||
        (await Payment.findOne({ paystackReference: txRef }));

      if (payment && payment.status !== "successful") {
        payment.status = "successful";
        payment.paidAt = new Date();
        payment.verifiedAt = new Date();
        payment.webhookData = event.data;
        payment.metadata = {
          ...payment.metadata,
          escrowStatus: "held",
          escrowHeldAt: new Date(),
          flwRef,
        };
        payment.markModified("metadata");
        await payment.save();

        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery) {
          delivery.payment.status = "paid";
          delivery.payment.paidAt = new Date();
          delivery.waitingForPayment = false;
          await delivery.save();

          if (delivery.driverId) {
            const driver = await Driver.findById(delivery.driverId).populate(
              "userId",
            );
            if (driver?.userId) {
              await sendNotification({
                userId: driver.userId._id,
                title: "âœ… Payment Confirmed!",
                message: `Customer completed payment for delivery #${delivery.referenceId}. You can now start the delivery!`,
                data: {
                  type: "payment_confirmed",
                  deliveryId: delivery._id,
                  paymentId: payment._id,
                  amount: payment.amount,
                  canStartDelivery: true,
                },
              });
            }
          }
        }

        console.log("âœ… Payment updated via webhook:", txRef);
      }
    }

    // â”€â”€ Transfer success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (eventType === "transfer.completed" && status === "successful") {
      const transferRef = event.data?.reference;
      const payment = await Payment.findOne({
        "metadata.settlementReference": transferRef,
      });
      if (payment) {
        payment.escrowDetails.settledToCompany = true;
        payment.escrowDetails.settlementDate = new Date();
        payment.escrowDetails.paystackTransferId = String(event.data?.id);
        payment.markModified("escrowDetails");
        await payment.save();
        console.log("âœ… Transfer confirmed via webhook:", transferRef);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("âŒ Webhook error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Webhook processing failed" });
  }
};

/**
 * @desc    Get payment details
 * @route   GET /api/payments/:paymentId
 * @access  Private
 */
/**
 * @desc    Get payment details
 * @route   GET /api/payments/:paymentId
 * @access  Private
 */
export const getPaymentDetails = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const user = req.user;

    // âœ… ADD VALIDATION: Check if it's a valid ObjectId
    // If it's "company-payments", it's not a payment ID
    if (
      paymentId === "company-payments" ||
      paymentId === "my-payments" ||
      paymentId === "initialize" ||
      paymentId === "verify" ||
      paymentId === "complete-and-settle" ||
      paymentId === "mobile-callback" ||
      paymentId === "status" ||
      paymentId === "webhook"
    ) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
        hint: "This appears to be a route, not a payment ID. Check your URL.",
      });
    }

    // âœ… Check if it's a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
        data: {
          providedId: paymentId,
          exampleId: "507f1f77bcf86cd799439011",
          validRoutes: [
            "/api/payments/company-payments",
            "/api/payments/my-payments",
            "/api/payments/initialize",
            "/api/payments/verify/:reference",
          ],
        },
      });
    }

    const payment = await Payment.findById(paymentId)
      .populate("customerId", "name email phone")
      .populate("deliveryId")
      .populate({
        path: "driverId",
        populate: { path: "userId", select: "name phone" },
      })
      .populate("companyId", "name email");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    const isCustomer =
      user._id.toString() === payment.customerId._id.toString();
    const isDriver = user.role === "driver";
    const isCompanyOwner =
      user.role === "company" &&
      payment.companyId &&
      payment.companyId.ownerId?.toString() === user._id.toString();
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isCompanyOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...payment.toObject(),
        splitInfo: {
          totalAmount: payment.amount,
          companyReceives: payment.companyAmount,
          platformFee: payment.platformFee,
          percentage: { company: "90%", platform: "10%" },
        },
        escrowInfo: {
          status: payment.metadata?.escrowStatus || "pending",
          heldAt: payment.metadata?.escrowHeldAt,
          settledAt: payment.metadata?.settledAt,
          message:
            payment.metadata?.escrowStatus === "settled"
              ? "Payment has been released to company"
              : "Payment is held securely in escrow",
        },
      },
    });
  } catch (error) {
    console.error("âŒ Get payment details error:", error);

    // Handle CastError specifically
    if (error.name === "CastError" && error.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
        data: {
          error: error.message,
          value: error.value,
          suggestion:
            "Payment ID must be a 24-character hex string like: 507f1f77bcf86cd799439011",
          validRoutes: [
            "/api/payments/company-payments",
            "/api/payments/my-payments",
            "/api/payments/initialize",
          ],
        },
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to get payment details",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get customer payments
 * @route   GET /api/payments/my-payments
 * @access  Private (Customer)
 */
export const getMyPayments = async (req, res) => {
  try {
    const customer = req.user;
    const { page = 1, limit = 10, status } = req.query;

    const query = { customerId: customer._id };
    if (status && status !== "all") {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate("deliveryId", "pickup dropoff status referenceId")
        .populate("companyId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("âŒ Get my payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payments",
    });
  }
};

/**
 * @desc    Get company payments and settlement history
 * @route   GET /api/payments/company-payments
 * @access  Private (Company)
 */
export const getCompanyPayments = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      settlementStatus,
    } = req.query;

    const query = { companyId: company._id };

    if (status && status !== "all") {
      query.status = status;
    }

    // âœ… Update to use escrowDetails
    if (settlementStatus) {
      if (settlementStatus === "settled") {
        query["escrowDetails.settledToCompany"] = true;
      } else if (
        settlementStatus === "pending" ||
        settlementStatus === "held"
      ) {
        query["escrowDetails.settledToCompany"] = false;
      }
    }

    if (startDate && endDate) {
      query.paidAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate("customerId", "name email phone avatarUrl")
        .populate({
          path: "deliveryId",
          select:
            "pickup dropoff status referenceId createdAt completedAt review ratedAt",
          populate: {
            path: "driverId",
            select: "userId vehicleType plateNumber vehicleMake vehicleModel",
            populate: {
              path: "userId",
              select: "name phone avatarUrl",
            },
          },
        })
        .sort({ paidAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Payment.countDocuments(query),
    ]);

    // âœ… Update aggregation to use escrowDetails
    const summary = await Payment.aggregate([
      { $match: { companyId: company._id, status: "successful" } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$companyAmount" },
          totalFees: { $sum: "$platformFee" },
          totalTransactions: { $sum: 1 },
          pendingSettlements: {
            $sum: {
              $cond: [{ $ne: ["$escrowDetails.settledToCompany", true] }, 1, 0],
            },
          },
          settledAmount: {
            $sum: {
              $cond: [
                { $eq: ["$escrowDetails.settledToCompany", true] },
                "$companyAmount",
                0,
              ],
            },
          },
          pendingAmount: {
            $sum: {
              $cond: [
                { $ne: ["$escrowDetails.settledToCompany", true] },
                "$companyAmount",
                0,
              ],
            },
          },
        },
      },
    ]);

    // âœ… Update recent settlements query
    const recentSettlements = await Payment.find({
      companyId: company._id,
      status: "successful",
      "escrowDetails.settledToCompany": true,
    })
      .sort({ "escrowDetails.settlementDate": -1 })
      .limit(5)
      .select(
        "amount companyAmount platformFee escrowDetails paystackReference deliveryId paidAt",
      )
      .populate("deliveryId", "referenceId")
      .lean();

    // âœ… Update formatting to use escrowDetails
    const formattedPayments = payments.map((payment) => {
      const settled = payment.escrowDetails?.settledToCompany || false;
      const escrowStatus = settled ? "settled" : "pending";
      const settledAt = payment.escrowDetails?.settlementDate || null;
      const transferId = payment.escrowDetails?.paystackTransferId || null;

      return {
        _id: payment._id,
        delivery: payment.deliveryId
          ? {
              _id: payment.deliveryId._id,
              referenceId: payment.deliveryId.referenceId,
              status: payment.deliveryId.status,
              pickup: payment.deliveryId.pickup?.address,
              dropoff: payment.deliveryId.dropoff?.address,
              review: payment.deliveryId.review,
              ratedAt: payment.deliveryId.ratedAt,
              driver: payment.deliveryId.driverId?.userId
                ? {
                    name: payment.deliveryId.driverId.userId.name,
                    phone: payment.deliveryId.driverId.userId.phone,
                    avatarUrl: payment.deliveryId.driverId.userId.avatarUrl,
                    vehicleType: payment.deliveryId.driverId.vehicleType,
                    vehicleMake: payment.deliveryId.driverId.vehicleMake,
                    vehicleModel: payment.deliveryId.driverId.vehicleModel,
                    plateNumber: payment.deliveryId.driverId.plateNumber,
                  }
                : null,
            }
          : null,
        customer: payment.customerId
          ? {
              name: payment.customerId.name,
              email: payment.customerId.email,
              phone: payment.customerId.phone,
              avatarUrl: payment.customerId.avatarUrl,
            }
          : null,
        amount: payment.amount,
        companyAmount: payment.companyAmount,
        platformFee: payment.platformFee,
        status: payment.status,
        escrowStatus: escrowStatus, // âœ… Now will show "settled"
        paidAt: payment.paidAt,
        settledAt: settledAt,
        transferId: transferId,
        paymentMethod: payment.paymentMethod,
        paystackReference: payment.paystackReference,
        currency: payment.currency || "NGN",
      };
    });

    // âœ… Format recent settlements
    const formattedRecentSettlements = recentSettlements.map((settlement) => ({
      _id: settlement._id,
      deliveryReference: settlement.deliveryId?.referenceId || "N/A",
      amount: settlement.amount,
      companyAmount: settlement.companyAmount,
      platformFee: settlement.platformFee,
      settledAt: settlement.escrowDetails?.settlementDate,
      transferId: settlement.escrowDetails?.paystackTransferId,
      paystackReference: settlement.paystackReference,
      paidAt: settlement.paidAt,
    }));

    res.status(200).json({
      success: true,
      message: `Found ${formattedPayments.length} payment${formattedPayments.length !== 1 ? "s" : ""} for ${company.name}`,
      data: {
        payments: formattedPayments,
        summary: summary[0] || {
          totalEarnings: 0,
          totalFees: 0,
          totalTransactions: 0,
          pendingSettlements: 0,
          settledAmount: 0,
          pendingAmount: 0,
        },
        recentSettlements: formattedRecentSettlements,
        company: {
          _id: company._id,
          name: company.name,
          email: company.email,
          phone: company.contactPhone,
          earnings: company.totalEarnings || 0,
          totalDeliveries: company.totalDeliveries || 0,
          lastPaymentReceived: company.lastPaymentReceived,
        },
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
        filters: {
          applied: {
            status: status || "all",
            settlementStatus: settlementStatus || "all",
            dateRange: startDate && endDate ? { startDate, endDate } : null,
          },
          available: {
            statuses: ["all", "pending", "successful", "failed"],
            settlementStatuses: [
              "all",
              "pending",
              "held",
              "settling",
              "settled",
            ],
          },
        },
      },
    });
  } catch (error) {
    console.error("âŒ Get company payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company payments",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
/**
 * @desc    Get company settlement details
 * @route   GET /api/payments/company-settlements/:paymentId
 * @access  Private (Company)
 */
export const getCompanySettlementDetails = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { paymentId } = req.params;

    // Validate paymentId format
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    const payment = await Payment.findOne({
      _id: paymentId,
      companyId: company._id,
    })
      .populate("customerId", "name email phone avatarUrl")
      .populate({
        path: "deliveryId",
        select:
          "pickup dropoff status referenceId createdAt completedAt driverDetails driverId companyDetails estimatedDistanceKm fare",
        populate: [
          {
            path: "driverId",
            select: "userId vehicleType plateNumber vehicleMake vehicleModel",
            populate: {
              path: "userId",
              select: "name phone avatarUrl rating",
            },
          },
          {
            path: "companyId",
            select: "name logo contactPhone",
          },
        ],
      })
      .lean();

    if (!payment) {
      // Check if payment exists but belongs to another company
      const existingPayment = await Payment.findById(paymentId)
        .select("companyId")
        .lean();
      if (existingPayment) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this payment",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Get settlement transaction details
    const settlementDetails = {
      transferId: payment.metadata?.settlementTransferId,
      status: payment.escrowDetails?.settledToCompany ? "settled" : "held",
      settledAt: payment.escrowDetails?.settlementDate,
      transferId: payment.escrowDetails?.paystackTransferId,
      transferStatus: payment.metadata?.settlementStatus,
      estimatedArrival: getEstimatedArrival(
        payment.metadata?.escrowStatus,
        payment.metadata?.settledAt,
      ),
      transferReference:
        payment.metadata?.transferReference ||
        `TRF-${payment.paystackReference}`,
      bankName: company.bankDetails?.bankName,
      accountNumber: company.bankDetails?.accountNumber
        ? `****${company.bankDetails.accountNumber.slice(-4)}`
        : null,
      accountName: company.bankDetails?.accountName,
    };

    // Get additional settlement info from Paystack if available
    let transferInfo = null;
    if (payment.metadata?.settlementTransferId) {
      try {
        // In production, you would call Paystack Transfer API
        // transferInfo = await paystack.transfer.verify(payment.metadata.settlementTransferId);
        transferInfo = {
          status: "success",
          recipient: company.bankDetails?.accountName || "Company Account",
          amount: payment.companyAmount,
          fee: payment.platformFee,
          createdAt: payment.metadata?.settledAt,
          transferredAt: payment.metadata?.settledAt,
        };
      } catch (transferError) {
        console.warn(
          "âš ï¸ Failed to fetch transfer details:",
          transferError.message,
        );
      }
    }

    // Calculate commission breakdown
    const commissionBreakdown = {
      totalAmount: payment.amount,
      companyAmount: payment.companyAmount,
      platformFee: payment.platformFee,
      percentage: {
        company: Math.round((payment.companyAmount / payment.amount) * 100),
        platform: Math.round((payment.platformFee / payment.amount) * 100),
      },
      currency: payment.currency || "NGN",
    };

    // Enhanced timeline
    const timeline = [];

    // Payment timeline
    if (payment.paidAt)
      timeline.push({
        event: "payment_received",
        time: payment.paidAt,
        description: "Customer payment received",
        status: "completed",
        icon: "ðŸ’³",
        details: `â‚¦${payment.amount.toLocaleString()} from ${payment.customerId?.name || "Customer"}`,
      });

    if (payment.metadata?.escrowHeldAt)
      timeline.push({
        event: "escrow_held",
        time: payment.metadata.escrowHeldAt,
        description: "Funds held in escrow",
        status: "completed",
        icon: "ðŸ”’",
        details: "Payment secured until delivery completion",
      });

    // Driver acceptance timeline (from delivery)
    if (payment.deliveryId?.driverId) {
      const delivery = await Delivery.findById(payment.deliveryId._id)
        .select("assignedAt pickedUpAt deliveredAt")
        .lean();

      if (delivery?.assignedAt)
        timeline.push({
          event: "driver_assigned",
          time: delivery.assignedAt,
          description: "Driver accepted delivery",
          status: "completed",
          icon: "ðŸš—",
          details: payment.deliveryId.driverId?.userId?.name || "Driver",
        });

      if (delivery?.pickedUpAt)
        timeline.push({
          event: "package_picked_up",
          time: delivery.pickedUpAt,
          description: "Package picked up",
          status: "completed",
          icon: "ðŸ“¦",
          details: "Driver collected the package",
        });

      if (delivery?.deliveredAt)
        timeline.push({
          event: "delivery_completed",
          time: delivery.deliveredAt,
          description: "Package delivered",
          status: "completed",
          icon: "âœ…",
          details: "Delivery completed by driver",
        });
    }

    // Verification and settlement timeline
    if (payment.metadata?.customerVerifiedAt)
      timeline.push({
        event: "customer_verified",
        time: payment.metadata.customerVerifiedAt,
        description: "Customer verified delivery",
        status: "completed",
        icon: "ðŸ‘¤",
        details: "Customer confirmed successful delivery",
      });

    if (payment.metadata?.settledAt)
      timeline.push({
        event: "settlement_initiated",
        time: payment.metadata.settledAt,
        description: "Settlement to company initiated",
        status: "completed",
        icon: "ðŸ’°",
        details: `â‚¦${payment.companyAmount.toLocaleString()} transferred to company account`,
      });

    if (payment.metadata?.escrowStatus === "settled")
      timeline.push({
        event: "settlement_completed",
        time: payment.metadata.settledAt,
        description: "Settlement completed",
        status: "completed",
        icon: "ðŸŽ‰",
        details: "Funds successfully deposited",
      });

    // Sort timeline
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Get related deliveries for this customer (optional)
    const relatedDeliveries = await Delivery.find({
      customerId: payment.customerId,
      companyId: company._id,
      status: "completed",
      _id: { $ne: payment.deliveryId?._id },
    })
      .select("referenceId fare.totalFare completedAt")
      .sort({ completedAt: -1 })
      .limit(3)
      .lean();

    res.status(200).json({
      success: true,
      message: "Settlement details retrieved successfully",
      data: {
        payment: {
          _id: payment._id,
          paystackReference: payment.paystackReference,
          amount: payment.amount,
          companyAmount: payment.companyAmount,
          platformFee: payment.platformFee,
          status: payment.status,
          escrowStatus: payment.metadata?.escrowStatus || "pending",
          paidAt: payment.paidAt,
          paymentMethod: payment.paymentMethod,
          currency: payment.currency,
        },
        delivery: payment.deliveryId
          ? {
              _id: payment.deliveryId._id,
              referenceId: payment.deliveryId.referenceId,
              status: payment.deliveryId.status,
              pickup: {
                address: payment.deliveryId.pickup?.address,
                lat: payment.deliveryId.pickup?.lat,
                lng: payment.deliveryId.pickup?.lng,
                name: payment.deliveryId.pickup?.name,
                phone: payment.deliveryId.pickup?.phone,
              },
              dropoff: {
                address: payment.deliveryId.dropoff?.address,
                lat: payment.deliveryId.dropoff?.lat,
                lng: payment.deliveryId.dropoff?.lng,
                name: payment.deliveryId.dropoff?.name,
                phone: payment.deliveryId.dropoff?.phone,
              },
              driver: payment.deliveryId.driverId?.userId
                ? {
                    _id: payment.deliveryId.driverId._id,
                    name: payment.deliveryId.driverId.userId.name,
                    phone: payment.deliveryId.driverId.userId.phone,
                    avatarUrl: payment.deliveryId.driverId.userId.avatarUrl,
                    rating: payment.deliveryId.driverId.userId.rating,
                    vehicle: {
                      type: payment.deliveryId.driverId.vehicleType,
                      make: payment.deliveryId.driverId.vehicleMake,
                      model: payment.deliveryId.driverId.vehicleModel,
                      plateNumber: payment.deliveryId.driverId.plateNumber,
                    },
                  }
                : payment.deliveryId.driverDetails || null,
              distance: payment.deliveryId.estimatedDistanceKm,
              fare: payment.deliveryId.fare,
              completedAt: payment.deliveryId.completedAt,
              company: payment.deliveryId.companyId
                ? {
                    name: payment.deliveryId.companyId.name,
                    logo: payment.deliveryId.companyId.logo,
                    contactPhone: payment.deliveryId.companyId.contactPhone,
                  }
                : null,
            }
          : null,
        customer: payment.customerId
          ? {
              _id: payment.customerId._id,
              name: payment.customerId.name,
              email: payment.customerId.email,
              phone: payment.customerId.phone,
              avatarUrl: payment.customerId.avatarUrl,
            }
          : null,
        settlement: settlementDetails,
        transferInfo,
        commission: commissionBreakdown,
        timeline,
        relatedDeliveries,
        actions: getAvailableActions(payment.metadata?.escrowStatus),
        support: {
          contactEmail: process.env.SUPPORT_EMAIL || "support@riderr.com",
          contactPhone: process.env.SUPPORT_PHONE || "+234 800 000 0000",
          disputeWindow: "24 hours after settlement",
        },
      },
    });
  } catch (error) {
    console.error("âŒ Get settlement details error:", error);

    // Handle specific errors
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to get settlement details",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Helper function to calculate estimated arrival time
 */
function getEstimatedArrival(escrowStatus, settledAt) {
  if (!escrowStatus) return "Pending settlement";

  switch (escrowStatus) {
    case "settled":
      if (settledAt) {
        const settledDate = new Date(settledAt);
        const now = new Date();
        const hoursDiff = Math.abs(now - settledDate) / 36e5;

        if (hoursDiff < 1) return "Just now";
        if (hoursDiff < 24) return `${Math.floor(hoursDiff)} hours ago`;
        return `${Math.floor(hoursDiff / 24)} days ago`;
      }
      return "Settlement completed";

    case "settling":
      return "Processing (1-2 business days)";

    case "held":
      return "After customer verification (within 24 hours)";

    default:
      return "Pending";
  }
}

/**
 * Helper function to determine available actions based on settlement status
 */
function getAvailableActions(escrowStatus) {
  const actions = [];

  switch (escrowStatus) {
    case "held":
      actions.push(
        { label: "Contact Customer", action: "contact_customer", icon: "ðŸ“ž" },
        {
          label: "View Delivery Details",
          action: "view_delivery",
          icon: "ðŸ“‹",
        },
        { label: "Check Driver Status", action: "check_driver", icon: "ðŸš—" },
      );
      break;

    case "settling":
      actions.push(
        { label: "Track Transfer", action: "track_transfer", icon: "ðŸ“" },
        {
          label: "View Transfer Details",
          action: "view_transfer",
          icon: "ðŸ’°",
        },
        { label: "Contact Support", action: "contact_support", icon: "ðŸ†˜" },
      );
      break;

    case "settled":
      actions.push(
        { label: "Download Receipt", action: "download_receipt", icon: "ðŸ“„" },
        { label: "View Bank Statement", action: "view_statement", icon: "ðŸ¦" },
        { label: "Report Issue", action: "report_issue", icon: "âš ï¸" },
      );
      break;

    default:
      actions.push({
        label: "Contact Support",
        action: "contact_support",
        icon: "ðŸ†˜",
      });
  }

  return actions;
}

/**
 * @desc    Download settlement receipt (PDF)
 * @route   GET /api/payments/company-settlements/:paymentId/receipt
 * @access  Private (Company)
 */
export const downloadSettlementReceipt = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { paymentId } = req.params;

    const payment = await Payment.findOne({
      _id: paymentId,
      companyId: company._id,
    })
      .populate("customerId", "name email")
      .populate("deliveryId", "referenceId completedAt")
      .lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // Generate receipt HTML (simplified version)
    const receiptHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 24px; font-weight: bold; color: #10B981; }
          .title { font-size: 20px; margin: 20px 0; }
          .details { margin: 20px 0; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .value { margin-left: 10px; }
          .amount { font-size: 24px; font-weight: bold; color: #10B981; margin: 20px 0; }
          .footer { margin-top: 40px; text-align: center; color: #888; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f5f5f5; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">Riderr</div>
          <div class="title">SETTLEMENT RECEIPT</div>
          <div>Payment ID: ${payment._id}</div>
        </div>
        
        <div class="details">
          <div class="detail-row">
            <span class="label">Company:</span>
            <span class="value">${company.name}</span>
          </div>
          <div class="detail-row">
            <span class="label">Customer:</span>
            <span class="value">${payment.customerId?.name || "N/A"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Delivery Reference:</span>
            <span class="value">${payment.deliveryId?.referenceId || "N/A"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Payment Reference:</span>
            <span class="value">${payment.paystackReference}</span>
          </div>
          <div class="detail-row">
            <span class="label">Paid Date:</span>
            <span class="value">${new Date(payment.paidAt).toLocaleDateString()}</span>
          </div>
          <div class="detail-row">
            <span class="label">Settled Date:</span>
            <span class="value">${payment.metadata?.settledAt ? new Date(payment.metadata.settledAt).toLocaleDateString() : "N/A"}</span>
          </div>
        </div>
        
        <table>
          <tr>
            <th>Description</th>
            <th>Amount (NGN)</th>
          </tr>
          <tr>
            <td>Total Payment</td>
            <td>â‚¦${payment.amount.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Platform Fee (${Math.round((payment.platformFee / payment.amount) * 100)}%)</td>
            <td>â‚¦${payment.platformFee.toLocaleString()}</td>
          </tr>
          <tr>
            <td><strong>Amount Settled to Company</strong></td>
            <td><strong>â‚¦${payment.companyAmount.toLocaleString()}</strong></td>
          </tr>
        </table>
        
        <div class="amount">â‚¦${payment.companyAmount.toLocaleString()}</div>
        
        <div class="footer">
          <p>This is an automated receipt generated by Riderr</p>
          <p>If you have any questions, contact support@riderr.com</p>
          <p>Generated on: ${new Date().toLocaleDateString()}</p>
        </div>
      </body>
      </html>
    `;

    // Set headers for PDF download
    res.setHeader("Content-Type", "text/html");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="receipt-${payment._id}.html"`,
    );

    res.send(receiptHtml);
  } catch (error) {
    console.error("âŒ Download receipt error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate receipt",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Submit OTP for card charge
 * @route   POST /api/payments/submit-otp
 * @access  Private (Customer)
 */
export const submitOtp = async (req, res) => {
  try {
    const customer = req.user;
    const { reference, otp } = req.body;

    if (!reference || !otp) {
      return res.status(400).json({
        success: false,
        message: "Reference and OTP are required",
      });
    }

    const payment = await Payment.findOne({
      paystackReference: reference,
      customerId: customer._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.status === "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment already completed",
      });
    }

    // âœ… FIXED: Don't check requiresOtp flag (it was being silently dropped
    // by the old strict schema). Instead check payment is in 'processing'
    // state and that we have a chargeReference saved.
    if (payment.status !== "processing") {
      return res.status(400).json({
        success: false,
        message: `Payment is not awaiting OTP. Current status: ${payment.status}`,
      });
    }

    const paystackReference = payment.metadata?.chargeReference;

    console.log("ðŸ” Submitting OTP to Paystack");
    console.log("   Internal ref  :", reference);
    console.log("   chargeReference from metadata:", paystackReference);
    console.log(
      "   Full metadata :",
      JSON.stringify(payment.metadata, null, 2),
    );

    if (!paystackReference) {
      console.error("âŒ chargeReference missing from payment metadata!");
      console.error("   This means it was not saved during chargeCard step.");
      console.error("   Payment status:", payment.status);
      return res.status(400).json({
        success: false,
        message:
          "Payment session expired or invalid. Please start a new payment.",
        debug:
          process.env.NODE_ENV !== "production"
            ? {
                hint: "chargeReference was not saved to metadata during charge step",
                paymentStatus: payment.status,
                metadataKeys: Object.keys(payment.metadata || {}),
              }
            : undefined,
      });
    }

    const otpResult = await gatewaySubmitOtp({
      otp: otp.toString().trim(),
      reference: paystackReference,
    });

    if (!otpResult.success) {
      return res.status(400).json({
        success: false,
        message: otpResult.message || "Invalid OTP",
        error: otpResult.error,
      });
    }

    // âœ… OTP accepted â€” mark payment successful
    payment.status = "successful";
    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    payment.webhookData = otpResult.data;
    payment.metadata = {
      ...payment.metadata,
      requiresOtp: false,
      otpVerifiedAt: new Date(),
      escrowStatus: "held",
      escrowHeldAt: new Date(),
      flwRef: otpResult.data?.flw_ref,
    };
    // âœ… Required for Mixed schema fields
    payment.markModified("metadata");
    await payment.save();

    // Update delivery
    const delivery = await Delivery.findById(payment.deliveryId);
    if (delivery) {
      delivery.payment.status = "paid";
      delivery.payment.paidAt = new Date();
      await delivery.save();
    }

    await sendNotification({
      userId: customer._id,
      title: "âœ… Payment Successful",
      message: `Your payment of â‚¦${payment.amount.toLocaleString()} is confirmed. Finding a driver for you...`,
      data: {
        type: "payment_successful",
        deliveryId: payment.deliveryId,
        paymentId: payment._id,
        amount: payment.amount,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Payment completed successfully!",
      data: {
        paymentId: payment._id,
        reference: reference,
        amount: payment.amount,
        deliveryId: payment.deliveryId,
        paidAt: payment.paidAt,
      },
    });
  } catch (error) {
    console.error("âŒ Submit OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Submit PIN for card charge (when Paystack returns send_pin)
 * @route   POST /api/payments/submit-pin
 * @access  Private (Customer)
 */
export const submitPin = async (req, res) => {
  try {
    const customer = req.user;
    const { reference, pin } = req.body;

    if (!reference || !pin) {
      return res.status(400).json({
        success: false,
        message: "Reference and PIN are required",
      });
    }

    const payment = await Payment.findOne({
      paystackReference: reference,
      customerId: customer._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.status === "successful") {
      return res.status(400).json({
        success: false,
        message: "Payment already completed",
      });
    }

    // âœ… Use Paystack's reference, not internal RIDERR-xxx reference
    const paystackReference = payment.metadata?.chargeReference || reference;

    console.log(`ðŸ” Submitting PIN for payment ${payment._id}`);
    console.log(`   Paystack ref : ${paystackReference}`);

    const pinResult = await gatewaySubmitPin({
      pin: pin.toString().trim(),
      reference: paystackReference,
    });

    if (!pinResult.success) {
      return res.status(400).json({
        success: false,
        message: pinResult.message || "Invalid PIN",
        error: pinResult.error,
      });
    }

    const pinData = pinResult.data;

    // After PIN, Paystack may ask for OTP next
    if (pinResult.requiresOtp || pinData?.status === "send_otp") {
      payment.metadata = {
        ...payment.metadata,
        requiresPin: false,
        requiresOtp: true,
        // âœ… Update chargeReference in case Paystack changed it
        chargeReference: pinData.reference || paystackReference,
      };
      await payment.save();

      return res.status(200).json({
        success: true,
        requiresOtp: true,
        message: "OTP sent to your phone number",
        data: {
          paymentId: payment._id,
          reference: reference,
          amount: payment.amount,
          displayMessage:
            pinData.display_text || "Please enter the OTP sent to your phone",
        },
      });
    }

    // PIN accepted and payment successful immediately
    if (pinData?.status === "success") {
      payment.status = "successful";
      payment.paidAt = new Date();
      payment.verifiedAt = new Date();
      payment.webhookData = pinData;
      payment.metadata = {
        ...payment.metadata,
        requiresPin: false,
        escrowStatus: "held",
        escrowHeldAt: new Date(),
      };
      await payment.save();

      const delivery = await Delivery.findById(payment.deliveryId);
      if (delivery) {
        delivery.payment.status = "paid";
        delivery.payment.paidAt = new Date();
        await delivery.save();
      }

      await sendNotification({
        userId: customer._id,
        title: "âœ… Payment Successful",
        message: `Your payment of â‚¦${payment.amount.toLocaleString()} is confirmed. Finding a driver for you...`,
        data: {
          type: "payment_successful",
          deliveryId: payment.deliveryId,
          paymentId: payment._id,
          amount: payment.amount,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Payment completed successfully!",
        data: {
          paymentId: payment._id,
          reference: reference,
          amount: payment.amount,
          deliveryId: payment.deliveryId,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: `Unexpected status after PIN: ${pinData?.status}`,
    });
  } catch (error) {
    console.error("âŒ Submit PIN error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify PIN",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get driver payments and earnings
 * @route   GET /api/payments/driver-payments
 * @access  Private (Driver)
 */
export const getDriverPayments = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can view payment history",
      });
    }

    // Find driver
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const {
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      paymentMethod,
      settledStatus,
    } = req.query;

    // Build query
    const query = { driverId: driver._id };

    if (status && status !== "all") {
      query.status = status;
    }

    if (paymentMethod && paymentMethod !== "all") {
      query.paymentMethod = paymentMethod;
    }

    if (startDate && endDate) {
      query.paidAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Filter by settlement status (for cash payments that need to be settled)
    if (settledStatus) {
      if (settledStatus === "settled") {
        query["metadata.isSettledToDriver"] = true;
      } else if (settledStatus === "pending") {
        query["metadata.isSettledToDriver"] = false;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate("customerId", "name email phone avatarUrl")
        .populate("companyId", "name logo contactPhone")
        .populate({
          path: "deliveryId",
          select:
            "pickup dropoff status referenceId createdAt completedAt driverDetails fare",
        })
        .sort({ paidAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Payment.countDocuments(query),
    ]);

    // Calculate earnings summary
    const summary = await Payment.aggregate([
      { $match: { driverId: driver._id, status: "successful" } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$amount" },
          totalTransactions: { $sum: 1 },
          cashPayments: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, 1, 0],
            },
          },
          cashAmount: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, "$amount", 0],
            },
          },
          onlinePayments: {
            $sum: {
              $cond: [{ $ne: ["$paymentMethod", "cash"] }, 1, 0],
            },
          },
          onlineAmount: {
            $sum: {
              $cond: [{ $ne: ["$paymentMethod", "cash"] }, "$amount", 0],
            },
          },
          pendingSettlements: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentMethod", "cash"] },
                    { $ne: ["$metadata.isSettledToDriver", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pendingAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentMethod", "cash"] },
                    { $ne: ["$metadata.isSettledToDriver", true] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          settledAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentMethod", "cash"] },
                    { $eq: ["$metadata.isSettledToDriver", true] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]);

    // Get recent cash payments that need settlement
    const pendingCashSettlements = await Payment.find({
      driverId: driver._id,
      paymentMethod: "cash",
      status: "successful",
      "metadata.isSettledToDriver": { $ne: true },
    })
      .sort({ paidAt: -1 })
      .limit(5)
      .select("amount deliveryId paidAt metadata.companyId")
      .populate("companyId", "name contactPhone")
      .populate("deliveryId", "referenceId")
      .lean();

    // Format payments for response
    const formattedPayments = payments.map((payment) => {
      const isCash = payment.paymentMethod === "cash";
      const settledToDriver = payment.metadata?.isSettledToDriver || false;
      const settledAt = payment.metadata?.settledToDriverAt || null;
      const settlementMethod = payment.metadata?.settlementMethod || null;

      return {
        _id: payment._id,
        delivery: payment.deliveryId
          ? {
              _id: payment.deliveryId._id,
              referenceId: payment.deliveryId.referenceId,
              status: payment.deliveryId.status,
              pickup: payment.deliveryId.pickup?.address,
              dropoff: payment.deliveryId.dropoff?.address,
              fare: payment.deliveryId.fare,
            }
          : null,
        customer: payment.customerId
          ? {
              name: payment.customerId.name,
              phone: payment.customerId.phone,
              avatarUrl: payment.customerId.avatarUrl,
            }
          : null,
        company: payment.companyId
          ? {
              name: payment.companyId.name,
              contactPhone: payment.companyId.contactPhone,
              logo: payment.companyId.logo,
            }
          : null,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        isCash: isCash,
        paidAt: payment.paidAt,

        // Cash payment specific fields
        settlementStatus: isCash
          ? settledToDriver
            ? "settled"
            : "pending"
          : "n/a",
        settledAt: settledAt,
        settlementMethod: settlementMethod,
        canCollect: isCash && !settledToDriver,

        // Online payment specific fields
        escrowStatus: !isCash
          ? payment.metadata?.escrowStatus || "pending"
          : "n/a",

        currency: payment.currency || "NGN",
        paystackReference: payment.paystackReference,
        notes: payment.metadata?.notes || "",
      };
    });

    // Format pending cash settlements
    const formattedPendingSettlements = pendingCashSettlements.map(
      (settlement) => ({
        _id: settlement._id,
        deliveryReference: settlement.deliveryId?.referenceId || "N/A",
        amount: settlement.amount,
        companyName: settlement.companyId?.name || "Unknown Company",
        companyPhone: settlement.companyId?.contactPhone || "",
        paidAt: settlement.paidAt,
        daysPending: Math.floor(
          (new Date() - new Date(settlement.paidAt)) / (1000 * 60 * 60 * 24),
        ),
      }),
    );

    res.status(200).json({
      success: true,
      message: `Found ${formattedPayments.length} payments for ${driverUser.name}`,
      data: {
        payments: formattedPayments,
        summary: summary[0] || {
          totalEarnings: 0,
          totalTransactions: 0,
          cashPayments: 0,
          cashAmount: 0,
          onlinePayments: 0,
          onlineAmount: 0,
          pendingSettlements: 0,
          pendingAmount: 0,
          settledAmount: 0,
        },
        pendingCashSettlements: formattedPendingSettlements,
        driver: {
          _id: driver._id,
          name: driverUser.name,
          phone: driverUser.phone,
          rating: driver.rating || 0,
          totalDeliveries: driver.totalDeliveries || 0,
          acceptanceRate: driver.totalRequests
            ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
            : 0,
          currentStatus: {
            isOnline: driver.isOnline,
            isAvailable: driver.isAvailable,
            hasActiveDelivery: !!driver.currentDeliveryId,
          },
        },
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
        filters: {
          applied: {
            status: status || "all",
            paymentMethod: paymentMethod || "all",
            settlementStatus: settledStatus || "all",
            dateRange: startDate && endDate ? { startDate, endDate } : null,
          },
          available: {
            statuses: ["all", "pending", "successful", "failed"],
            paymentMethods: ["all", "cash", "card", "bank_transfer"],
            settlementStatuses: ["all", "pending", "settled"],
          },
        },
      },
    });
  } catch (error) {
    console.error("âŒ Get driver payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver payments",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get driver payment details
 * @route   GET /api/payments/driver-payments/:paymentId
 * @access  Private (Driver)
 */
export const getDriverPaymentDetails = async (req, res) => {
  try {
    const driverUser = req.user;
    const { paymentId } = req.params;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can view payment details",
      });
    }

    // Validate paymentId format
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    // Find payment that belongs to this driver
    const payment = await Payment.findOne({
      _id: paymentId,
      driverId: driver._id,
    })
      .populate("customerId", "name email phone avatarUrl rating")
      .populate("companyId", "name logo contactPhone address")
      .populate({
        path: "deliveryId",
        select:
          "pickup dropoff status referenceId createdAt completedAt driverDetails fare estimatedDistanceKm",
        populate: {
          path: "driverId",
          select: "userId vehicleType plateNumber",
          populate: {
            path: "userId",
            select: "name phone avatarUrl rating",
          },
        },
      })
      .lean();

    if (!payment) {
      // Check if payment exists but belongs to another driver
      const existingPayment = await Payment.findById(paymentId)
        .select("driverId")
        .lean();
      if (existingPayment) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to view this payment",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    const isCash = payment.paymentMethod === "cash";
    const settledToDriver = payment.metadata?.isSettledToDriver || false;
    const settledAt = payment.metadata?.settledToDriverAt || null;
    const settlementMethod = payment.metadata?.settlementMethod || null;
    const settlementNotes = payment.metadata?.settlementNotes || "";

    // Calculate driver's share (for commission-based systems)
    // In your case, driver might get the full cash amount or a percentage
    const driverShare = payment.amount; // Adjust this based on your commission structure
    const platformFee = isCash ? 0 : payment.platformFee || 0; // For cash, driver might get full amount
    const companyShare = isCash ? 0 : payment.companyAmount || 0;

    // Build timeline
    const timeline = [];

    if (payment.createdAt)
      timeline.push({
        event: "payment_created",
        time: payment.createdAt,
        description: "Payment record created",
        icon: "ðŸ“",
        details: "Payment initiated for delivery",
      });

    if (payment.paidAt)
      timeline.push({
        event: "payment_received",
        time: payment.paidAt,
        description: isCash ? "Cash payment collected" : "Payment received",
        icon: isCash ? "ðŸ’µ" : "ðŸ’³",
        details: `â‚¦${payment.amount.toLocaleString()} ${isCash ? "cash collected" : "received via " + payment.paymentMethod}`,
      });

    // Add delivery events if delivery exists
    if (payment.deliveryId) {
      const delivery = await Delivery.findById(payment.deliveryId._id)
        .select("assignedAt pickedUpAt deliveredAt")
        .lean();

      if (delivery?.assignedAt)
        timeline.push({
          event: "delivery_assigned",
          time: delivery.assignedAt,
          description: "Delivery assigned to driver",
          icon: "ðŸš—",
          details: "You accepted the delivery request",
        });

      if (delivery?.pickedUpAt)
        timeline.push({
          event: "package_picked_up",
          time: delivery.pickedUpAt,
          description: "Package picked up",
          icon: "ðŸ“¦",
          details: "Package collected from customer",
        });

      if (delivery?.deliveredAt)
        timeline.push({
          event: "delivery_completed",
          time: delivery.deliveredAt,
          description: "Package delivered",
          icon: "âœ…",
          details: "Delivery completed successfully",
        });
    }

    // Add settlement event for cash payments
    if (isCash && settledToDriver && settledAt) {
      timeline.push({
        event: "payment_settled",
        time: settledAt,
        description: "Cash payment settled",
        icon: "ðŸ’°",
        details: `â‚¦${payment.amount.toLocaleString()} settled to you via ${settlementMethod || "cash"}`,
      });
    }

    // Sort timeline
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Get related payments for same customer
    const relatedPayments = await Payment.find({
      driverId: driver._id,
      customerId: payment.customerId,
      status: "successful",
      _id: { $ne: payment._id },
    })
      .sort({ paidAt: -1 })
      .limit(3)
      .select("amount paymentMethod paidAt deliveryId")
      .populate("deliveryId", "referenceId")
      .lean();

    const response = {
      success: true,
      message: "Payment details retrieved successfully",
      data: {
        payment: {
          _id: payment._id,
          reference: payment.paystackReference || `CASH-${payment._id}`,
          amount: payment.amount,
          driverShare,
          platformFee,
          companyShare,
          status: payment.status,
          paymentMethod: payment.paymentMethod,
          isCash,
          paidAt: payment.paidAt,
          currency: payment.currency || "NGN",
          settlementStatus: isCash
            ? settledToDriver
              ? "settled"
              : "pending"
            : "n/a",
          settledAt,
          settlementMethod,
          settlementNotes,
          canRequestSettlement: isCash && !settledToDriver,
        },
        delivery: payment.deliveryId
          ? {
              _id: payment.deliveryId._id,
              referenceId: payment.deliveryId.referenceId,
              status: payment.deliveryId.status,
              pickup: {
                address: payment.deliveryId.pickup?.address,
                lat: payment.deliveryId.pickup?.lat,
                lng: payment.deliveryId.pickup?.lng,
                name: payment.deliveryId.pickup?.name,
                phone: payment.deliveryId.pickup?.phone,
              },
              dropoff: {
                address: payment.deliveryId.dropoff?.address,
                lat: payment.deliveryId.dropoff?.lat,
                lng: payment.deliveryId.dropoff?.lng,
                name: payment.deliveryId.dropoff?.name,
                phone: payment.deliveryId.dropoff?.phone,
              },
              distance: payment.deliveryId.estimatedDistanceKm,
              fare: payment.deliveryId.fare,
              completedAt: payment.deliveryId.completedAt,
            }
          : null,
        customer: payment.customerId
          ? {
              _id: payment.customerId._id,
              name: payment.customerId.name,
              phone: payment.customerId.phone,
              email: payment.customerId.email,
              avatarUrl: payment.customerId.avatarUrl,
              rating: payment.customerId.rating,
            }
          : null,
        company: payment.companyId
          ? {
              _id: payment.companyId._id,
              name: payment.companyId.name,
              logo: payment.companyId.logo,
              contactPhone: payment.companyId.contactPhone,
              address: payment.companyId.address,
            }
          : null,
        timeline,
        relatedPayments: relatedPayments.map((p) => ({
          _id: p._id,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          paidAt: p.paidAt,
          deliveryReference: p.deliveryId?.referenceId || "N/A",
        })),
        actions: getDriverPaymentActions(isCash, settledToDriver),
        support: {
          contactEmail: process.env.SUPPORT_EMAIL || "support@riderr.com",
          contactPhone: process.env.SUPPORT_PHONE || "+234 800 000 0000",
          cashSettlementWindow: "Within 24 hours of delivery completion",
        },
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("âŒ Get driver payment details error:", error);

    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to get payment details",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Helper function to determine available actions for driver payment
 */
function getDriverPaymentActions(isCash, settledToDriver) {
  const actions = [];

  if (isCash) {
    if (!settledToDriver) {
      actions.push(
        {
          label: "Request Settlement",
          action: "request_settlement",
          icon: "ðŸ“²",
        },
        { label: "Contact Company", action: "contact_company", icon: "ðŸ¢" },
        {
          label: "View Delivery Details",
          action: "view_delivery",
          icon: "ðŸ“‹",
        },
      );
    } else {
      actions.push(
        { label: "Download Receipt", action: "download_receipt", icon: "ðŸ“„" },
        {
          label: "View Settlement Details",
          action: "view_settlement",
          icon: "ðŸ’°",
        },
        { label: "Report Issue", action: "report_issue", icon: "âš ï¸" },
      );
    }
  } else {
    actions.push(
      { label: "View Escrow Status", action: "view_escrow", icon: "ðŸ”’" },
      { label: "Contact Company", action: "contact_company", icon: "ðŸ¢" },
      {
        label: "Download Payment Proof",
        action: "download_proof",
        icon: "ðŸ“„",
      },
    );
  }

  return actions;
}

/**
 * @desc    Driver requests settlement for cash payment
 * @route   POST /api/payments/driver-payments/:paymentId/request-settlement
 * @access  Private (Driver)
 */
export const requestCashSettlement = async (req, res) => {
  try {
    const driverUser = req.user;
    const { paymentId } = req.params;
    const { settlementMethod, notes } = req.body;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can request settlement",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const payment = await Payment.findOne({
      _id: paymentId,
      driverId: driver._id,
      paymentMethod: "cash",
      status: "successful",
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Cash payment not found or not eligible for settlement",
      });
    }

    // Check if already settled
    if (payment.metadata?.isSettledToDriver) {
      return res.status(400).json({
        success: false,
        message: "Payment has already been settled",
      });
    }

    // Update payment metadata with settlement request
    payment.metadata = {
      ...payment.metadata,
      settlementRequested: true,
      settlementRequestedAt: new Date(),
      settlementMethod: settlementMethod || "cash",
      settlementNotes: notes || "",
    };

    // Add to audit log
    payment.auditLog.push({
      action: "settlement_requested",
      timestamp: new Date(),
      details: {
        settlementMethod,
        notes,
        requestedBy: driverUser._id,
      },
    });

    await payment.save();

    // Notify company about settlement request
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId);
      if (company) {
        // Find company owner/user to notify
        const companyUser = await User.findOne({
          $or: [{ _id: company.ownerId }, { email: company.email }],
        });

        if (companyUser) {
          await sendNotification({
            userId: companyUser._id,
            title: "ðŸ’° Settlement Request",
            message: `Driver ${driverUser.name} has requested settlement for cash payment of â‚¦${payment.amount.toLocaleString()}`,
            data: {
              type: "cash_settlement_request",
              paymentId: payment._id,
              driverId: driver._id,
              driverName: driverUser.name,
              amount: payment.amount,
              deliveryId: payment.deliveryId,
            },
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Settlement request submitted successfully",
      data: {
        paymentId: payment._id,
        amount: payment.amount,
        settlementMethod: settlementMethod || "cash",
        requestedAt: new Date(),
        nextSteps: [
          "Company will review your request",
          "Settlement typically processed within 24 hours",
          "You will be notified when payment is settled",
          "Contact support if no response within 48 hours",
        ],
      },
    });
  } catch (error) {
    console.error("âŒ Request cash settlement error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to request settlement",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Mark cash payment as settled to driver (for company use)
 * @route   POST /api/payments/driver-payments/:paymentId/mark-settled
 * @access  Private (Company)
 */
export const markCashPaymentAsSettled = async (req, res) => {
  try {
    const companyUser = req.user;

    if (!['company','company_admin'].includes(companyUser.role)) {
      return res.status(403).json({
        success: false,
        message: "Only companies can mark payments as settled",
      });
    }

    const company = await Company.findOne({ ownerId: companyUser._id });
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const { paymentId } = req.params;
    const { settlementMethod, settlementNotes } = req.body;

    const payment = await Payment.findOne({
      _id: paymentId,
      companyId: company._id,
      paymentMethod: "cash",
      status: "successful",
    }).populate("driverId", "userId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Cash payment not found or not associated with your company",
      });
    }

    // Check if already settled
    if (payment.metadata?.isSettledToDriver) {
      return res.status(400).json({
        success: false,
        message: "Payment has already been settled",
      });
    }

    // Update payment as settled
    payment.metadata = {
      ...payment.metadata,
      isSettledToDriver: true,
      settledToDriverAt: new Date(),
      settledBy: companyUser._id,
      settlementMethod: settlementMethod || "cash",
      settlementNotes: settlementNotes || "",
    };

    // Add to audit log
    payment.auditLog.push({
      action: "settled_to_driver",
      timestamp: new Date(),
      details: {
        settledBy: companyUser._id,
        settlementMethod: settlementMethod || "cash",
        notes: settlementNotes,
      },
    });

    await payment.save();

    // Notify driver
    if (payment.driverId?.userId) {
      await sendNotification({
        userId: payment.driverId.userId,
        title: "ðŸ’° Payment Settled!",
        message: `Your cash payment of â‚¦${payment.amount.toLocaleString()} has been settled by ${company.name}`,
        data: {
          type: "cash_payment_settled",
          paymentId: payment._id,
          amount: payment.amount,
          companyName: company.name,
          settlementMethod: settlementMethod || "cash",
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Payment marked as settled successfully",
      data: {
        paymentId: payment._id,
        amount: payment.amount,
        driverId: payment.driverId,
        settledAt: new Date(),
        settlementMethod: settlementMethod || "cash",
      },
    });
  } catch (error) {
    console.error("âŒ Mark cash payment as settled error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark payment as settled",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get driver earnings summary
 * @route   GET /api/payments/driver-earnings
 * @access  Private (Driver)
 */
export const getDriverEarningsSummary = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can view earnings summary",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const { period = "month" } = req.query;

    // Calculate date ranges
    const now = new Date();
    let startDate;

    switch (period) {
      case "today":
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case "week":
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case "month":
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case "year":
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 1));
    }

    // Get earnings data
    const earningsData = await Payment.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: "successful",
          paidAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$amount" },
          totalDeliveries: { $sum: 1 },
          cashEarnings: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, "$amount", 0],
            },
          },
          cashDeliveries: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, 1, 0],
            },
          },
          onlineEarnings: {
            $sum: {
              $cond: [{ $ne: ["$paymentMethod", "cash"] }, "$amount", 0],
            },
          },
          onlineDeliveries: {
            $sum: {
              $cond: [{ $ne: ["$paymentMethod", "cash"] }, 1, 0],
            },
          },
          pendingCashSettlements: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentMethod", "cash"] },
                    { $ne: ["$metadata.isSettledToDriver", true] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          pendingCashCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentMethod", "cash"] },
                    { $ne: ["$metadata.isSettledToDriver", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // Get daily earnings for chart
    const dailyEarnings = await Payment.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: "successful",
          paidAt: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$paidAt",
            },
          },
          earnings: { $sum: "$amount" },
          deliveries: { $sum: 1 },
          cashEarnings: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, "$amount", 0],
            },
          },
          onlineEarnings: {
            $sum: {
              $cond: [{ $ne: ["$paymentMethod", "cash"] }, "$amount", 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Get top earning days
    const topEarningDays = await Payment.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: "successful",
          paidAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$paidAt",
            },
          },
          earnings: { $sum: "$amount" },
          deliveries: { $sum: 1 },
        },
      },
      { $sort: { earnings: -1 } },
      { $limit: 5 },
    ]);

    const result = earningsData[0] || {
      totalEarnings: 0,
      totalDeliveries: 0,
      cashEarnings: 0,
      cashDeliveries: 0,
      onlineEarnings: 0,
      onlineDeliveries: 0,
      pendingCashSettlements: 0,
      pendingCashCount: 0,
    };

    res.status(200).json({
      success: true,
      message: "Earnings summary retrieved successfully",
      data: {
        summary: {
          ...result,
          averageEarningsPerDelivery:
            result.totalDeliveries > 0
              ? result.totalEarnings / result.totalDeliveries
              : 0,
          settlementRate:
            result.cashDeliveries > 0
              ? ((result.cashDeliveries - result.pendingCashCount) /
                  result.cashDeliveries) *
                100
              : 100,
        },
        dailyEarnings,
        topEarningDays,
        period,
        currency: "NGN",
        driverInfo: {
          name: driverUser.name,
          phone: driverUser.phone,
          rating: driver.rating || 0,
          totalDeliveries: driver.totalDeliveries || 0,
          acceptanceRate: driver.totalRequests
            ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
            : 0,
        },
      },
    });
  } catch (error) {
    console.error("âŒ Get driver earnings summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get earnings summary",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get payment for a delivery (by deliveryId)
 * @route   GET /api/payments/for-delivery/:deliveryId
 * @access  Private
 */
export const getPaymentForDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const user = req.user;

    const payment = await Payment.findOne({
      deliveryId,
      customerId: user.role === "customer" ? user._id : undefined,
    }).select("status amount paymentMethod paystackReference gatewayReference paidAt platformFee companyAmount metadata.bankTransferDetails");

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const bankDetails = payment.metadata?.bankTransferDetails;

    res.status(200).json({
      success: true,
      data: {
        paymentId: payment._id,
        reference: payment.paystackReference,
        status: payment.status,
        amount: payment.amount,
        amountFormatted: `₦${payment.amount?.toLocaleString()}`,
        paymentMethod: payment.paymentMethod,
        paidAt: payment.paidAt,
        breakdown: {
          total: payment.amount,
          platformFee: payment.platformFee,
          companyAmount: payment.companyAmount,
        },
        // Only present for bank transfer
        bankAccount: bankDetails ? {
          bankName: bankDetails.bankName,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
          narration: bankDetails.narration || "Not required",
        } : null,
        polling: payment.status !== "successful" ? {
          url: `/api/payments/status/${payment.paystackReference}`,
          intervalSeconds: 5,
        } : null,
      },
    });
  } catch (error) {
    console.error("❌ Get payment for delivery error:", error);
    res.status(500).json({ success: false, message: "Failed to get payment" });
  }
};

/**
 * @desc    Get list of Nigerian banks (for bank selection dropdown)
 * @route   GET /api/payments/banks
 * @access  Public
 */
export const getNigerianBanks = async (req, res) => {
  try {
    console.log("ðŸ¦ Fetching Nigerian banks from Paystack...");

    const result = await getBankList();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch bank list",
        error: result.message,
      });
    }

    // Format for frontend dropdown
    const banks = result.data.map((bank) => ({
      code: bank.code,
      name: bank.name,
      slug: bank.slug,
      country: bank.country,
      currency: bank.currency,
      type: bank.type,
    }));

    console.log(`âœ… Fetched ${banks.length} Nigerian banks`);

    res.status(200).json({
      success: true,
      data: banks,
      message: `${banks.length} banks available`,
    });
  } catch (error) {
    console.error("âŒ Get banks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch banks",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Get company bank account details
 * @route   GET /api/payments/company/bank-account
 * @access  Private (Company)
 */
export const getCompanyBankAccount = async (req, res) => {
  try {
    const company = await Company.findById(req.user.companyId)
      .select('name bankAccount paystackRecipientCode');

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const hasAccount = !!company.bankAccount?.accountNumber;

    res.status(200).json({
      success: true,
      data: {
        isSetup: hasAccount,
        bankAccount: hasAccount ? {
          accountNumber: `****${company.bankAccount.accountNumber.slice(-4)}`,
          accountNumberFull: company.bankAccount.accountNumber,
          accountName: company.bankAccount.accountName,
          bankCode: company.bankAccount.bankCode,
          bankName: company.bankAccount.bankName || null,
          verified: company.bankAccount.verified || false,
          verifiedAt: company.bankAccount.verifiedAt || null,
        } : null,
        setupStatus: !hasAccount
          ? 'not_setup'
          : !company.bankAccount.verified
          ? 'saved_unverified'
          : 'verified',
        message: !hasAccount
          ? 'No bank account set up. Add one to receive payments.'
          : !company.bankAccount.verified
          ? 'Bank account saved. Will be verified on first settlement.'
          : 'Bank account verified and ready to receive payments.',
      },
    });
  } catch (error) {
    console.error('❌ Get company bank account error:', error);
    res.status(500).json({ success: false, message: 'Failed to get bank account' });
  }
};

/**
 * @desc    Update company bank account
 * @route   PUT /api/payments/company/bank-account
 * @access  Private (Company)
 */
export const updateCompanyBankAccount = async (req, res) => {
  try {
    const companyUser = req.user;

    if (!['company','company_admin'].includes(companyUser.role)) {
      return res.status(403).json({ success: false, message: 'Only companies can update bank accounts' });
    }

    const { accountNumber, accountName, bankCode } = req.body;

    if (!accountNumber || !accountName || !bankCode) {
      return res.status(400).json({
        success: false,
        message: 'accountNumber, accountName and bankCode are required',
      });
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({ success: false, message: 'Account number must be exactly 10 digits' });
    }

    const company = await Company.findById(companyUser.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // Get bank name from bank list
    const banksResult = await getBankList();
    const bank = banksResult.success
      ? banksResult.data.find(b => b.code === bankCode)
      : null;

    company.bankAccount = {
      accountNumber,
      accountName,
      bankCode,
      bankName: bank?.name || company.bankAccount?.bankName || null,
      verified: false,
      verifiedAt: null,
    };
    // Reset recipient code so it gets recreated with new account
    company.paystackRecipientCode = null;
    await company.save();

    res.status(200).json({
      success: true,
      message: 'Bank account updated successfully',
      data: {
        accountNumber: `****${accountNumber.slice(-4)}`,
        accountName,
        bankCode,
        bankName: bank?.name || null,
        verified: false,
        setupStatus: 'saved_unverified',
      },
    });
  } catch (error) {
    console.error('❌ Update company bank account error:', error);
    res.status(500).json({ success: false, message: 'Failed to update bank account' });
  }
};

/**
 * @desc    Delete / remove company bank account
 * @route   DELETE /api/payments/company/bank-account
 * @access  Private (Company)
 */
export const deleteCompanyBankAccount = async (req, res) => {
  try {
    const companyUser = req.user;

    if (!['company','company_admin'].includes(companyUser.role)) {
      return res.status(403).json({ success: false, message: 'Only companies can remove bank accounts' });
    }

    const company = await Company.findById(companyUser.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    company.bankAccount = undefined;
    company.paystackRecipientCode = null;
    await company.save();

    res.status(200).json({
      success: true,
      message: 'Bank account removed successfully',
      data: { isSetup: false, setupStatus: 'not_setup' },
    });
  } catch (error) {
    console.error('❌ Delete company bank account error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove bank account' });
  }
};

/**
 * @desc    Verify bank account number (server-side, secret key never exposed)
 * @route   GET /api/payments/verify-account?accountNumber=0123456789&bankCode=057
 * @access  Private
 */
export const verifyAccountNumber = async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.query;

    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: "accountNumber and bankCode are required",
      });
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Account number must be exactly 10 digits",
      });
    }

    const { resolveAccountNumber } = await import("../utils/paymentGateway.js");
    const result = await resolveAccountNumber(accountNumber, bankCode);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || "Could not verify account. Check account number and bank.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        accountName: result.data.accountName,
        accountNumber: result.data.accountNumber,
      },
    });
  } catch (error) {
    console.error("❌ Verify account error:", error);
    res.status(500).json({ success: false, message: "Failed to verify account" });
  }
};

/**
 * @desc    Setup company bank account (simplified - no bank code needed)
 * @route   POST /api/payments/company/setup-bank-account
 * @access  Private (Company)
 */
export const setupCompanyBankAccount = async (req, res) => {
  try {
    const companyUser = req.user;

    if (!['company','company_admin'].includes(companyUser.role)) {
      return res.status(403).json({
        success: false,
        message: "Only companies can setup bank accounts",
      });
    }

    const { accountNumber, accountName, bankCode } = req.body;

    if (!accountNumber || !accountName || !bankCode) {
      return res.status(400).json({
        success: false,
        message: "Account number and account name are required",
        required: {
          accountNumber: "Your 10-digit bank account number",
          accountName: "Account holder name (as registered with bank)",
          bankCode: "code",
        },
      });
    }

    // Validate account number format (10 digits)
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Account number must be exactly 10 digits",
      });
    }

    const company = await Company.findById(companyUser.companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    console.log("ðŸ¦ Setting up bank account (no bank code needed)");
    console.log("   Account:", accountNumber);
    console.log("   Name:", accountName);

    // Save account details
    company.bankAccount = {
      accountNumber: accountNumber,
      accountName: accountName,
      bankCode: bankCode,
      verified: false, // Will be verified when first transfer is made
    };

    // Clear existing recipient code (will be created fresh)
    company.paystackRecipientCode = null;

    await company.save();

    console.log("âœ… Bank account saved");

    res.status(200).json({
      success: true,
      message: "Bank account setup successfully",
      data: {
        accountNumber: accountNumber,
        accountName: accountName,
        bankCode: bankCode,
        verified: false,
        note: "Bank will be auto-detected when first settlement is made",
        nextSteps: [
          "Bank account is saved",
          "Bank name will be detected automatically by Flutterwave",
          "First settlement will verify the account",
          "Future settlements will use this account",
        ],
      },
    });
  } catch (error) {
    console.error("âŒ Setup bank account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to setup bank account",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Helper to ensure company has bank code before settlement
 * This auto-resolves bank code if missing
 */
async function ensureCompanyBankCode(company) {
  try {
    // If bank code already exists, return it
    if (company.bankAccount?.bankCode) {
      return {
        success: true,
        bankCode: company.bankAccount.bankCode,
        bankName: company.bankAccount.bankName,
      };
    }

    // If no bank account at all, error
    if (!company.bankAccount?.accountNumber || !company.bankAccount?.bankName) {
      return {
        success: false,
        error: "Company bank account not configured",
      };
    }

    console.log(
      "ðŸ” Auto-resolving bank code for:",
      company.bankAccount.bankName,
    );

    // Fetch bank list
    const banksResult = await getBankList();
    if (!banksResult.success) {
      return {
        success: false,
        error: "Failed to fetch bank list",
      };
    }

    // Find bank by name
    const bank = banksResult.data.find(
      (b) =>
        b.name
          .toLowerCase()
          .includes(company.bankAccount.bankName.toLowerCase()) ||
        company.bankAccount.bankName
          .toLowerCase()
          .includes(b.name.toLowerCase()),
    );

    if (!bank) {
      return {
        success: false,
        error: `Bank "${company.bankAccount.bankName}" not found in Paystack`,
        hint: "Company should update bank details via /api/payments/company/setup-bank-account",
      };
    }

    // Save resolved bank code
    company.bankAccount.bankCode = bank.code;
    company.bankAccount.bankName = bank.name; // Use Paystack's official name
    await company.save();

    console.log(`âœ… Bank code auto-resolved: ${bank.code} (${bank.name})`);

    return {
      success: true,
      bankCode: bank.code,
      bankName: bank.name,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * @desc    Refund payment to customer
 * @route   POST /api/payments/refund/:paymentId
 * @access  Private (Internal use - called from cancelDelivery)
 */
export const refundPayment = async (
  paymentId,
  reason = "Delivery cancelled",
) => {
  try {
    console.log(`ðŸ’¸ [REFUND] Initiating refund for payment ${paymentId}`);

    const payment = await Payment.findById(paymentId);

    if (!payment) {
      console.error("âŒ Payment not found for refund");
      return {
        success: false,
        error: "Payment not found",
      };
    }

    // Check if already refunded
    if (payment.refund?.status === "refunded") {
      console.log("âš ï¸ Payment already refunded");
      return {
        success: true,
        alreadyRefunded: true,
        refundId: payment.refund.refundId,
        refundedAt: payment.refund.refundedAt,
      };
    }

    // Check if payment can be refunded
    if (payment.status !== "successful") {
      console.log(`âš ï¸ Payment status ${payment.status} - no refund needed`);
      return {
        success: true,
        noRefundNeeded: true,
        reason: "Payment was not successful",
      };
    }

    // Check payment method
    if (payment.paymentMethod === "cash") {
      console.log("ðŸ’µ Cash payment - no refund needed");
      return {
        success: true,
        noRefundNeeded: true,
        reason: "Cash payment - no refund needed",
      };
    }

    // âœ… Initiate Flutterwave refund
    try {
      // Need the flw_ref stored during payment for Flutterwave refunds
      const flwRef = payment.webhookData?.flw_ref || payment.metadata?.flwRef;

      if (!flwRef) {
        throw new Error(
          "flw_ref not found â€” cannot process refund automatically",
        );
      }

      const refundResult = await initiateRefund({
        flwRef,
        amount: payment.amount,
        comments: reason,
      });

      if (refundResult.success) {
        payment.refund = {
          status: "refunded",
          refundId: refundResult.data.refundId,
          amount: payment.amount,
          refundedAt: new Date(),
          reason,
        };
        payment.status = "refunded";
        payment.auditLog.push({
          action: "refunded",
          timestamp: new Date(),
          details: {
            refundId: refundResult.data.refundId,
            amount: payment.amount,
            reason,
          },
        });
        payment.markModified("refund");
        await payment.save();

        console.log(
          `âœ… Refund successful - Refund ID: ${refundResult.data.refundId}`,
        );
        return {
          success: true,
          refundId: refundResult.data.refundId,
          amount: payment.amount,
          refundedAt: payment.refund.refundedAt,
        };
      } else {
        throw new Error(refundResult.message || "Refund failed");
      }
    } catch (refundError) {
      console.error("âŒ Flutterwave refund error:", refundError.message);

      payment.refund = {
        status: "pending",
        amount: payment.amount,
        requestedAt: new Date(),
        reason,
        error: refundError.message,
      };
      payment.markModified("refund");
      await payment.save();

      return {
        success: false,
        error: refundError.message || "Refund initiation failed",
        refundPending: true,
        requiresManualRefund: true,
      };
    }
  } catch (error) {
    console.error("âŒ Refund error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * ============================================================
 * MOBILE-FIRST HELPERS - Unified Response Formatting
 * ============================================================
 */

function generatePaymentReference() {
  return `RIDERR-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function formatTransferResponse(payment, delivery) {
  const bankDetails = payment.metadata?.bankTransferDetails;

  const isInstant = bankDetails?.type === "flutterwave_virtual" || bankDetails?.type === "dedicated_virtual";
  const estimatedTime = isInstant ? "Instant (< 30 sec)" : "5-15 minutes";

  return {
    paymentId: payment._id,
    reference: payment.paystackReference,
    amount: payment.amount,
    amountFormatted: `₦${payment.amount?.toLocaleString()}`,
    paymentType: "transfer",
    status: "pending_transfer",
    bankAccount: {
      bankName: bankDetails?.bankName,
      accountNumber: bankDetails?.accountNumber,
      accountName: bankDetails?.accountName,
      narration: bankDetails?.narration || "Not required",
    },
    timeframe: {
      estimated: estimatedTime,
      type: bankDetails?.type,
    },
    instructions: [
      "Open your banking app",
      `Transfer exactly ₦${payment.amount?.toLocaleString()}`,
      "Return here — payment confirms automatically",
    ],
    polling: {
      url: `/api/payments/status/${payment.paystackReference}`,
      intervalSeconds: 5,
      timeoutMinutes: 30,
    },
    breakdown: {
      total: payment.amount,
      platformFee: payment.platformFee,
      companyAmount: payment.companyAmount,
    },
  };
}
function formatPaymentSuccessResponse(payment, delivery) {
  return {
    paymentId: payment._id,
    reference: payment.paystackReference,
    amount: payment.amount,
    amountFormatted: `₦${payment.amount?.toLocaleString()}`,
    status: "paid",
    paidAt: payment.paidAt,
    deliveryId: delivery._id,
    message: "Ready to find a driver",
  };
}
