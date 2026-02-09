// controllers/payment.controller.js - IMPROVED ESCROW PAYMENT FLOW
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Driver from '../models/riders.models.js';
import Company from '../models/company.models.js';
import User from '../models/user.models.js';
import { initializePayment, verifyPayment, createSubaccount,   chargeCardViaPaystack,  
  submitOtpToPaystack,         
  createDedicatedVirtualAccount  } from '../utils/paystack-hardcoded.js';
import { sendNotification } from '../utils/notification.js';
import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * SEAMLESS PAYMENT FLOW:
 * 1. Customer creates delivery request
 * 2. Customer pays (payment held in escrow by Paystack)
 * 3. Driver accepts delivery
 * 4. Driver completes delivery
 * 5. Customer verifies completion
 * 6. Payment automatically released to company account (90%) and platform (10%)
 */

 
/**
 * @desc    Initialize delivery payment (UPDATED - supports both card and bank transfer)
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializeDeliveryPayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, paymentChannel } = req.body;

    console.log(`💳 [STEP 2] Customer ${customer._id} initializing payment for delivery ${deliveryId}`);
    console.log(`💳 Payment Channel: ${paymentChannel || 'card (default)'}`);

    if (customer.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Only customers can make payments',
      });
    }

    // ✅ VALIDATE PAYMENT CHANNEL
    const validChannels = ['card', 'bank_transfer'];
    if (!paymentChannel || !validChannels.includes(paymentChannel)) {
      return res.status(400).json({
        success: false,
        message: 'Payment channel is required. Choose either "card" or "bank_transfer"',
        validOptions: validChannels,
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    }).populate('companyId');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found',
      });
    }

    if (delivery.status !== 'created') {
      return res.status(400).json({
        success: false,
        message: `Payment can only be made for newly created deliveries. Current status: ${delivery.status}`,
      });
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({
      deliveryId: delivery._id,
      status: { $in: ['successful', 'processing', 'pending'] },
    });

    if (existingPayment) {
      console.log(`⚠️ Payment already exists for delivery ${deliveryId}`);
      
      // Return different response based on payment channel
      if (paymentChannel === 'bank_transfer' && existingPayment.metadata?.bankTransferDetails) {
        return res.status(200).json({
          success: true,
          message: 'Bank transfer already initialized. Use existing details.',
          data: {
            paymentId: existingPayment._id,
            reference: existingPayment.paystackReference,
            status: existingPayment.status,
            paymentChannel: 'bank_transfer',
            bankDetails: existingPayment.metadata.bankTransferDetails,
            amount: existingPayment.amount,
          },
        });
      }
      
      return res.status(400).json({
        success: false,
        message: 'Payment already initialized for this delivery',
        data: {
          paymentId: existingPayment._id,
          reference: existingPayment.paystackReference,
          status: existingPayment.status,
        },
      });
    }

    const amount = delivery.fare.totalFare;
    const platformFeePercentage = 10;
    const platformFee = Math.round((amount * platformFeePercentage) / 100);
    const companyAmount = amount - platformFee;

    console.log(`💰 Payment breakdown - Total: ₦${amount}, Company: ₦${companyAmount} (90%), Platform: ₦${platformFee} (10%)`);

    const reference = `RIDERR-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // ✅ HANDLE BASED ON PAYMENT CHANNEL
    if (paymentChannel === 'bank_transfer') {
      // ===== IN-APP BANK TRANSFER =====
      return await handleInAppBankTransfer(req, res, {
        customer,
        delivery,
        amount,
        platformFee,
        companyAmount,
        reference,
      });
    } else {
      // ===== IN-APP CARD PAYMENT =====
      return await handleInAppCardPayment(req, res, {
        customer,
        delivery,
        amount,
        platformFee,
        companyAmount,
        reference,
      });
    }
  } catch (error) {
    console.error('❌ Initialize payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * Helper: Handle in-app bank transfer (NO CHECKOUT URL)
 */
