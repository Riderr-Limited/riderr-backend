// controllers/payment.controller.js
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Driver from '../models/riders.models.js';
import Company from '../models/company.models.js';
import User from '../models/user.models.js';
import paystack from '../utils/paystack.js';
import { sendNotification } from '../utils/notification.js';
import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * @desc    Test Paystack connection
 * @route   GET /api/payments/test-connection
 * @access  Private (Admin)
 */
export const testPaystackConnection = async (req, res) => {
  try {
    console.log('Testing Paystack connection...');
    
    // Test with a simple transaction verification
    const testReference = 'test_reference_123';
    const result = await paystack.verifyPayment(testReference);
    
    console.log('Paystack connection test result:', result);
    
    res.status(200).json({
      success: true,
      message: 'Paystack connection test completed',
      data: {
        hasKeys: !!(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY),
        secretKeyLength: process.env.PAYSTACK_SECRET_KEY?.length || 0,
        publicKeyLength: process.env.PAYSTACK_PUBLIC_KEY?.length || 0,
        testResult: result
      }
    });
  } catch (error) {
    console.error('Paystack connection test error:', error);
    res.status(500).json({
      success: false,
      message: 'Paystack connection test failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Initialize payment for delivery
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializePayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, callback_url } = req.body;

    console.log('=== PAYMENT INITIALIZATION STARTED ===');
    console.log('Customer:', {
      id: customer._id,
      email: customer.email,
      role: customer.role
    });
    console.log('Delivery ID:', deliveryId);

    // Validate user role
    if (customer.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Only customers can make payments',
      });
    }

    // Validate delivery ID
    if (!deliveryId || !mongoose.Types.ObjectId.isValid(deliveryId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid delivery ID is required',
      });
    }

    // Find delivery
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
    })
      .populate('driverId')
      .populate('companyId');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found or you are not authorized to pay for it',
      });
    }

    console.log('Delivery found:', {
      id: delivery._id,
      status: delivery.status,
      driverId: delivery.driverId?._id,
      companyId: delivery.companyId?._id
    });

    // Check if delivery can be paid for
    const allowedStatuses = ['assigned', 'picked_up', 'in_transit'];
    if (!allowedStatuses.includes(delivery.status)) {
      return res.status(400).json({
        success: false,
        message: `Payment can only be made when delivery is in progress. Current status: ${delivery.status}`,
        allowedStatuses,
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
        message: existingPayment.status === 'successful' 
          ? 'Payment already completed for this delivery' 
          : 'Payment already initiated for this delivery',
        data: {
          paymentId: existingPayment._id,
          status: existingPayment.status,
          reference: existingPayment.paystackReference,
          authorizationUrl: existingPayment.paystackAuthorizationUrl,
        },
      });
    }

    // Get amount
    const amount = delivery.fare?.totalFare || 0;
    
    if (amount <= 0 || amount < 100) { // Minimum 100 Naira
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery amount. Amount must be at least ₦100',
        amount,
      });
    }

    console.log('Amount to charge:', amount);

    // Calculate fees
    const platformFeePercentage = parseInt(process.env.PLATFORM_FEE_PERCENTAGE) || 10;
    const platformFee = (amount * platformFeePercentage) / 100;
    const companyAmount = amount - platformFee;

    console.log('Fee breakdown:', {
      amount,
      platformFeePercentage: `${platformFeePercentage}%`,
      platformFee,
      companyAmount
    });

    // Prepare metadata
    const metadata = {
      deliveryId: delivery._id.toString(),
      customerId: customer._id.toString(),
      customerName: customer.name,
      customerEmail: customer.email,
      driverId: delivery.driverId?._id?.toString(),
      companyId: delivery.companyId?._id?.toString(),
      type: 'delivery_payment',
      deliveryReference: delivery.referenceId,
      platformFee,
      companyAmount,
    };

    console.log('Initializing Paystack payment...');

    // Initialize payment with Paystack
    const paymentResult = await paystack.initializePayment({
      email: customer.email,
      amount: amount,
      callback_url: callback_url || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/verify?deliveryId=${deliveryId}`,
      metadata: metadata,
    });

    console.log('Paystack initialization response:', paymentResult);

    if (!paymentResult.success) {
      console.error('Paystack initialization failed:', paymentResult.error);
      
      return res.status(400).json({
        success: false,
        message: 'Failed to initialize payment with payment gateway',
        error: paymentResult.message || 'Payment gateway error',
        details: process.env.NODE_ENV === 'development' ? paymentResult.error : undefined,
      });
    }

    // Create payment record
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      driverId: delivery.driverId?._id,
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
      platformFeePercentage: platformFeePercentage,
      metadata: metadata,
    });

    await payment.save();

    // Update delivery payment status
    delivery.payment = {
      method: 'card',
      status: 'pending_payment',
      paystackReference: paymentResult.data.reference,
      amount: amount,
      paymentId: payment._id,
    };
    await delivery.save();

    console.log('✅ Payment initialized successfully:', {
      paymentId: payment._id,
      reference: payment.paystackReference,
      amount: amount
    });

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
        deliveryId: delivery._id,
        deliveryStatus: delivery.status,
        metadata: metadata,
      },
    });
  } catch (error) {
    console.error('❌ Initialize payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * @desc    Verify payment
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 */
export const verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reference } = req.params;
    const user = req.user;

    console.log(`🔍 Verifying payment reference: ${reference}`);

    if (!reference) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required',
      });
    }

    // Verify with Paystack
    const verificationResult = await paystack.verifyPayment(reference);

    if (!verificationResult.success) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
        error: verificationResult.message,
        details: process.env.NODE_ENV === 'development' ? verificationResult.error : undefined,
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

    // Check user permissions
    const isCustomer = user._id.toString() === payment.customerId.toString();
    const isDriver = user.role === 'driver';
    const isAdmin = user.role === 'admin';
    const isCompanyAdmin = user.role === 'company_admin';

    if (!isCustomer && !isDriver && !isAdmin && !isCompanyAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to verify this payment',
      });
    }

    // Check if payment is already successful
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

    // Check payment status from Paystack
    if (paystackData.status !== 'success') {
      payment.status = 'failed';
      payment.failureReason = paystackData.gateway_response || 'Payment failed';
      payment.verifiedAt = new Date();
      await payment.save({ session });

      // Update delivery
      const delivery = await Delivery.findById(payment.deliveryId).session(session);
      if (delivery) {
        delivery.payment.status = 'failed';
        await delivery.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      return res.status(400).json({
        success: false,
        message: 'Payment was not successful',
        data: {
          status: paystackData.status,
          message: paystackData.gateway_response,
          paymentId: payment._id,
          reference: reference,
        },
      });
    }

    // Update successful payment
    payment.status = 'successful';
    payment.paidAt = new Date(paystackData.paid_at || new Date());
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

    // Update driver earnings
    if (payment.driverId) {
      const driver = await Driver.findById(payment.driverId).session(session);
      if (driver) {
        driver.earnings = (driver.earnings || 0) + payment.companyAmount;
        driver.totalEarnings = (driver.totalEarnings || 0) + payment.companyAmount;
        await driver.save({ session });

        // Notify driver
        await sendNotification({
          userId: driver.userId,
          title: '💰 Payment Received',
          message: `Payment of ₦${payment.companyAmount.toLocaleString()} has been confirmed for your delivery`,
          data: {
            type: 'payment_confirmed',
            deliveryId: delivery._id,
            paymentId: payment._id,
            amount: payment.companyAmount,
          },
        });
      }
    }

    // Update company earnings
    if (payment.companyId) {
      const company = await Company.findById(payment.companyId).session(session);
      if (company) {
        company.totalEarnings = (company.totalEarnings || 0) + payment.companyAmount;
        company.availableBalance = (company.availableBalance || 0) + payment.companyAmount;
        await company.save({ session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    console.log('✅ Payment verified successfully:', reference);

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
        driverEarnings: payment.companyAmount,
        platformFee: payment.platformFee,
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
export const handlePaymentWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      console.warn('Missing Paystack signature in webhook');
      return res.status(401).json({
        success: false,
        message: 'Missing webhook signature',
      });
    }

    const payload = req.body;
    
    // Verify webhook signature
    const isValid = paystack.verifyWebhookSignature(payload, signature);
    
    if (!isValid) {
      console.warn('Invalid webhook signature:', signature);
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature',
      });
    }

    console.log('📨 Paystack webhook received:', {
      event: payload.event,
      reference: payload.data?.reference,
      timestamp: new Date().toISOString(),
    });

    if (payload.event === 'charge.success') {
      const reference = payload.data.reference;
      
      // Process payment in background
      setTimeout(async () => {
        try {
          const payment = await Payment.findOne({ paystackReference: reference });
          
          if (payment && payment.status === 'pending') {
            // Verify with Paystack again to be sure
            const verification = await paystack.verifyPayment(reference);
            
            if (verification.success && verification.data.status === 'success') {
              const session = await mongoose.startSession();
              session.startTransaction();
              
              try {
                payment.status = 'successful';
                payment.paidAt = new Date(verification.data.paid_at || new Date());
                payment.verifiedAt = new Date();
                payment.webhookData = payload.data;
                await payment.save({ session });
                
                // Update delivery
                const delivery = await Delivery.findById(payment.deliveryId).session(session);
                if (delivery) {
                  delivery.payment.status = 'paid';
                  delivery.payment.paidAt = new Date();
                  await delivery.save({ session });
                }
                
                await session.commitTransaction();
                session.endSession();
                
                console.log('✅ Payment processed via webhook:', reference);
              } catch (transactionError) {
                await session.abortTransaction();
                session.endSession();
                console.error('Webhook transaction error:', transactionError);
              }
            }
          }
        } catch (error) {
          console.error('Webhook processing error:', error);
        }
      }, 0);
    }

    res.status(200).send('Webhook processed');
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
      .populate('deliveryId', 'referenceId status pickup dropoff fare')
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

    // Check access permissions
    const isCustomer = user._id.toString() === payment.customerId._id.toString();
    const isDriver = user.role === 'driver';
    const isAdmin = user.role === 'admin';
    const isCompanyAdmin = user.role === 'company_admin';

    if (!isCustomer && !isDriver && !isAdmin && !isCompanyAdmin) {
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
 * @route   GET /api/payments/my
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

    // Calculate totals
    const totals = await Payment.aggregate([
      { $match: { customerId: customer._id } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$amount' },
          successfulPayments: { $sum: { $cond: [{ $eq: ['$status', 'successful'] }, 1, 0] } },
          pendingPayments: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      summary: totals[0] || { totalSpent: 0, successfulPayments: 0, pendingPayments: 0 },
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
 * @desc    Get company payments
 * @route   GET /api/payments/company/:companyId
 * @access  Private (Company Admin, Admin)
 */
export const getCompanyPayments = async (req, res) => {
  try {
    const user = req.user;
    const { companyId } = req.params;
    const { page = 1, limit = 10, status, startDate, endDate } = req.query;

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found',
      });
    }

    // Verify user permissions
    const isCompanyAdmin = user.role === 'company_admin';
    const isAdmin = user.role === 'admin';

    if (!isCompanyAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view company payments',
      });
    }

    // If user is company admin, verify they belong to this company
    if (isCompanyAdmin) {
      const userCompany = await Company.findOne({
        _id: companyId,
        'admins.userId': user._id
      });
      if (!userCompany) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this company\'s payments',
        });
      }
    }

    // Build query
    const query = { companyId: companyId };
    if (status && status !== 'all') {
      query.status = status;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name email phone')
        .populate('deliveryId', 'status pickup dropoff fare')
        .populate({
          path: 'driverId',
          populate: { path: 'userId', select: 'name phone' },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(query),
    ]);

    // Calculate company earnings
    const earnings = await Payment.aggregate([
      { $match: { companyId: company._id, status: 'successful' } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$companyAmount' },
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalPlatformFees: { $sum: '$platformFee' },
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      company: {
        id: company._id,
        name: company.name,
        totalEarnings: company.totalEarnings || 0,
        availableBalance: company.availableBalance || 0,
      },
      earnings: earnings[0] || {
        totalEarnings: 0,
        totalPayments: 0,
        totalAmount: 0,
        totalPlatformFees: 0,
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('❌ Get company payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get company payments',
    });
  }
};
/**
 * @desc    Get payment statistics (Admin)
 * @route   GET /api/payments/admin/stats
 * @access  Private (Admin)
 */
export const getPaymentStats = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [todayStats, weekStats, monthStats, allTimeStats] = await Promise.all([
      // Today's stats
      Payment.aggregate([
        {
          $match: {
            status: 'successful',
            paidAt: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            platformFees: { $sum: '$platformFee' },
          }
        }
      ]),
      
      // Week's stats
      Payment.aggregate([
        {
          $match: {
            status: 'successful',
            paidAt: { $gte: weekAgo }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            platformFees: { $sum: '$platformFee' },
          }
        }
      ]),
      
      // Month's stats
      Payment.aggregate([
        {
          $match: {
            status: 'successful',
            paidAt: { $gte: monthAgo }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            platformFees: { $sum: '$platformFee' },
          }
        }
      ]),
      
      // All time stats
      Payment.aggregate([
        {
          $match: {
            status: 'successful'
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: '$amount' },
            platformFees: { $sum: '$platformFee' },
          }
        }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        today: todayStats[0] || { count: 0, amount: 0, platformFees: 0 },
        week: weekStats[0] || { count: 0, amount: 0, platformFees: 0 },
        month: monthStats[0] || { count: 0, amount: 0, platformFees: 0 },
        allTime: allTimeStats[0] || { count: 0, amount: 0, platformFees: 0 },
      }
    });
  } catch (error) {
    console.error('❌ Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment statistics',
    });
  }
};

/**
 * @desc    Get driver payments
 * @route   GET /api/payments/driver/my
 * @access  Private (Driver)
 */
export const getDriverPayments = async (req, res) => {
  try {
    const driverUser = req.user;
    const { page = 1, limit = 10, status } = req.query;

    // Get driver profile
    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found',
      });
    }

    const query = { driverId: driver._id };
    if (status && status !== 'all') {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('deliveryId', 'pickup dropoff status referenceId')
        .populate('customerId', 'name phone')
        .populate('companyId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(query),
    ]);

    // Calculate driver earnings
    const earnings = await Payment.aggregate([
      { $match: { driverId: driver._id, status: 'successful' } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$companyAmount' },
          totalDeliveries: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageEarnings: { $avg: '$companyAmount' },
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      driver: {
        id: driver._id,
        name: driverUser.name,
        earnings: driver.earnings || 0,
      },
      earnings: earnings[0] || {
        totalEarnings: 0,
        totalDeliveries: 0,
        totalAmount: 0,
        averageEarnings: 0,
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('❌ Get driver payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get driver payments',
    });
  }
};

/**
 * @desc    Get payment history with filters
 * @route   GET /api/payments/customer/history
 * @access  Private (Customer)
 */
export const getPaymentHistory = async (req, res) => {
  try {
    const customer = req.user;
    const { startDate, endDate, minAmount, maxAmount, status } = req.query;

    const query = { customerId: customer._id };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }

    const payments = await Payment.find(query)
      .populate('deliveryId', 'pickup dropoff status')
      .populate('companyId', 'name')
      .sort({ createdAt: -1 })
      .limit(50);

    // Calculate summary
    const summary = await Payment.aggregate([
      { $match: { customerId: customer._id } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$amount' },
          averagePayment: { $avg: '$amount' },
          paymentCount: { $sum: 1 },
          successfulPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'successful'] }, 1, 0] }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      summary: summary[0] || {
        totalSpent: 0,
        averagePayment: 0,
        paymentCount: 0,
        successfulPayments: 0,
      },
    });
  } catch (error) {
    console.error('❌ Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
    });
  }
};/**
 * @desc    Get all payments (admin) - Placeholder
 * @route   GET /api/payments/admin/all
 * @access  Private (Admin)
 */
export const getCustomerPayments = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    // This is a placeholder - implement based on your needs
    const payments = await Payment.find({})
      .populate('customerId', 'name email')
      .populate('companyId', 'name')
      .limit(50)
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error('Get customer payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payments',
    });
  }
};

/**
 * @desc    Get disputes - Placeholder
 * @route   GET /api/payments/admin/disputes
 * @access  Private (Admin)
 */
export const getDisputes = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    // Placeholder - implement dispute logic
    res.status(200).json({
      success: true,
      data: [],
      message: 'Disputes feature not yet implemented',
    });
  } catch (error) {
    console.error('Get disputes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get disputes',
    });
  }
};

/**
 * @desc    Release escrow funds - Placeholder
 */
export const releaseEscrowFunds = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Escrow release feature not yet implemented',
  });
};

/**
 * @desc    Refund escrow funds - Placeholder
 */
export const refundEscrowFunds = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Escrow refund feature not yet implemented',
  });
};

/**
 * @desc    Raise dispute - Placeholder
 */
export const raiseDispute = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Dispute feature not yet implemented',
  });
};

/**
 * @desc    Resolve dispute - Placeholder
 */
export const resolveDispute = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Dispute resolution feature not yet implemented',
  });
};

// Add to payment.controller.js
export const checkPaystackConfig = async (req, res) => {
  try {
    const config = {
      NODE_ENV: process.env.NODE_ENV,
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY 
        ? `${process.env.PAYSTACK_SECRET_KEY.substring(0, 10)}...${process.env.PAYSTACK_SECRET_KEY.substring(process.env.PAYSTACK_SECRET_KEY.length - 5)}`
        : 'NOT SET',
      PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY 
        ? `${process.env.PAYSTACK_PUBLIC_KEY.substring(0, 10)}...`
        : 'NOT SET',
      PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET 
        ? 'SET' : 'NOT SET',
      secretKeyLength: process.env.PAYSTACK_SECRET_KEY?.length || 0,
      publicKeyLength: process.env.PAYSTACK_PUBLIC_KEY?.length || 0,
    };

    console.log('Paystack Configuration:', config);

    res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Config check error:', error);
    res.status(500).json({
      success: false,
      message: 'Configuration check failed',
      error: error.message,
    });
  }
};

 