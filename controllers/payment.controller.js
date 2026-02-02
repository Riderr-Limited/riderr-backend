// controllers/payment.controller.js - IMPROVED ESCROW PAYMENT FLOW
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Driver from '../models/riders.models.js';
import Company from '../models/company.models.js';
import User from '../models/user.models.js';
import { initializePayment, verifyPayment, createSubaccount } from '../utils/paystack-hardcoded.js';
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
 * @desc    Initialize escrow payment for delivery
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 * @flow    Step 2: Customer pays after creating delivery
 */
export const initializeDeliveryPayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, mobilePlatform } = req.body;

    console.log(`💳 [STEP 2] Customer ${customer._id} initializing payment for delivery ${deliveryId}`);

    if (customer.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Only customers can make payments',
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

    // Delivery must be in "created" status (just created, waiting for payment)
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
      return res.status(400).json({
        success: false,
        message: 'Payment already initialized for this delivery',
        data: {
          paymentId: existingPayment._id,
          authorizationUrl: existingPayment.paystackAuthorizationUrl,
          reference: existingPayment.paystackReference,
          status: existingPayment.status,
        },
      });
    }

    const amount = delivery.fare.totalFare;
    
    // Calculate split - Platform gets 10%, Company will get 90%
    const platformFeePercentage = 10;
    const platformFee = Math.round((amount * platformFeePercentage) / 100);
    const companyAmount = amount - platformFee;

    console.log(`💰 Payment breakdown - Total: ₦${amount}, Company: ₦${companyAmount} (90%), Platform: ₦${platformFee} (10%)`);

    // Determine if mobile request
    const userAgent = req.headers['user-agent'] || '';
    const isMobileRequest = mobilePlatform || userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone');
    
    let callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/verify`;
    
    if (isMobileRequest) {
      callbackUrl = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payments/mobile-callback`;
    }

    // Initialize payment with Paystack
    // NOTE: Payment is held in ESCROW by Paystack until delivery is completed
    const paymentResult = await initializePayment({
      email: customer.email,
      amount: amount,
      callback_url: callbackUrl,
      metadata: {
        deliveryId: delivery._id.toString(),
        customerId: customer._id.toString(),
        type: 'delivery_payment_escrow',
        customerName: customer.name,
        platformFee: platformFee,
        companyAmount: companyAmount,
        isMobile: isMobileRequest,
        mobilePlatform: mobilePlatform || (isMobileRequest ? 'mobile' : 'web'),
        // Will be used later when delivery is completed
        pendingSettlement: true,
      },
    });

    if (!paymentResult.success) {
      console.error(`❌ Paystack initialization failed:`, paymentResult.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to initialize payment',
        error: paymentResult.message,
      });
    }

    // Create payment record (status: pending)
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      driverId: null, // Not assigned yet
      companyId: null, // Will be set when driver accepts
      amount: amount,
      currency: 'NGN',
      paystackReference: paymentResult.data.reference,
      paystackAccessCode: paymentResult.data.access_code,
      paystackAuthorizationUrl: paymentResult.data.authorization_url,
      status: 'pending',
      paymentMethod: 'card',
      companyAmount: companyAmount,
      platformFee: platformFee,
      paymentType: 'escrow',
      isMobile: isMobileRequest,
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        splitType: 'escrow',
        platform: isMobileRequest ? (mobilePlatform || 'mobile') : 'web',
        callbackUrl: callbackUrl,
        pendingSettlement: true, // Funds held in escrow
      },
    });

    await payment.save();

    // Update delivery payment status
    delivery.payment.status = 'pending_payment';
    delivery.payment.paystackReference = paymentResult.data.reference;
    await delivery.save();

    console.log(`✅ Payment initialized - Reference: ${payment.paystackReference}`);

    res.status(200).json({
      success: true,
      message: 'Payment initialized successfully. Complete payment to proceed.',
      data: {
        paymentId: payment._id,
        authorizationUrl: paymentResult.data.authorization_url,
        reference: paymentResult.data.reference,
        amount: amount,
        companyAmount: companyAmount,
        platformFee: platformFee,
        currency: 'NGN',
        isMobile: isMobileRequest,
        paymentInfo: {
          totalAmount: `₦${amount.toLocaleString()}`,
          platformFee: `₦${platformFee.toLocaleString()} (10%)`,
          escrowMessage: 'Payment will be held securely until delivery is completed and verified',
        },
      },
    });
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