async function handleInAppBankTransfer(req, res, { customer, delivery, amount, platformFee, companyAmount, reference }) {
  try {
    console.log(`🏦 Handling in-app bank transfer for ${reference}`);

    let bankDetails = null;
    let paymentMethod = 'bank_transfer';
    let usesDedicatedAccount = false;

    // ✅ TRY PAYSTACK DEDICATED VIRTUAL ACCOUNT (PRODUCTION)
    if (process.env.NODE_ENV === 'production') {
      try {
        const virtualAccountResult = await createDedicatedVirtualAccount({
          email: customer.email,
          first_name: customer.name.split(' ')[0],
          last_name: customer.name.split(' ')[1] || customer.name.split(' ')[0],
          phone: customer.phone,
          preferred_bank: 'wema-bank', // or 'titan-paystack'
          metadata: {
            deliveryId: delivery._id.toString(),
            customerId: customer._id.toString(),
            reference: reference,
            amount: amount,
          },
        });

        if (virtualAccountResult.success && virtualAccountResult.data) {
          const accountData = virtualAccountResult.data;
          bankDetails = {
            bankName: accountData.bank.name,
            accountNumber: accountData.account_number,
            accountName: accountData.account_name,
            reference: reference,
            amount: amount,
            type: 'dedicated_virtual',
            expiresAt: null, // Dedicated accounts don't expire
            instructions: [
              `Transfer exactly ₦${amount.toLocaleString()} to the account below`,
              `Account is dedicated to you - no narration needed`,
              `Payment confirmed automatically`,
            ],
            dedicatedAccountId: accountData.id,
            customerCode: accountData.customer.customer_code,
          };
          usesDedicatedAccount = true;
          paymentMethod = 'bank_transfer_dedicated';
          console.log(`✅ Dedicated virtual account created: ${accountData.account_number}`);
        } else {
          throw new Error('Dedicated account creation failed');
        }
      } catch (virtualError) {
        console.warn('⚠️ Dedicated virtual account failed, using fallback:', virtualError.message);
      }
    }

    // ✅ FALLBACK TO MANUAL BANK TRANSFER
    if (!bankDetails) {
      bankDetails = {
        bankName: process.env.FALLBACK_BANK_NAME || 'Wema Bank',
        accountNumber: process.env.FALLBACK_ACCOUNT_NUMBER || '1234567890',
        accountName: process.env.FALLBACK_ACCOUNT_NAME || 'RIDERR NIG LTD',
        reference: reference,
        amount: amount,
        type: 'manual_transfer',
        narration: `Riderr - ${delivery.referenceId}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        instructions: [
          `Transfer exactly ₦${amount.toLocaleString()}`,
          `Use reference: ${reference}`,
          `Account valid for 24 hours`,
          `Send proof of payment to support if needed`,
        ],
      };
      paymentMethod = 'manual_bank_transfer';
      console.log(`💼 Using manual bank transfer with reference: ${reference}`);
    }

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      amount: amount,
      currency: 'NGN',
      paystackReference: reference,
      status: 'pending',
      paymentMethod: paymentMethod,
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: 'escrow',
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        bankTransferDetails: bankDetails,
        platform: 'in-app',
        pendingSettlement: true,
        transferType: bankDetails.type,
        usesDedicatedAccount: usesDedicatedAccount,
      },
    });

    await payment.save();

    // Update delivery
    delivery.payment.status = 'pending_payment';
    delivery.payment.method = 'bank_transfer';
    delivery.payment.paystackReference = reference;
    await delivery.save();

    console.log(`✅ Bank transfer initialized (${bankDetails.type}) - Reference: ${reference}`);

    res.status(200).json({
      success: true,
      message: 'Bank transfer details generated. Complete transfer in your banking app.',
      data: {
        paymentId: payment._id,
        reference: reference,
        amount: amount,
        paymentChannel: 'bank_transfer',
        bankDetails: {
          bankName: bankDetails.bankName,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
          amount: `₦${amount.toLocaleString()}`,
          narration: bankDetails.narration || 'Not required',
          type: bankDetails.type,
          expiresAt: bankDetails.expiresAt,
          instructions: bankDetails.instructions,
        },
        paymentBreakdown: {
          totalAmount: `₦${amount.toLocaleString()}`,
          platformFee: `₦${platformFee.toLocaleString()} (10%)`,
          companyReceives: `₦${companyAmount.toLocaleString()} (90%)`,
          escrowMessage: 'Payment held securely until delivery completion',
        },
        nextSteps: bankDetails.type === 'dedicated_virtual' ? [
          'Open your banking app',
          'Transfer to the account number above',
          'Amount must be exact',
          'Payment confirmed automatically (instant)',
        ] : [
          'Open your banking app',
          'Transfer to the account above',
          'Use exact amount and reference',
          'Keep your transfer receipt',
          'Payment verified within 5-10 minutes',
        ],
        support: {
          email: process.env.SUPPORT_EMAIL || 'support@riderr.com',
          phone: process.env.SUPPORT_PHONE || '+234 800 000 0000',
          whatsapp: process.env.SUPPORT_WHATSAPP || '+234 800 000 0000',
        },
      },
    });
  } catch (error) {
    console.error('❌ Handle in-app bank transfer error:', error);
    throw error;
  }
}

/**
 * Helper: Handle in-app card payment (NO CHECKOUT URL)
 */
async function handleInAppCardPayment(req, res, { customer, delivery, amount, platformFee, companyAmount, reference }) {
  try {
    console.log(`💳 Handling in-app card payment for ${reference}`);

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      amount: amount,
      currency: 'NGN',
      paystackReference: reference,
      status: 'pending',
      paymentMethod: 'card',
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: 'escrow',
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        platform: 'in-app',
        pendingSettlement: true,
      },
    });

    await payment.save();

    // Update delivery
    delivery.payment.status = 'pending_payment';
    delivery.payment.method = 'card';
    delivery.payment.paystackReference = reference;
    await delivery.save();

    console.log(`✅ Card payment initialized - Reference: ${reference}`);

    // Return instruction to use chargeCard endpoint
    res.status(200).json({
      success: true,
      message: 'Payment initialized. Proceed to enter card details.',
      data: {
        paymentId: payment._id,
        reference: reference,
        amount: amount,
        paymentChannel: 'card',
        nextStep: 'charge_card',
        instructions: 'Call /api/payments/charge-card with card details',
        paymentBreakdown: {
          totalAmount: `₦${amount.toLocaleString()}`,
          platformFee: `₦${platformFee.toLocaleString()} (10%)`,
          companyReceives: `₦${companyAmount.toLocaleString()} (90%)`,
          escrowMessage: 'Payment held securely until delivery completion',
        },
      },
    });
  } catch (error) {
    console.error('❌ Handle in-app card payment error:', error);
    throw error;
  }
}

/**
 * @desc    Charge card with card details (PRODUCTION READY)
 * @route   POST /api/payments/charge-card
 * @access  Private (Customer)
 */
export const chargeCard = async (req, res) => {
  try {
    const customer = req.user;
    const { reference, cardDetails } = req.body;

    console.log(`💳 Customer ${customer._id} charging card for reference ${reference}`);

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required. Call /api/payments/initialize first.',
      });
    }

    // Validate card details
    if (!cardDetails || !cardDetails.number || !cardDetails.cvv || 
        !cardDetails.expiry_month || !cardDetails.expiry_year) {
      return res.status(400).json({
        success: false,
        message: 'Complete card details required (number, cvv, expiry_month, expiry_year)',
        example: {
          number: '5061010000000000043',
          cvv: '123',
          expiry_month: '12',
          expiry_year: '25',
          pin: '1234' // Optional, for Nigerian cards
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
        message: 'Payment not found. Initialize payment first.',
      });
    }

    if (payment.status === 'successful') {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed',
      });
    }

    const amount = payment.amount;

    // ✅ PRODUCTION MODE: Use real Paystack charge
    if (process.env.NODE_ENV === 'production') {
      try {
        const chargeResult = await chargeCardViaPaystack({
          email: customer.email,
          amount: amount * 100, // Convert to kobo
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
          },
        });

        if (!chargeResult.success) {
          return res.status(400).json({
            success: false,
            message: chargeResult.message || 'Card charge failed',
            error: chargeResult.error,
          });
        }

        const chargeData = chargeResult.data;

        // Check if OTP required
        if (chargeData.status === 'send_otp') {
          payment.status = 'processing';
          payment.metadata = {
            ...payment.metadata,
            requiresOtp: true,
            cardLast4: cardDetails.number.slice(-4),
            chargeReference: chargeData.reference,
          };
          await payment.save();

          return res.status(200).json({
            success: true,
            requiresOtp: true,
            message: 'OTP sent to your phone number',
            data: {
              paymentId: payment._id,
              reference: reference,
              amount: amount,
              displayMessage: 'Please enter the OTP sent to your phone',
            },
          });
        }

        // Check if PIN required
        if (chargeData.status === 'send_pin') {
          return res.status(200).json({
            success: true,
            requiresPin: true,
            message: 'Card requires PIN',
            data: {
              paymentId: payment._id,
              reference: reference,
              amount: amount,
              displayMessage: 'Please enter your card PIN',
            },
          });
        }

        // Payment successful
        if (chargeData.status === 'success') {
          payment.status = 'successful';
          payment.paidAt = new Date();
          payment.verifiedAt = new Date();
          payment.webhookData = chargeData;
          payment.metadata = {
            ...payment.metadata,
            cardLast4: cardDetails.number.slice(-4),
            cardType: chargeData.authorization?.card_type,
            bank: chargeData.authorization?.bank,
          };
          await payment.save();

          // Update delivery
          const delivery = await Delivery.findById(payment.deliveryId);
          if (delivery) {
            delivery.payment.status = 'paid';
            delivery.payment.paidAt = new Date();
            await delivery.save();
          }

          await sendNotification({
            userId: customer._id,
            title: '✅ Payment Successful',
            message: `Your payment of ₦${amount.toLocaleString()} is confirmed. Finding a driver for you...`,
            data: {
              type: 'payment_successful',
              deliveryId: payment.deliveryId,
              paymentId: payment._id,
              amount: amount,
            },
          });

          return res.status(200).json({
            success: true,
            requiresOtp: false,
            message: 'Payment successful!',
            data: {
              paymentId: payment._id,
              reference: reference,
              amount: amount,
              deliveryId: payment.deliveryId,
            },
          });
        }

        // Unknown status
        return res.status(400).json({
          success: false,
          message: `Unexpected payment status: ${chargeData.status}`,
        });
      } catch (chargeError) {
        console.error('❌ Paystack charge error:', chargeError);
        return res.status(500).json({
          success: false,
          message: 'Failed to process card payment',
          error: chargeError.message,
        });
      }
    } else {
      // ✅ TEST MODE: Simulate payment
      const lastDigit = cardDetails.number.slice(-1);
      const requiresOtp = parseInt(lastDigit) % 2 !== 0;

      payment.status = requiresOtp ? 'processing' : 'successful';
      payment.paidAt = requiresOtp ? null : new Date();
      payment.verifiedAt = requiresOtp ? null : new Date();
      payment.metadata = {
        ...payment.metadata,
        cardLast4: cardDetails.number.slice(-4),
        requiresOtp: requiresOtp,
        testMode: true,
      };
      await payment.save();

      if (requiresOtp) {
        return res.status(200).json({
          success: true,
          requiresOtp: true,
          message: 'OTP sent (TEST MODE)',
          data: {
            paymentId: payment._id,
            reference: reference,
            amount: amount,
            testOtp: '123456',
          },
        });
      }

      // Update delivery
      const delivery = await Delivery.findById(payment.deliveryId);
      if (delivery) {
        delivery.payment.status = 'paid';
        delivery.payment.paidAt = new Date();
        await delivery.save();
      }

      return res.status(200).json({
        success: true,
        requiresOtp: false,
        message: 'Payment successful! (TEST MODE)',
        data: {
          paymentId: payment._id,
          reference: reference,
          amount: amount,
          deliveryId: payment.deliveryId,
        },
      });
    }
  } catch (error) {
    console.error('❌ Charge card error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process card payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

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
        message: 'Payment reference is required',
      });
    }

    const payment = await Payment.findOne({
      paystackReference: reference,
      customerId: customer._id,
      paymentMethod: { $in: ['bank_transfer', 'manual_bank_transfer'] },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Bank transfer payment not found',
      });
    }

    if (payment.status === 'successful') {
      return res.status(400).json({
        success: false,
        message: 'Payment already verified',
      });
    }

    // Update payment with proof
    payment.metadata = {
      ...payment.metadata,
      proofOfPayment: proofOfPayment || null,
      verificationRequested: true,
      verificationRequestedAt: new Date(),
    };
    payment.status = 'processing'; // Changed from pending to processing
    await payment.save();

    // Notify admin/support for manual verification
    // In production, you'd send this to your support team

    res.status(200).json({
      success: true,
      message: 'Transfer submitted for verification. We will confirm payment within 5-10 minutes.',
      data: {
        paymentId: payment._id,
        reference: reference,
        status: 'processing',
        estimatedVerificationTime: '5-10 minutes',
        nextSteps: [
          'We are verifying your bank transfer',
          'You will receive a notification once confirmed',
          'Estimated time: 5-10 minutes',
          'Contact support if not confirmed within 30 minutes',
        ],
      },
    });
  } catch (error) {
    console.error('❌ Verify bank transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit transfer for verification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
        message: 'Delivery not found',
      });
    }

    const amount = delivery.fare.totalFare;
    const platformFee = Math.round((amount * 10) / 100);
    const companyAmount = amount - platformFee;

    const reference = `RIDERR-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    let bankDetails = null;
    let paymentMethod = 'bank_transfer';

    try {
      // Try Paystack virtual account first
      const paymentResult = await initializePayment({
        email: customer.email,
        amount: amount,
        reference: reference,
        callback_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payments/bank-transfer-callback`,
        channels: ['bank_transfer'],
        metadata: {
          deliveryId: delivery._id.toString(),
          customerId: customer._id.toString(),
          type: 'bank_transfer_delivery',
        },
      });

      if (paymentResult.success && paymentResult.data.authorization_url) {
        bankDetails = {
          authorizationUrl: paymentResult.data.authorization_url,
          accessCode: paymentResult.data.access_code,
          reference: paymentResult.data.reference,
          type: 'paystack_virtual',
          instructions: 'Complete transfer via the authorization URL',
        };
        console.log(`✅ Paystack virtual account created for ${reference}`);
      } else {
        throw new Error('Paystack virtual account not available');
      }
    } catch (paystackError) {
      console.warn('⚠️ Paystack virtual account failed, using manual method:', paystackError.message);
      
      // Fallback to manual bank transfer
      bankDetails = {
        bankName: process.env.FALLBACK_BANK_NAME || 'Zenith Bank',
        accountNumber: process.env.FALLBACK_ACCOUNT_NUMBER || '1012345678',
        accountName: process.env.FALLBACK_ACCOUNT_NAME || 'RIDERR NIG LTD',
        reference: reference,
        amount: amount,
        type: 'manual_transfer',
        narration: `Riderr Delivery - ${delivery.referenceId}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        instructions: [
          `Transfer exactly ₦${amount.toLocaleString()}`,
          `Use "${reference}" as narration`,
          `Payment valid for 24 hours`,
        ],
      };
      paymentMethod = 'manual_bank_transfer';
    }

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      amount: amount,
      currency: 'NGN',
      paystackReference: reference,
      status: 'pending',
      paymentMethod: paymentMethod,
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: 'escrow',
      paystackAuthorizationUrl: bankDetails.authorizationUrl || null,
      paystackAccessCode: bankDetails.accessCode || null,
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        bankTransferDetails: bankDetails,
        platform: 'in-app',
        pendingSettlement: true,
        transferType: bankDetails.type,
      },
    });

    await payment.save();

    delivery.payment.status = 'pending_payment';
    delivery.payment.paystackReference = reference;
    await delivery.save();

    console.log(`✅ Bank transfer initiated (${bankDetails.type}) for delivery ${deliveryId}`);

    res.status(200).json({
      success: true,
      message: 'Bank transfer details generated successfully',
      data: {
        paymentId: payment._id,
        reference: reference,
        amount: amount,
        bankDetails: bankDetails,
        transferType: bankDetails.type,
        paymentBreakdown: {
          totalAmount: `₦${amount.toLocaleString()}`,
          platformFee: `₦${platformFee.toLocaleString()} (10%)`,
          companyReceives: `₦${companyAmount.toLocaleString()} (90%)`,
          escrowStatus: 'Payment held securely until delivery completion',
        },
        nextSteps: bankDetails.type === 'paystack_virtual' ? [
          'Click the authorization URL below',
          'Select your bank',
          'Complete the transfer',
          'Payment confirmed automatically',
        ] : [
          'Transfer to the bank account below',
          'Use exact amount and reference',
          'Keep proof of payment',
          'Contact support if needed',
        ],
        support: {
          email: process.env.SUPPORT_EMAIL || 'support@riderr.com',
          phone: process.env.SUPPORT_PHONE || '+234 800 000 0000',
          hours: '9AM - 6PM, Mon - Fri',
        },
      },
    });
  } catch (error) {
    console.error('❌ Initiate bank transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate bank transfer',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
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

    console.log(`🔍 [STEP 2b] Verifying payment: ${reference}`);

    // Verify with Paystack
    const verificationResult = await verifyPayment(reference);

    if (!verificationResult.success) {
      await session.abortTransaction();
      session.endSession();
      console.error(`❌ Paystack verification failed:`, verificationResult.message);
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        error: verificationResult.message,
      });
    }

    const paystackData = verificationResult.data;

    // Find payment record
    const payment = await Payment.findOne({ paystackReference: reference }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Payment record not found',
      });
    }

    // Check if already verified
    if (payment.status === 'successful') {
      await session.abortTransaction();
      session.endSession();
      console.log(`ℹ️ Payment already verified: ${reference}`);
      return res.status(200).json({
        success: true,
        message: 'Payment already verified',
        data: {
          paymentId: payment._id,
          status: payment.status,
          amount: payment.amount,
          paidAt: payment.paidAt,
          deliveryId: payment.deliveryId,
        },
      });
    }

    // Check payment status from Paystack
    if (paystackData.status !== 'success') {
      payment.status = 'failed';
      payment.failureReason = paystackData.gateway_response || 'Payment failed';
      await payment.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.error(`❌ Payment failed - Gateway response: ${paystackData.gateway_response}`);
      return res.status(400).json({
        success: false,
        message: 'Payment was not successful',
        data: {
          status: paystackData.status,
          message: paystackData.gateway_response,
        },
      });
    }

    // ✅ Payment successful - Update payment record
    payment.status = 'successful';
    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    payment.metadata = {
      ...payment.metadata,
      channel: paystackData.channel,
      cardType: paystackData.authorization?.card_type,
      bank: paystackData.authorization?.bank,
      lastFourDigits: paystackData.authorization?.last4,
      authorizationCode: paystackData.authorization?.authorization_code,
      // Funds held in escrow - will be released after delivery completion
      escrowStatus: 'held',
      escrowHeldAt: new Date(),
    };
    payment.webhookData = paystackData;

    await payment.save({ session });

    // Update delivery - Now PAID and ready for driver acceptance
    const delivery = await Delivery.findById(payment.deliveryId).session(session);
    
    if (delivery) {
      delivery.payment.status = 'paid'; // ✅ Payment received and held in escrow
      delivery.payment.paidAt = new Date();
      delivery.payment.paystackReference = reference;
      delivery.status = 'created'; // Keep as "created" - waiting for driver to accept
      await delivery.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Payment verified and funds held in escrow - Reference: ${reference}`);

    // Notify customer
    await sendNotification({
      userId: payment.customerId,
      title: '✅ Payment Successful',
      message: `Your payment of ₦${payment.amount.toLocaleString()} is confirmed. Finding a driver for you...`,
      data: {
        type: 'payment_successful',
        deliveryId: delivery._id,
        paymentId: payment._id,
        amount: payment.amount,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Payment successful! Funds are held securely. Looking for available drivers...',
      data: {
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        paidAt: payment.paidAt,
        deliveryId: payment.deliveryId,
        reference: payment.paystackReference,
        escrowMessage: 'Payment held securely. Will be released to company after delivery completion.',
        nextStep: 'Waiting for driver to accept your delivery request',
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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

    console.log(`📦 [STEP 5] Customer ${customer._id} verifying delivery ${deliveryId}`);

    if (!verified) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Please confirm that you received the delivery',
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    })
      .populate('driverId')
      .populate('companyId')
      .session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Delivery not found',
      });
    }

    if (!['delivered', 'completed'].includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery must be completed before verification. Current status: ${delivery.status}`,
      });
    }

    const payment = await Payment.findOne({
      deliveryId: delivery._id,
      status: 'successful',
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Payment not found or not successful',
      });
    }

    // ✅ Check if already settled using escrowDetails
    if (payment.escrowDetails?.settledToCompany) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment has already been settled',
      });
    }

    // ✅ UPDATE: Store customer verification in metadata
    payment.metadata = {
      ...payment.metadata,
      customerVerifiedAt: new Date(),
      customerVerified: true,
    };

    // Set company ID if not set
    if (!payment.companyId && delivery.companyId) {
      payment.companyId = delivery.companyId._id;
    }

    await payment.save({ session });

    // Update delivery
    delivery.status = 'completed';
    delivery.review = review;
    delivery.ratedAt = new Date();
    delivery.payment.status = 'completed';
    await delivery.save({ session });

    // ✅ SETTLEMENT LOGIC
    const settlementResult = await settlePaymentToCompany(payment, delivery.companyId);

    if (settlementResult.success) {
      // ✅ Use the schema method or update escrowDetails directly
      payment.escrowDetails.settledToCompany = true;
      payment.escrowDetails.settlementDate = new Date();
      payment.escrowDetails.paystackTransferId = settlementResult.transferId;
      
      // Also add to audit log
      payment.auditLog.push({
        action: 'settled_to_company',
        timestamp: new Date(),
        details: { 
          transferId: settlementResult.transferId,
          amount: payment.companyAmount 
        },
      });
      
      await payment.save({ session });

      // Update company earnings
      if (delivery.companyId) {
        const company = await Company.findById(delivery.companyId._id).session(session);
        if (company) {
          company.totalEarnings = (company.totalEarnings || 0) + payment.companyAmount;
          company.totalDeliveries = (company.totalDeliveries || 0) + 1;
          company.lastPaymentReceived = new Date();
          await company.save({ session });
        }
      }

      // Update driver stats
      if (delivery.driverId) {
        const driver = await Driver.findById(delivery.driverId._id).session(session);
        if (driver) {
          driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
          driver.lastDeliveryDate = new Date();
          await driver.save({ session });
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`✅ [COMPLETE] Delivery verified and payment settled - Delivery: ${deliveryId}`);

    // Notifications (with error handling)
    try {
      if (delivery.companyId) {
        const company = await Company.findById(delivery.companyId._id);
        // Check your Company schema for the correct field (userId, ownerId, owner, etc.)
        // For now, let's skip the populate and just notify based on company
        if (company) {
          await sendNotification({
            userId: company.userId || company.ownerId || company.owner, // Adjust based on your schema
            title: '💰 Payment Received',
            message: `₦${payment.companyAmount.toLocaleString()} credited to your account for delivery #${delivery.referenceId}`,
            data: {
              type: 'payment_settled',
              deliveryId: delivery._id,
              paymentId: payment._id,
              amount: payment.companyAmount,
              platformFee: payment.platformFee,
            },
          });
        }
      }

      if (delivery.driverId) {
        const driver = await Driver.findById(delivery.driverId._id).populate('userId');
        if (driver && driver.userId) {
          await sendNotification({
            userId: driver.userId._id,
            title: '✅ Delivery Completed & Payment Settled',
            message: `Delivery completed! Company received payment for delivery #${delivery.referenceId}`,
            data: {
              type: 'delivery_completed',
              deliveryId: delivery._id,
            },
          });
        }
      }
    } catch (notificationError) {
      console.error('⚠️ Notification error (non-critical):', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Delivery verified and payment settled successfully!',
      data: {
        deliveryId: delivery._id,
        paymentId: payment._id,
        status: 'completed',
        review: review,
        settlement: {
          companyReceived: `₦${payment.companyAmount.toLocaleString()}`,
          platformFee: `₦${payment.platformFee.toLocaleString()}`,
          settledAt: payment.escrowDetails.settlementDate,
          transferId: settlementResult.transferId,
          settled: payment.escrowDetails.settledToCompany,
        },
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    
    console.error('❌ Complete and settle payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete delivery and settle payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
/**
 * Helper function to settle payment to company
 * NOTE: Replace this with actual Paystack Transfer API integration
 */
async function settlePaymentToCompany(payment, company) {
  try {
    console.log(`💸 Settling ₦${payment.companyAmount} to company ${company._id}`);

    // In production, use Paystack Transfer API:
    // const transferResult = await paystackTransfer({
    //   source: 'balance',
    //   amount: payment.companyAmount * 100, // Kobo
    //   recipient: company.paystackRecipientCode,
    //   reason: `Settlement for delivery ${payment.deliveryId}`,
    //   reference: `SETTLE-${payment.paystackReference}`,
    // });

    // For now, simulate successful settlement
    const transferId = `TRF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    
    console.log(`✅ Settlement successful - Transfer ID: ${transferId}`);
    
    return {
      success: true,
      transferId: transferId,
      amount: payment.companyAmount,
      settledAt: new Date(),
    };
  } catch (error) {
    console.error('❌ Settlement error:', error);
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

    const payment = await Payment.findOne({ paystackReference: paymentReference });
    
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

    if (payment.status === 'successful') {
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
          <div class="success-icon">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your payment has been received and held securely until delivery completion.</p>
          <div class="amount">₦${payment.amount.toLocaleString()}</div>
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
    } else if (payment.status === 'pending') {
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
          <div class="error-icon">❌</div>
          <h1>Payment Failed</h1>
          <p>${payment.failureReason || 'Payment could not be processed'}</p>
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
    console.error('Mobile callback error:', error);
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
    
    const payment = await Payment.findOne({ paystackReference: reference })
      .select('status amount paidAt failureReason deliveryId metadata');
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
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
        escrowStatus: payment.metadata?.escrowStatus || 'pending',
      },
    });
  } catch (error) {
    console.error('Check payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check payment status',
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
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_a5a109269fd3e49e5d571342c97e155b8e677eac')
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature',
      });
    }

    const event = req.body;
    console.log('📨 Paystack webhook received:', event.event);

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const payment = await Payment.findOne({ paystackReference: reference });

      if (payment && payment.status === 'pending') {
        payment.status = 'successful';
        payment.paidAt = new Date();
        payment.verifiedAt = new Date();
        payment.webhookData = event.data;
        payment.metadata = {
          ...payment.metadata,
          escrowStatus: 'held',
          escrowHeldAt: new Date(),
        };
        
        await payment.save();

        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery) {
          delivery.payment.status = 'paid';
          delivery.payment.paidAt = new Date();
          await delivery.save();
        }

        console.log('✅ Payment updated via webhook:', reference);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed',
    });
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

    // ✅ ADD VALIDATION: Check if it's a valid ObjectId
    // If it's "company-payments", it's not a payment ID
    if (paymentId === 'company-payments' || paymentId === 'my-payments' || paymentId === 'initialize' || 
        paymentId === 'verify' || paymentId === 'complete-and-settle' || paymentId === 'mobile-callback' ||
        paymentId === 'status' || paymentId === 'webhook') {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
        hint: 'This appears to be a route, not a payment ID. Check your URL.',
      });
    }

    // ✅ Check if it's a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment ID format',
        data: {
          providedId: paymentId,
          exampleId: '507f1f77bcf86cd799439011',
          validRoutes: [
            '/api/payments/company-payments',
            '/api/payments/my-payments',
            '/api/payments/initialize',
            '/api/payments/verify/:reference',
          ],
        },
      });
    }

    const payment = await Payment.findById(paymentId)
      .populate('customerId', 'name email phone')
      .populate('deliveryId')
      .populate({
        path: 'driverId',
        populate: { path: 'userId', select: 'name phone' },
      })
      .populate('companyId', 'name email');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    const isCustomer = user._id.toString() === payment.customerId._id.toString();
    const isDriver = user.role === 'driver';
    const isCompanyOwner = user.role === 'company' && payment.companyId && 
                           payment.companyId.ownerId?.toString() === user._id.toString();
    const isAdmin = user.role === 'admin';

    if (!isCustomer && !isDriver && !isCompanyOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
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
          percentage: { company: '90%', platform: '10%' },
        },
        escrowInfo: {
          status: payment.metadata?.escrowStatus || 'pending',
          heldAt: payment.metadata?.escrowHeldAt,
          settledAt: payment.metadata?.settledAt,
          message: payment.metadata?.escrowStatus === 'settled'
            ? 'Payment has been released to company'
            : 'Payment is held securely in escrow',
        },
      },
    });
  } catch (error) {
    console.error('❌ Get payment details error:', error);
    
    // Handle CastError specifically
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment ID format',
        data: {
          error: error.message,
          value: error.value,
          suggestion: 'Payment ID must be a 24-character hex string like: 507f1f77bcf86cd799439011',
          validRoutes: [
            '/api/payments/company-payments',
            '/api/payments/my-payments',
            '/api/payments/initialize',
          ],
        },
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to get payment details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
    if (status && status !== 'all') {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('deliveryId', 'pickup dropoff status referenceId')
        .populate('companyId', 'name')
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
    console.error('❌ Get my payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments',
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
    
    // ✅ Update to use escrowDetails
    if (settlementStatus) {
      if (settlementStatus === 'settled') {
        query['escrowDetails.settledToCompany'] = true;
      } else if (settlementStatus === 'pending' || settlementStatus === 'held') {
        query['escrowDetails.settledToCompany'] = false;
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
          select: "pickup dropoff status referenceId createdAt completedAt review ratedAt",
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

    // ✅ Update aggregation to use escrowDetails
    const summary = await Payment.aggregate([
      { $match: { companyId: company._id, status: 'successful' } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$companyAmount" },
          totalFees: { $sum: "$platformFee" },
          totalTransactions: { $sum: 1 },
          pendingSettlements: {
            $sum: {
              $cond: [
                { $ne: ["$escrowDetails.settledToCompany", true] }, 
                1, 
                0
              ]
            }
          },
          settledAmount: {
            $sum: {
              $cond: [
                { $eq: ["$escrowDetails.settledToCompany", true] }, 
                "$companyAmount", 
                0
              ]
            }
          },
          pendingAmount: {
            $sum: {
              $cond: [
                { $ne: ["$escrowDetails.settledToCompany", true] }, 
                "$companyAmount", 
                0
              ]
            }
          },
        }
      }
    ]);

    // ✅ Update recent settlements query
    const recentSettlements = await Payment.find({
      companyId: company._id,
      status: 'successful',
      'escrowDetails.settledToCompany': true
    })
      .sort({ 'escrowDetails.settlementDate': -1 })
      .limit(5)
      .select('amount companyAmount platformFee escrowDetails paystackReference deliveryId paidAt')
      .populate('deliveryId', 'referenceId')
      .lean();

    // ✅ Update formatting to use escrowDetails
    const formattedPayments = payments.map(payment => {
      const settled = payment.escrowDetails?.settledToCompany || false;
      const escrowStatus = settled ? 'settled' : 'pending';
      const settledAt = payment.escrowDetails?.settlementDate || null;
      const transferId = payment.escrowDetails?.paystackTransferId || null;
      
      return {
        _id: payment._id,
        delivery: payment.deliveryId ? {
          _id: payment.deliveryId._id,
          referenceId: payment.deliveryId.referenceId,
          status: payment.deliveryId.status,
          pickup: payment.deliveryId.pickup?.address,
          dropoff: payment.deliveryId.dropoff?.address,
          review: payment.deliveryId.review,
          ratedAt: payment.deliveryId.ratedAt,
          driver: payment.deliveryId.driverId?.userId ? {
            name: payment.deliveryId.driverId.userId.name,
            phone: payment.deliveryId.driverId.userId.phone,
            avatarUrl: payment.deliveryId.driverId.userId.avatarUrl,
            vehicleType: payment.deliveryId.driverId.vehicleType,
            vehicleMake: payment.deliveryId.driverId.vehicleMake,
            vehicleModel: payment.deliveryId.driverId.vehicleModel,
            plateNumber: payment.deliveryId.driverId.plateNumber,
          } : null,
        } : null,
        customer: payment.customerId ? {
          name: payment.customerId.name,
          email: payment.customerId.email,
          phone: payment.customerId.phone,
          avatarUrl: payment.customerId.avatarUrl,
        } : null,
        amount: payment.amount,
        companyAmount: payment.companyAmount,
        platformFee: payment.platformFee,
        status: payment.status,
        escrowStatus: escrowStatus, // ✅ Now will show "settled"
        paidAt: payment.paidAt,
        settledAt: settledAt,
        transferId: transferId,
        paymentMethod: payment.paymentMethod,
        paystackReference: payment.paystackReference,
        currency: payment.currency || 'NGN',
      };
    });

    // ✅ Format recent settlements
    const formattedRecentSettlements = recentSettlements.map(settlement => ({
      _id: settlement._id,
      deliveryReference: settlement.deliveryId?.referenceId || 'N/A',
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
      message: `Found ${formattedPayments.length} payment${formattedPayments.length !== 1 ? 's' : ''} for ${company.name}`,
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
            status: status || 'all',
            settlementStatus: settlementStatus || 'all',
            dateRange: startDate && endDate ? { startDate, endDate } : null,
          },
          available: {
            statuses: ['all', 'pending', 'successful', 'failed'],
            settlementStatuses: ['all', 'pending', 'held', 'settling', 'settled'],
          },
        },
      },
    });
  } catch (error) {
    console.error("❌ Get company payments error:", error);
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
        select: "pickup dropoff status referenceId createdAt completedAt driverDetails driverId companyDetails estimatedDistanceKm fare",
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
          }
        ],
      })
      .lean();

    if (!payment) {
      // Check if payment exists but belongs to another company
      const existingPayment = await Payment.findById(paymentId).select("companyId").lean();
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
      settledAt: payment.metadata?.settledAt,
      bankDetails: payment.metadata?.bankDetails || company.bankDetails,
      status: payment.metadata?.escrowStatus || 'pending',
      estimatedArrival: getEstimatedArrival(payment.metadata?.escrowStatus, payment.metadata?.settledAt),
      transferReference: payment.metadata?.transferReference || `TRF-${payment.paystackReference}`,
      bankName: company.bankDetails?.bankName,
      accountNumber: company.bankDetails?.accountNumber ? 
        `****${company.bankDetails.accountNumber.slice(-4)}` : null,
      accountName: company.bankDetails?.accountName,
    };

    // Get additional settlement info from Paystack if available
    let transferInfo = null;
    if (payment.metadata?.settlementTransferId) {
      try {
        // In production, you would call Paystack Transfer API
        // transferInfo = await paystack.transfer.verify(payment.metadata.settlementTransferId);
        transferInfo = {
          status: 'success',
          recipient: company.bankDetails?.accountName || 'Company Account',
          amount: payment.companyAmount,
          fee: payment.platformFee,
          createdAt: payment.metadata?.settledAt,
          transferredAt: payment.metadata?.settledAt,
        };
      } catch (transferError) {
        console.warn("⚠️ Failed to fetch transfer details:", transferError.message);
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
      currency: payment.currency || 'NGN',
    };

    // Enhanced timeline
    const timeline = [];
    
    // Payment timeline
    if (payment.paidAt) timeline.push({
      event: 'payment_received',
      time: payment.paidAt,
      description: 'Customer payment received',
      status: 'completed',
      icon: '💳',
      details: `₦${payment.amount.toLocaleString()} from ${payment.customerId?.name || 'Customer'}`
    });
    
    if (payment.metadata?.escrowHeldAt) timeline.push({
      event: 'escrow_held',
      time: payment.metadata.escrowHeldAt,
      description: 'Funds held in escrow',
      status: 'completed',
      icon: '🔒',
      details: 'Payment secured until delivery completion'
    });
    
    // Driver acceptance timeline (from delivery)
    if (payment.deliveryId?.driverId) {
      const delivery = await Delivery.findById(payment.deliveryId._id)
        .select("assignedAt pickedUpAt deliveredAt")
        .lean();
      
      if (delivery?.assignedAt) timeline.push({
        event: 'driver_assigned',
        time: delivery.assignedAt,
        description: 'Driver accepted delivery',
        status: 'completed',
        icon: '🚗',
        details: payment.deliveryId.driverId?.userId?.name || 'Driver'
      });
      
      if (delivery?.pickedUpAt) timeline.push({
        event: 'package_picked_up',
        time: delivery.pickedUpAt,
        description: 'Package picked up',
        status: 'completed',
        icon: '📦',
        details: 'Driver collected the package'
      });
      
      if (delivery?.deliveredAt) timeline.push({
        event: 'delivery_completed',
        time: delivery.deliveredAt,
        description: 'Package delivered',
        status: 'completed',
        icon: '✅',
        details: 'Delivery completed by driver'
      });
    }
    
    // Verification and settlement timeline
    if (payment.metadata?.customerVerifiedAt) timeline.push({
      event: 'customer_verified',
      time: payment.metadata.customerVerifiedAt,
      description: 'Customer verified delivery',
      status: 'completed',
      icon: '👤',
      details: 'Customer confirmed successful delivery'
    });
    
    if (payment.metadata?.settledAt) timeline.push({
      event: 'settlement_initiated',
      time: payment.metadata.settledAt,
      description: 'Settlement to company initiated',
      status: 'completed',
      icon: '💰',
      details: `₦${payment.companyAmount.toLocaleString()} transferred to company account`
    });
    
    if (payment.metadata?.escrowStatus === 'settled') timeline.push({
      event: 'settlement_completed',
      time: payment.metadata.settledAt,
      description: 'Settlement completed',
      status: 'completed',
      icon: '🎉',
      details: 'Funds successfully deposited'
    });

    // Sort timeline
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Get related deliveries for this customer (optional)
    const relatedDeliveries = await Delivery.find({
      customerId: payment.customerId,
      companyId: company._id,
      status: 'completed',
      _id: { $ne: payment.deliveryId?._id }
    })
      .select('referenceId fare.totalFare completedAt')
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
          escrowStatus: payment.metadata?.escrowStatus || 'pending',
          paidAt: payment.paidAt,
          paymentMethod: payment.paymentMethod,
          currency: payment.currency,
        },
        delivery: payment.deliveryId ? {
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
          driver: payment.deliveryId.driverId?.userId ? {
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
          } : payment.deliveryId.driverDetails || null,
          distance: payment.deliveryId.estimatedDistanceKm,
          fare: payment.deliveryId.fare,
          completedAt: payment.deliveryId.completedAt,
          company: payment.deliveryId.companyId ? {
            name: payment.deliveryId.companyId.name,
            logo: payment.deliveryId.companyId.logo,
            contactPhone: payment.deliveryId.companyId.contactPhone,
          } : null,
        } : null,
        customer: payment.customerId ? {
          _id: payment.customerId._id,
          name: payment.customerId.name,
          email: payment.customerId.email,
          phone: payment.customerId.phone,
          avatarUrl: payment.customerId.avatarUrl,
        } : null,
        settlement: settlementDetails,
        transferInfo,
        commission: commissionBreakdown,
        timeline,
        relatedDeliveries,
        actions: getAvailableActions(payment.metadata?.escrowStatus),
        support: {
          contactEmail: process.env.SUPPORT_EMAIL || 'support@riderr.com',
          contactPhone: process.env.SUPPORT_PHONE || '+234 800 000 0000',
          disputeWindow: '24 hours after settlement',
        },
      },
    });
  } catch (error) {
    console.error("❌ Get settlement details error:", error);
    
    // Handle specific errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
  if (!escrowStatus) return 'Pending settlement';
  
  switch (escrowStatus) {
    case 'settled':
      if (settledAt) {
        const settledDate = new Date(settledAt);
        const now = new Date();
        const hoursDiff = Math.abs(now - settledDate) / 36e5;
        
        if (hoursDiff < 1) return 'Just now';
        if (hoursDiff < 24) return `${Math.floor(hoursDiff)} hours ago`;
        return `${Math.floor(hoursDiff / 24)} days ago`;
      }
      return 'Settlement completed';
      
    case 'settling':
      return 'Processing (1-2 business days)';
      
    case 'held':
      return 'After customer verification (within 24 hours)';
      
    default:
      return 'Pending';
  }
}

/**
 * Helper function to determine available actions based on settlement status
 */
function getAvailableActions(escrowStatus) {
  const actions = [];
  
  switch (escrowStatus) {
    case 'held':
      actions.push(
        { label: 'Contact Customer', action: 'contact_customer', icon: '📞' },
        { label: 'View Delivery Details', action: 'view_delivery', icon: '📋' },
        { label: 'Check Driver Status', action: 'check_driver', icon: '🚗' }
      );
      break;
      
    case 'settling':
      actions.push(
        { label: 'Track Transfer', action: 'track_transfer', icon: '📍' },
        { label: 'View Transfer Details', action: 'view_transfer', icon: '💰' },
        { label: 'Contact Support', action: 'contact_support', icon: '🆘' }
      );
      break;
      
    case 'settled':
      actions.push(
        { label: 'Download Receipt', action: 'download_receipt', icon: '📄' },
        { label: 'View Bank Statement', action: 'view_statement', icon: '🏦' },
        { label: 'Report Issue', action: 'report_issue', icon: '⚠️' }
      );
      break;
      
    default:
      actions.push(
        { label: 'Contact Support', action: 'contact_support', icon: '🆘' }
      );
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
            <span class="value">${payment.customerId?.name || 'N/A'}</span>
          </div>
          <div class="detail-row">
            <span class="label">Delivery Reference:</span>
            <span class="value">${payment.deliveryId?.referenceId || 'N/A'}</span>
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
            <span class="value">${payment.metadata?.settledAt ? new Date(payment.metadata.settledAt).toLocaleDateString() : 'N/A'}</span>
          </div>
        </div>
        
        <table>
          <tr>
            <th>Description</th>
            <th>Amount (NGN)</th>
          </tr>
          <tr>
            <td>Total Payment</td>
            <td>₦${payment.amount.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Platform Fee (${Math.round((payment.platformFee / payment.amount) * 100)}%)</td>
            <td>₦${payment.platformFee.toLocaleString()}</td>
          </tr>
          <tr>
            <td><strong>Amount Settled to Company</strong></td>
            <td><strong>₦${payment.companyAmount.toLocaleString()}</strong></td>
          </tr>
        </table>
        
        <div class="amount">₦${payment.companyAmount.toLocaleString()}</div>
        
        <div class="footer">
          <p>This is an automated receipt generated by Riderr</p>
          <p>If you have any questions, contact support@riderr.com</p>
          <p>Generated on: ${new Date().toLocaleDateString()}</p>
        </div>
      </body>
      </html>
    `;

    // Set headers for PDF download
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${payment._id}.html"`);
    
    res.send(receiptHtml);
  } catch (error) {
    console.error("❌ Download receipt error:", error);
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
        message: 'Reference and OTP are required',
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
        message: 'Payment not found',
      });
    }

    if (payment.status === 'successful') {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed',
      });
    }

    // Submit OTP to Paystack
    const otpResult = await submitOtpToPaystack({
      otp: otp,
      reference: reference,
    });

    if (!otpResult.success) {
      return res.status(400).json({
        success: false,
        message: otpResult.message || 'Invalid OTP',
        error: otpResult.error,
      });
    }

    // Update payment as successful
    payment.status = 'successful';
    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    payment.webhookData = otpResult.data;
    payment.metadata.requiresOtp = false;
    await payment.save();

    // Update delivery
    const delivery = await Delivery.findById(payment.deliveryId);
    if (delivery) {
      delivery.payment.status = 'paid';
      delivery.payment.paidAt = new Date();
      await delivery.save();
    }

    // Notify customer
    await sendNotification({
      userId: customer._id,
      title: '✅ Payment Successful',
      message: `Your payment of ₦${payment.amount.toLocaleString()} is confirmed. Finding a driver for you...`,
      data: {
        type: 'payment_successful',
        deliveryId: payment.deliveryId,
        paymentId: payment._id,
        amount: payment.amount,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Payment completed successfully!',
      data: {
        paymentId: payment._id,
        reference: reference,
        amount: payment.amount,
        deliveryId: payment.deliveryId,
      },
    });
  } catch (error) {
    console.error('❌ Submit OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
    
    if (driverUser.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Only drivers can view payment history',
      });
    }

    // Find driver
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found',
      });
    }

    const { 
      status, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 10,
      paymentMethod,
      settledStatus 
    } = req.query;

    // Build query
    const query = { driverId: driver._id };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (paymentMethod && paymentMethod !== 'all') {
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
      if (settledStatus === 'settled') {
        query['metadata.isSettledToDriver'] = true;
      } else if (settledStatus === 'pending') {
        query['metadata.isSettledToDriver'] = false;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name email phone avatarUrl')
        .populate('companyId', 'name logo contactPhone')
        .populate({
          path: 'deliveryId',
          select: 'pickup dropoff status referenceId createdAt completedAt driverDetails fare',
        })
        .sort({ paidAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Payment.countDocuments(query),
    ]);

    // Calculate earnings summary
    const summary = await Payment.aggregate([
      { $match: { driverId: driver._id, status: 'successful' } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          totalTransactions: { $sum: 1 },
          cashPayments: {
            $sum: {
              $cond: [{ $eq: ['$paymentMethod', 'cash'] }, 1, 0]
            }
          },
          cashAmount: {
            $sum: {
              $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$amount', 0]
            }
          },
          onlinePayments: {
            $sum: {
              $cond: [{ $ne: ['$paymentMethod', 'cash'] }, 1, 0]
            }
          },
          onlineAmount: {
            $sum: {
              $cond: [{ $ne: ['$paymentMethod', 'cash'] }, '$amount', 0]
            }
          },
          pendingSettlements: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $eq: ['$paymentMethod', 'cash'] },
                    { $ne: ['$metadata.isSettledToDriver', true] }
                  ]
                }, 
                1, 
                0
              ]
            }
          },
          pendingAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentMethod', 'cash'] },
                    { $ne: ['$metadata.isSettledToDriver', true] }
                  ]
                },
                '$amount',
                0
              ]
            }
          },
          settledAmount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentMethod', 'cash'] },
                    { $eq: ['$metadata.isSettledToDriver', true] }
                  ]
                },
                '$amount',
                0
              ]
            }
          },
        }
      }
    ]);

    // Get recent cash payments that need settlement
    const pendingCashSettlements = await Payment.find({
      driverId: driver._id,
      paymentMethod: 'cash',
      status: 'successful',
      'metadata.isSettledToDriver': { $ne: true }
    })
      .sort({ paidAt: -1 })
      .limit(5)
      .select('amount deliveryId paidAt metadata.companyId')
      .populate('companyId', 'name contactPhone')
      .populate('deliveryId', 'referenceId')
      .lean();

    // Format payments for response
    const formattedPayments = payments.map(payment => {
      const isCash = payment.paymentMethod === 'cash';
      const settledToDriver = payment.metadata?.isSettledToDriver || false;
      const settledAt = payment.metadata?.settledToDriverAt || null;
      const settlementMethod = payment.metadata?.settlementMethod || null;
      
      return {
        _id: payment._id,
        delivery: payment.deliveryId ? {
          _id: payment.deliveryId._id,
          referenceId: payment.deliveryId.referenceId,
          status: payment.deliveryId.status,
          pickup: payment.deliveryId.pickup?.address,
          dropoff: payment.deliveryId.dropoff?.address,
          fare: payment.deliveryId.fare,
        } : null,
        customer: payment.customerId ? {
          name: payment.customerId.name,
          phone: payment.customerId.phone,
          avatarUrl: payment.customerId.avatarUrl,
        } : null,
        company: payment.companyId ? {
          name: payment.companyId.name,
          contactPhone: payment.companyId.contactPhone,
          logo: payment.companyId.logo,
        } : null,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        isCash: isCash,
        paidAt: payment.paidAt,
        
        // Cash payment specific fields
        settlementStatus: isCash ? (settledToDriver ? 'settled' : 'pending') : 'n/a',
        settledAt: settledAt,
        settlementMethod: settlementMethod,
        canCollect: isCash && !settledToDriver,
        
        // Online payment specific fields
        escrowStatus: !isCash ? payment.metadata?.escrowStatus || 'pending' : 'n/a',
        
        currency: payment.currency || 'NGN',
        paystackReference: payment.paystackReference,
        notes: payment.metadata?.notes || '',
      };
    });

    // Format pending cash settlements
    const formattedPendingSettlements = pendingCashSettlements.map(settlement => ({
      _id: settlement._id,
      deliveryReference: settlement.deliveryId?.referenceId || 'N/A',
      amount: settlement.amount,
      companyName: settlement.companyId?.name || 'Unknown Company',
      companyPhone: settlement.companyId?.contactPhone || '',
      paidAt: settlement.paidAt,
      daysPending: Math.floor((new Date() - new Date(settlement.paidAt)) / (1000 * 60 * 60 * 24)),
    }));

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
          acceptanceRate: driver.totalRequests ? 
            Math.round((driver.acceptedRequests / driver.totalRequests) * 100) : 0,
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
            status: status || 'all',
            paymentMethod: paymentMethod || 'all',
            settlementStatus: settledStatus || 'all',
            dateRange: startDate && endDate ? { startDate, endDate } : null,
          },
          available: {
            statuses: ['all', 'pending', 'successful', 'failed'],
            paymentMethods: ['all', 'cash', 'card', 'bank_transfer'],
            settlementStatuses: ['all', 'pending', 'settled'],
          },
        },
      },
    });
  } catch (error) {
    console.error('❌ Get driver payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get driver payments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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

    if (driverUser.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Only drivers can view payment details',
      });
    }

    // Validate paymentId format
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment ID format',
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found',
      });
    }

    // Find payment that belongs to this driver
    const payment = await Payment.findOne({
      _id: paymentId,
      driverId: driver._id,
    })
      .populate('customerId', 'name email phone avatarUrl rating')
      .populate('companyId', 'name logo contactPhone address')
      .populate({
        path: 'deliveryId',
        select: 'pickup dropoff status referenceId createdAt completedAt driverDetails fare estimatedDistanceKm',
        populate: {
          path: 'driverId',
          select: 'userId vehicleType plateNumber',
          populate: {
            path: 'userId',
            select: 'name phone avatarUrl rating',
          },
        },
      })
      .lean();

    if (!payment) {
      // Check if payment exists but belongs to another driver
      const existingPayment = await Payment.findById(paymentId).select('driverId').lean();
      if (existingPayment) {
        return res.status(403).json({
          success: false,
          message: 'You don\'t have permission to view this payment',
        });
      }
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    const isCash = payment.paymentMethod === 'cash';
    const settledToDriver = payment.metadata?.isSettledToDriver || false;
    const settledAt = payment.metadata?.settledToDriverAt || null;
    const settlementMethod = payment.metadata?.settlementMethod || null;
    const settlementNotes = payment.metadata?.settlementNotes || '';

    // Calculate driver's share (for commission-based systems)
    // In your case, driver might get the full cash amount or a percentage
    const driverShare = payment.amount; // Adjust this based on your commission structure
    const platformFee = isCash ? 0 : payment.platformFee || 0; // For cash, driver might get full amount
    const companyShare = isCash ? 0 : payment.companyAmount || 0;

    // Build timeline
    const timeline = [];
    
    if (payment.createdAt) timeline.push({
      event: 'payment_created',
      time: payment.createdAt,
      description: 'Payment record created',
      icon: '📝',
      details: 'Payment initiated for delivery'
    });
    
    if (payment.paidAt) timeline.push({
      event: 'payment_received',
      time: payment.paidAt,
      description: isCash ? 'Cash payment collected' : 'Payment received',
      icon: isCash ? '💵' : '💳',
      details: `₦${payment.amount.toLocaleString()} ${isCash ? 'cash collected' : 'received via ' + payment.paymentMethod}`
    });
    
    // Add delivery events if delivery exists
    if (payment.deliveryId) {
      const delivery = await Delivery.findById(payment.deliveryId._id)
        .select('assignedAt pickedUpAt deliveredAt')
        .lean();
      
      if (delivery?.assignedAt) timeline.push({
        event: 'delivery_assigned',
        time: delivery.assignedAt,
        description: 'Delivery assigned to driver',
        icon: '🚗',
        details: 'You accepted the delivery request'
      });
      
      if (delivery?.pickedUpAt) timeline.push({
        event: 'package_picked_up',
        time: delivery.pickedUpAt,
        description: 'Package picked up',
        icon: '📦',
        details: 'Package collected from customer'
      });
      
      if (delivery?.deliveredAt) timeline.push({
        event: 'delivery_completed',
        time: delivery.deliveredAt,
        description: 'Package delivered',
        icon: '✅',
        details: 'Delivery completed successfully'
      });
    }
    
    // Add settlement event for cash payments
    if (isCash && settledToDriver && settledAt) {
      timeline.push({
        event: 'payment_settled',
        time: settledAt,
        description: 'Cash payment settled',
        icon: '💰',
        details: `₦${payment.amount.toLocaleString()} settled to you via ${settlementMethod || 'cash'}`
      });
    }

    // Sort timeline
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    // Get related payments for same customer
    const relatedPayments = await Payment.find({
      driverId: driver._id,
      customerId: payment.customerId,
      status: 'successful',
      _id: { $ne: payment._id }
    })
      .sort({ paidAt: -1 })
      .limit(3)
      .select('amount paymentMethod paidAt deliveryId')
      .populate('deliveryId', 'referenceId')
      .lean();

    const response = {
      success: true,
      message: 'Payment details retrieved successfully',
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
          currency: payment.currency || 'NGN',
          settlementStatus: isCash ? (settledToDriver ? 'settled' : 'pending') : 'n/a',
          settledAt,
          settlementMethod,
          settlementNotes,
          canRequestSettlement: isCash && !settledToDriver,
        },
        delivery: payment.deliveryId ? {
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
        } : null,
        customer: payment.customerId ? {
          _id: payment.customerId._id,
          name: payment.customerId.name,
          phone: payment.customerId.phone,
          email: payment.customerId.email,
          avatarUrl: payment.customerId.avatarUrl,
          rating: payment.customerId.rating,
        } : null,
        company: payment.companyId ? {
          _id: payment.companyId._id,
          name: payment.companyId.name,
          logo: payment.companyId.logo,
          contactPhone: payment.companyId.contactPhone,
          address: payment.companyId.address,
        } : null,
        timeline,
        relatedPayments: relatedPayments.map(p => ({
          _id: p._id,
          amount: p.amount,
          paymentMethod: p.paymentMethod,
          paidAt: p.paidAt,
          deliveryReference: p.deliveryId?.referenceId || 'N/A',
        })),
        actions: getDriverPaymentActions(isCash, settledToDriver),
        support: {
          contactEmail: process.env.SUPPORT_EMAIL || 'support@riderr.com',
          contactPhone: process.env.SUPPORT_PHONE || '+234 800 000 0000',
          cashSettlementWindow: 'Within 24 hours of delivery completion',
        },
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Get driver payment details error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment ID format',
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to get payment details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
        { label: 'Request Settlement', action: 'request_settlement', icon: '📲' },
        { label: 'Contact Company', action: 'contact_company', icon: '🏢' },
        { label: 'View Delivery Details', action: 'view_delivery', icon: '📋' }
      );
    } else {
      actions.push(
        { label: 'Download Receipt', action: 'download_receipt', icon: '📄' },
        { label: 'View Settlement Details', action: 'view_settlement', icon: '💰' },
        { label: 'Report Issue', action: 'report_issue', icon: '⚠️' }
      );
    }
  } else {
    actions.push(
      { label: 'View Escrow Status', action: 'view_escrow', icon: '🔒' },
      { label: 'Contact Company', action: 'contact_company', icon: '🏢' },
      { label: 'Download Payment Proof', action: 'download_proof', icon: '📄' }
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

    if (driverUser.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Only drivers can request settlement',
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found',
      });
    }

    const payment = await Payment.findOne({
      _id: paymentId,
      driverId: driver._id,
      paymentMethod: 'cash',
      status: 'successful',
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Cash payment not found or not eligible for settlement',
      });
    }

    // Check if already settled
    if (payment.metadata?.isSettledToDriver) {
      return res.status(400).json({
        success: false,
        message: 'Payment has already been settled',
      });
    }

    // Update payment metadata with settlement request
    payment.metadata = {
      ...payment.metadata,
      settlementRequested: true,
      settlementRequestedAt: new Date(),
      settlementMethod: settlementMethod || 'cash',
      settlementNotes: notes || '',
    };

    // Add to audit log
    payment.auditLog.push({
      action: 'settlement_requested',
      timestamp: new Date(),
      details: { 
        settlementMethod,
        notes,
        requestedBy: driverUser._id 
      },
    });

    await payment.save();

    // Notify company about settlement request
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId);
      if (company) {
        // Find company owner/user to notify
        const companyUser = await User.findOne({ 
          $or: [
            { _id: company.ownerId },
            { email: company.email }
          ] 
        });

        if (companyUser) {
          await sendNotification({
            userId: companyUser._id,
            title: '💰 Settlement Request',
            message: `Driver ${driverUser.name} has requested settlement for cash payment of ₦${payment.amount.toLocaleString()}`,
            data: {
              type: 'cash_settlement_request',
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
      message: 'Settlement request submitted successfully',
      data: {
        paymentId: payment._id,
        amount: payment.amount,
        settlementMethod: settlementMethod || 'cash',
        requestedAt: new Date(),
        nextSteps: [
          'Company will review your request',
          'Settlement typically processed within 24 hours',
          'You will be notified when payment is settled',
          'Contact support if no response within 48 hours',
        ],
      },
    });
  } catch (error) {
    console.error('❌ Request cash settlement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to request settlement',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
    
    if (companyUser.role !== 'company') {
      return res.status(403).json({
        success: false,
        message: 'Only companies can mark payments as settled',
      });
    }

    const company = await Company.findOne({ ownerId: companyUser._id });
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    const { paymentId } = req.params;
    const { settlementMethod, settlementNotes } = req.body;

    const payment = await Payment.findOne({
      _id: paymentId,
      companyId: company._id,
      paymentMethod: 'cash',
      status: 'successful',
    }).populate('driverId', 'userId');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Cash payment not found or not associated with your company',
      });
    }

    // Check if already settled
    if (payment.metadata?.isSettledToDriver) {
      return res.status(400).json({
        success: false,
        message: 'Payment has already been settled',
      });
    }

    // Update payment as settled
    payment.metadata = {
      ...payment.metadata,
      isSettledToDriver: true,
      settledToDriverAt: new Date(),
      settledBy: companyUser._id,
      settlementMethod: settlementMethod || 'cash',
      settlementNotes: settlementNotes || '',
    };

    // Add to audit log
    payment.auditLog.push({
      action: 'settled_to_driver',
      timestamp: new Date(),
      details: { 
        settledBy: companyUser._id,
        settlementMethod: settlementMethod || 'cash',
        notes: settlementNotes,
      },
    });

    await payment.save();

    // Notify driver
    if (payment.driverId?.userId) {
      await sendNotification({
        userId: payment.driverId.userId,
        title: '💰 Payment Settled!',
        message: `Your cash payment of ₦${payment.amount.toLocaleString()} has been settled by ${company.name}`,
        data: {
          type: 'cash_payment_settled',
          paymentId: payment._id,
          amount: payment.amount,
          companyName: company.name,
          settlementMethod: settlementMethod || 'cash',
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment marked as settled successfully',
      data: {
        paymentId: payment._id,
        amount: payment.amount,
        driverId: payment.driverId,
        settledAt: new Date(),
        settlementMethod: settlementMethod || 'cash',
      },
    });
  } catch (error) {
    console.error('❌ Mark cash payment as settled error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark payment as settled',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
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
    
    if (driverUser.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Only drivers can view earnings summary',
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found',
      });
    }

    const { period = 'month' } = req.query;

    // Calculate date ranges
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
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
          status: 'successful',
          paidAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          totalDeliveries: { $sum: 1 },
          cashEarnings: {
            $sum: {
              $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$amount', 0]
            }
          },
          cashDeliveries: {
            $sum: {
              $cond: [{ $eq: ['$paymentMethod', 'cash'] }, 1, 0]
            }
          },
          onlineEarnings: {
            $sum: {
              $cond: [{ $ne: ['$paymentMethod', 'cash'] }, '$amount', 0]
            }
          },
          onlineDeliveries: {
            $sum: {
              $cond: [{ $ne: ['$paymentMethod', 'cash'] }, 1, 0]
            }
          },
          pendingCashSettlements: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentMethod', 'cash'] },
                    { $ne: ['$metadata.isSettledToDriver', true] }
                  ]
                },
                '$amount',
                0
              ]
            }
          },
          pendingCashCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$paymentMethod', 'cash'] },
                    { $ne: ['$metadata.isSettledToDriver', true] }
                  ]
                },
                1,
                0
              ]
            }
          },
        }
      }
    ]);

    // Get daily earnings for chart
    const dailyEarnings = await Payment.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: 'successful',
          paidAt: { 
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
          }
        }
      },
      {
        $group: {
          _id: { 
            $dateToString: { 
              format: "%Y-%m-%d", 
              date: "$paidAt" 
            } 
          },
          earnings: { $sum: '$amount' },
          deliveries: { $sum: 1 },
          cashEarnings: {
            $sum: {
              $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$amount', 0]
            }
          },
          onlineEarnings: {
            $sum: {
              $cond: [{ $ne: ['$paymentMethod', 'cash'] }, '$amount', 0]
            }
          },
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get top earning days
    const topEarningDays = await Payment.aggregate([
      {
        $match: {
          driverId: driver._id,
          status: 'successful',
          paidAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { 
            $dateToString: { 
              format: "%Y-%m-%d", 
              date: "$paidAt" 
            } 
          },
          earnings: { $sum: '$amount' },
          deliveries: { $sum: 1 },
        }
      },
      { $sort: { earnings: -1 } },
      { $limit: 5 }
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
      message: 'Earnings summary retrieved successfully',
      data: {
        summary: {
          ...result,
          averageEarningsPerDelivery: result.totalDeliveries > 0 
            ? result.totalEarnings / result.totalDeliveries 
            : 0,
          settlementRate: result.cashDeliveries > 0
            ? ((result.cashDeliveries - result.pendingCashCount) / result.cashDeliveries) * 100
            : 100,
        },
        dailyEarnings,
        topEarningDays,
        period,
        currency: 'NGN',
        driverInfo: {
          name: driverUser.name,
          phone: driverUser.phone,
          rating: driver.rating || 0,
          totalDeliveries: driver.totalDeliveries || 0,
          acceptanceRate: driver.totalRequests ? 
            Math.round((driver.acceptedRequests / driver.totalRequests) * 100) : 0,
        },
      },
    });
  } catch (error) {
    console.error('❌ Get driver earnings summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get earnings summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};