// controllers/payment.controller.js - FIXED VERSION
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
 * @desc    Initialize payment for delivery
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
    
    // Calculate split
    const platformFeePercentage = 10; // 10% platform fee
    const platformFee = (amount * platformFeePercentage) / 100;
    const companyAmount = amount - platformFee;

    // Initialize payment with Paystack
    const paymentResult = await initializePayment({
      email: customer.email,
      amount: amount,
      metadata: {
        deliveryId: delivery._id.toString(),
        customerId: customer._id.toString(),
        driverId: delivery.driverId._id.toString(),
        companyId: delivery.companyId?._id.toString(),
        type: 'delivery_payment',
        customerName: customer.name,
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
      companyId: delivery.companyId?._id,
      amount: amount,
      currency: 'NGN',
      paystackReference: paymentResult.data.reference,
      paystackAccessCode: paymentResult.data.access_code,
      paystackAuthorizationUrl: paymentResult.data.authorization_url,
      status: 'pending',
      paymentMethod: 'card',
      companyAmount: companyAmount,
      platformFee: platformFee,
      metadata: {
        customerEmail: customer.email,
        customerName: customer.name,
      },
    });

     await payment.save();

    // Update delivery payment status
    delivery.payment.status = 'pending_payment';
    delivery.payment.paystackReference = paymentResult.data.reference;
    await delivery.save();

    res.status(200).json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        paymentId: payment._id,
        authorizationUrl: paymentResult.data.authorization_url,
        accessCode: paymentResult.data.access_code,
        reference: paymentResult.data.reference,
        amount: amount,
        currency: 'NGN',
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
 * @desc    Verify payment
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 */
export const verifyDeliveryPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.params;
    const user = req.user;

    console.log(`🔍 Verifying payment: ${reference}`);

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

    // Update payment record
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
    };
    payment.webhookData = paystackData;

    await payment.save({ session });

    // Update delivery
    const delivery = await Delivery.findById(payment.deliveryId).session(session);
    
    if (delivery) {
      delivery.payment.status = 'paid';
      delivery.payment.paidAt = new Date();
      delivery.payment.paystackReference = reference;
      await delivery.save({ session });
    }

    // Update company earnings (payment goes to company, not individual driver)
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId).session(session);
      if (company) {
        company.totalEarnings = (company.totalEarnings || 0) + payment.companyAmount;
        company.pendingPayouts = (company.pendingPayouts || 0) + payment.companyAmount;
        await company.save({ session });
      }
    }

    // Track driver delivery for statistics only (not direct earnings)
    if (payment.driverId) {
      const driver = await Driver.findById(payment.driverId).session(session);
      if (driver) {
        // Don't update driver earnings directly - company pays drivers separately
        driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
        await driver.save({ session });
      }
    }

    // Notify driver
    if (delivery && delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).populate('userId');
      if (driver && driver.userId) {
        await sendNotification({
          userId: driver.userId._id,
          title: '💰 Payment Received',
          message: `Payment of ₦${payment.amount.toLocaleString()} has been confirmed for your delivery`,
          data: {
            type: 'payment_confirmed',
            deliveryId: delivery._id,
            paymentId: payment._id,
            amount: payment.amount,
          },
        });
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        paymentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        paidAt: payment.paidAt,
        deliveryId: payment.deliveryId,
        reference: payment.paystackReference,
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
 * @desc    Handle Paystack webhook
 * @route   POST /api/payments/webhook
 * @access  Public (Paystack)
 */
export const handlePaystackWebhook = async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
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
        await payment.save();

        // Update delivery
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
      .populate('companyId', 'name');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Check access permissions
    const isCustomer = user._id.toString() === payment.customerId._id.toString();
    const isDriver = user.role === 'driver';
    const isAdmin = user.role === 'admin';

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
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