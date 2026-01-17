// controllers/payment.controller.js - ESCROW VERSION
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Driver from '../models/riders.models.js';
import Company from '../models/company.models.js';
import User from '../models/user.models.js';
import { initializePayment, verifyPayment } from '../utils/paystack-hardcoded.js';
import { sendNotification } from '../utils/notification.js';
import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * @desc    Initialize escrow payment for delivery
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializeDeliveryPayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId } = req.body;

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
        },
      });
    }

    const amount = delivery.fare.totalFare;
    
    // Calculate split - Platform gets 10%, Company gets 90%
    const platformFeePercentage = 10;
    const platformFee = (amount * platformFeePercentage) / 100;
    const companyAmount = amount - platformFee;

    // Initialize payment with Paystack using SPLIT PAYMENT
    const paymentResult = await initializePayment({
      email: customer.email,
      amount: amount,
      subaccount: delivery.companyId.paystackSubaccountCode, // Company's subaccount
      transaction_charge: platformFee, // Your 10% platform fee
      bearer: 'account', // Company bears the transaction fee
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
      paymentType: 'escrow', // Mark as escrow payment
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
        companySubaccount: delivery.companyId.paystackSubaccountCode,
        splitType: 'subaccount',
      },
    });

    await payment.save();

    // Update delivery payment status
    delivery.payment.status = 'pending_payment';
    delivery.payment.paystackReference = paymentResult.data.reference;
    await delivery.save();

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

    // Update company earnings (money is already in their subaccount)
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId).session(session);
      if (company) {
        // Track total earnings (money goes directly to their account)
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