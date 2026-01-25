// controllers/payment.controller.js - MOBILE-FIRST ESCROW VERSION
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
 * @desc    Initialize escrow payment for delivery (Mobile & Web)
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializeDeliveryPayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, mobilePlatform } = req.body;

    if (customer.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Only customers can make payments',
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    }).populate('driverId').populate('companyId');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found',
      });
    }

    // Check if delivery has been assigned
    if (!delivery.driverId || delivery.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        message: 'Payment can only be made after driver is assigned',
      });
    }

    // Check company has paystack subaccount
    if (!delivery.companyId || !delivery.companyId.paystackSubaccountCode) {
      return res.status(400).json({
        success: false,
        message: 'Company payment account not configured. Please contact support.',
      });
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({
      deliveryId: delivery._id,
      status: { $in: ['successful', 'processing', 'pending'] },
    });

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment already initialized for this delivery',
        data: {
          paymentId: existingPayment._id,
          authorizationUrl: existingPayment.paystackAuthorizationUrl,
          reference: existingPayment.paystackReference,
          status: existingPayment.status,
          isMobile: !!mobilePlatform,
        },
      });
    }

    const amount = delivery.fare.totalFare;
    
    // Calculate split - Platform gets 10%, Company gets 90%
    const platformFeePercentage = 10;
    const platformFee = (amount * platformFeePercentage) / 100;
    const companyAmount = amount - platformFee;

    // Mobile-specific callback URL
    const userAgent = req.headers['user-agent'] || '';
    const isMobileRequest = mobilePlatform || userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone');
    
    let callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/verify`;
    
    // For mobile apps, use deep link or custom scheme
    if (isMobileRequest) {
      // Use a web URL that will redirect to app deep link
      callbackUrl = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payments/mobile-callback`;
    }

    // Initialize payment with Paystack using SPLIT PAYMENT
    const paymentResult = await initializePayment({
      email: customer.email,
      amount: amount,
      subaccount: delivery.companyId.paystackSubaccountCode,
      transaction_charge: platformFee,
      bearer: 'account',
      callback_url: callbackUrl,
      metadata: {
        deliveryId: delivery._id.toString(),
        customerId: customer._id.toString(),
        driverId: delivery.driverId._id.toString(),
        companyId: delivery.companyId._id.toString(),
        companyName: delivery.companyId.name,
        type: 'delivery_payment_escrow',
        customerName: customer.name,
        platformFee: platformFee,
        companyAmount: companyAmount,
        isMobile: isMobileRequest,
        mobilePlatform: mobilePlatform || (isMobileRequest ? 'mobile' : 'web'),
      },
    });

    if (!paymentResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to initialize payment',
        error: paymentResult.message,
      });
    }

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      driverId: delivery.driverId._id,
      companyId: delivery.companyId._id,
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
        companySubaccount: delivery.companyId.paystackSubaccountCode,
        splitType: 'subaccount',
        platform: isMobileRequest ? (mobilePlatform || 'mobile') : 'web',
        callbackUrl: callbackUrl,
      },
    });

    await payment.save();

    // Update delivery payment status
    delivery.payment.status = 'pending_payment';
    delivery.payment.paystackReference = paymentResult.data.reference;
    await delivery.save();

    // Mobile-specific response
    if (isMobileRequest) {
      return res.status(200).json({
        success: true,
        message: 'Escrow payment initialized successfully',
        data: {
          paymentId: payment._id,
          authorizationUrl: paymentResult.data.authorization_url,
          reference: paymentResult.data.reference,
          amount: amount,
          companyAmount: companyAmount,
          platformFee: platformFee,
          currency: 'NGN',
          isMobile: true,
          paymentInfo: {
            totalAmount: `₦${amount.toLocaleString()}`,
            companyReceives: `₦${companyAmount.toLocaleString()} (90%)`,
            platformFee: `₦${platformFee.toLocaleString()} (10%)`,
            companyName: delivery.companyId.name,
          },
        },
      });
    }

    // Web response
    res.status(200).json({
      success: true,
      message: 'Escrow payment initialized successfully',
      data: {
        paymentId: payment._id,
        authorizationUrl: paymentResult.data.authorization_url,
        accessCode: paymentResult.data.access_code,
        reference: paymentResult.data.reference,
        amount: amount,
        companyAmount: companyAmount,
        platformFee: platformFee,
        currency: 'NGN',
        paymentInfo: {
          totalAmount: `₦${amount.toLocaleString()}`,
          companyReceives: `₦${companyAmount.toLocaleString()} (90%)`,
          platformFee: `₦${platformFee.toLocaleString()} (10%)`,
          companyName: delivery.companyId.name,
        },
      },
    });
  } catch (error) {
    console.error('❌ Initialize escrow payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Verify escrow payment
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 */
export const verifyDeliveryPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.params;
    const user = req.user;

    console.log(`🔍 Verifying escrow payment: ${reference}`);

    // Verify with Paystack
    const verificationResult = await verifyPayment(reference);

    if (!verificationResult.success) {
      await session.abortTransaction();
      session.endSession();
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
      return res.status(200).json({
        success: true,
        message: 'Payment already verified',
        data: {
          paymentId: payment._id,
          status: payment.status,
          amount: payment.amount,
          paidAt: payment.paidAt,
          deliveryId: payment.deliveryId,
          reference: payment.paystackReference,
        },
      });
    }

    // Check if payment is successful
    if (paystackData.status !== 'success') {
      payment.status = 'failed';
      payment.failureReason = paystackData.gateway_response || 'Payment failed';
      await payment.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: 'Payment was not successful',
        data: {
          status: paystackData.status,
          message: paystackData.gateway_response,
        },
      });
    }

    // Update payment record with escrow details
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
      // Escrow split details from Paystack
      subaccountAmount: paystackData.subaccount?.amount,
      platformAmount: paystackData.fees,
    };
    payment.webhookData = paystackData;

    await payment.save({ session });

    // Update delivery
    const delivery = await Delivery.findById(payment.deliveryId).session(session);
    
    if (delivery) {
      delivery.payment.status = 'paid';
      delivery.payment.paidAt = new Date();
      delivery.payment.paystackReference = reference;
      delivery.status = 'in_transit'; // Auto-start delivery after payment
      await delivery.save({ session });
    }

    // Update company earnings
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId).session(session);
      if (company) {
        company.totalEarnings = (company.totalEarnings || 0) + payment.companyAmount;
        company.totalDeliveries = (company.totalDeliveries || 0) + 1;
        company.lastPaymentReceived = new Date();
        await company.save({ session });
      }
    }

    // Track driver delivery statistics
    if (payment.driverId) {
      const driver = await Driver.findById(payment.driverId).session(session);
      if (driver) {
        driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
        driver.lastDeliveryDate = new Date();
        await driver.save({ session });
      }
    }

    // Notify company
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId).populate('ownerId');
      if (company && company.ownerId) {
        await sendNotification({
          userId: company.ownerId._id,
          title: '💰 Payment Received',
          message: `Payment of ₦${payment.companyAmount.toLocaleString()} received in your account for delivery #${delivery._id.toString().slice(-6)}`,
          data: {
            type: 'escrow_payment_received',
            deliveryId: delivery._id,
            paymentId: payment._id,
            amount: payment.companyAmount,
            platformFee: payment.platformFee,
          },
        });
      }
    }

    // Notify driver
    if (delivery && delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).populate('userId');
      if (driver && driver.userId) {
        await sendNotification({
          userId: driver.userId._id,
          title: '✅ Payment Confirmed - Start Delivery',
          message: `Payment confirmed! You can now start the delivery. Company will pay you separately.`,
          data: {
            type: 'payment_confirmed',
            deliveryId: delivery._id,
            paymentId: payment._id,
            amount: payment.amount,
          },
        });
      }
    }

    // Notify customer
    await sendNotification({
      userId: payment.customerId,
      title: '✅ Payment Successful',
      message: `Your payment of ₦${payment.amount.toLocaleString()} was successful. Your delivery is now in progress.`,
      data: {
        type: 'payment_successful',
        deliveryId: delivery._id,
        paymentId: payment._id,
        amount: payment.amount,
      },
    });

    await session.commitTransaction();
    session.endSession();

    // Mobile-specific response
    if (payment.isMobile) {
      return res.status(200).json({
        success: true,
        message: 'Payment successful! Your delivery has started.',
        data: {
          paymentId: payment._id,
          status: payment.status,
          amount: payment.amount,
          companyAmount: payment.companyAmount,
          platformFee: payment.platformFee,
          paidAt: payment.paidAt,
          deliveryId: payment.deliveryId,
          reference: payment.paystackReference,
          deliveryStatus: 'in_transit',
          isMobile: true,
          redirectUrl: 'app://delivery/in-progress', // Deep link back to app
        },
      });
    }

    // Web response
    res.status(200).json({
      success: true,
      message: 'Escrow payment verified successfully',
      data: {
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        companyAmount: payment.companyAmount,
        platformFee: payment.platformFee,
        paidAt: payment.paidAt,
        deliveryId: payment.deliveryId,
        reference: payment.paystackReference,
        message: 'Payment sent directly to company account with 10% platform fee deducted',
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Verify escrow payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

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
          <meta http-equiv="refresh" content="3;url=app://payment/error" />
        </head>
        <body>
          <h1>Payment Error</h1>
          <p>No payment reference found. Redirecting to app...</p>
          <script>
            setTimeout(() => {
              window.location.href = 'app://payment/error';
            }, 3000);
          </script>
        </body>
        </html>
      `);
    }

    // Verify the payment
    const payment = await Payment.findOne({ paystackReference: paymentReference });
    
    if (!payment) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Not Found</title>
          <meta http-equiv="refresh" content="3;url=app://payment/not-found" />
        </head>
        <body>
          <h1>Payment Not Found</h1>
          <p>Redirecting to app...</p>
          <script>
            setTimeout(() => {
              window.location.href = 'app://payment/not-found';
            }, 3000);
          </script>
        </body>
        </html>
      `);
    }

    // Show appropriate page based on payment status
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
            .success-icon {
              font-size: 80px;
              margin-bottom: 20px;
            }
            h1 {
              font-size: 32px;
              margin-bottom: 20px;
            }
            p {
              font-size: 18px;
              margin-bottom: 30px;
              max-width: 400px;
            }
            .amount {
              font-size: 28px;
              font-weight: bold;
              margin: 20px 0;
              background: rgba(255,255,255,0.2);
              padding: 10px 30px;
              border-radius: 10px;
            }
            .button {
              background: white;
              color: #059669;
              padding: 15px 40px;
              border-radius: 25px;
              text-decoration: none;
              font-weight: bold;
              font-size: 18px;
              margin-top: 20px;
              display: inline-block;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="success-icon">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your payment has been processed successfully.</p>
          <div class="amount">₦${payment.amount.toLocaleString()}</div>
          <p>Payment reference: ${payment.paystackReference}</p>
          <div class="button" onclick="redirectToApp()">Return to App</div>
          
          <script>
            function redirectToApp() {
              // Try deep link first
              window.location.href = 'riderrapp://payment/success/${payment.paystackReference}';
              
              // Fallback to universal link
              setTimeout(() => {
                window.location.href = 'https://riderrapp.com/payment-success?reference=${payment.paystackReference}';
              }, 500);
            }
            
            // Auto-redirect after 5 seconds
            setTimeout(redirectToApp, 5000);
            
            // Listen for app visibility change
            document.addEventListener('visibilitychange', function() {
              if (document.hidden) {
                // App opened, don't redirect
                clearTimeout();
              }
            });
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
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 50px;
            }
            .spinner {
              border: 8px solid #f3f3f3;
              border-top: 8px solid #10B981;
              border-radius: 50%;
              width: 60px;
              height: 60px;
              animation: spin 1s linear infinite;
              margin: 0 auto 20px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
          <script>
            // Poll for payment status
            async function checkPayment() {
              try {
                const response = await fetch('/api/payments/verify/${paymentReference}');
                const data = await response.json();
                
                if (data.success && data.data.status === 'successful') {
                  window.location.href = 'riderrapp://payment/success/${paymentReference}';
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
        </head>
        <body>
          <div class="spinner"></div>
          <h2>Processing Payment...</h2>
          <p>Please wait while we confirm your payment.</p>
        </body>
        </html>
      `);
    } else {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Failed</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
              color: white;
            }
            .error-icon {
              font-size: 80px;
              margin-bottom: 20px;
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
          <button onclick="window.location.href = 'riderrapp://payment/cancel'">
            Cancel
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
      <body>
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
 * @desc    Check payment status (for mobile polling)
 * @route   GET /api/payments/status/:reference
 * @access  Private
 */
export const checkPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    
    const payment = await Payment.findOne({ paystackReference: reference })
      .select('status amount paidAt failureReason deliveryId');
    
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
 * @desc    Handle Paystack webhook for escrow payments
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

      // Find and update payment
      const payment = await Payment.findOne({ paystackReference: reference });

      if (payment && payment.status === 'pending') {
        payment.status = 'successful';
        payment.paidAt = new Date();
        payment.verifiedAt = new Date();
        payment.webhookData = event.data;
        
        // Store split payment info from webhook
        if (event.data.subaccount) {
          payment.metadata = {
            ...payment.metadata,
            subaccountAmount: event.data.subaccount.amount,
            platformAmount: event.data.fees,
          };
        }
        
        await payment.save();

        // Update delivery
        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery) {
          delivery.payment.status = 'paid';
          delivery.payment.paidAt = new Date();
          delivery.status = 'in_transit';
          await delivery.save();
        }

        // Update company
        if (payment.companyId) {
          const company = await Company.findById(payment.companyId);
          if (company) {
            company.totalEarnings = (company.totalEarnings || 0) + payment.companyAmount;
            company.totalDeliveries = (company.totalDeliveries || 0) + 1;
            company.lastPaymentReceived = new Date();
            await company.save();
          }
        }

        console.log('✅ Escrow payment updated via webhook:', reference);
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
export const getPaymentDetails = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const user = req.user;

    const payment = await Payment.findById(paymentId)
      .populate('customerId', 'name email phone')
      .populate('deliveryId')
      .populate({
        path: 'driverId',
        populate: { path: 'userId', select: 'name phone' },
      })
      .populate('companyId', 'name email paystackSubaccountCode');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Check access permissions
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
          percentage: {
            company: '90%',
            platform: '10%',
          },
        },
      },
    });
  } catch (error) {
    console.error('❌ Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment details',
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
        .populate('deliveryId', 'pickup dropoff status')
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