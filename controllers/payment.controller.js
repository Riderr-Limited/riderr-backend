// controllers/payment.controller.js
import PaymentService from '../services/payments.services.js';
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Company from '../models/company.models.js';
import Driver from '../models/riders.models.js';
import User from '../models/user.models.js';
import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * @desc    Initialize payment for delivery - Pay to Company
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializePayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, amount, email, callback_url, companyId } = req.body;

    if (!deliveryId || !amount || !email || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Delivery ID, amount, email, and company ID are required'
      });
    }

    // Verify delivery exists and belongs to customer
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id
    }).populate('driverId', 'companyId');

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if driver is assigned to this company
    if (delivery.driverId && delivery.driverId.companyId) {
      if (delivery.driverId.companyId.toString() !== companyId) {
        return res.status(400).json({
          success: false,
          message: 'Driver is not associated with this company'
        });
      }
    }

    // Check if delivery can be paid for
    const allowedStatuses = ['created', 'assigned', 'picked_up'];
    if (!allowedStatuses.includes(delivery.status)) {
      return res.status(400).json({
        success: false,
        message: `Payment cannot be initiated for delivery in ${delivery.status} status`
      });
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({ deliveryId });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment already initialized for this delivery'
      });
    }

    // Verify amount matches delivery fare
    const deliveryTotal = delivery.fare?.totalFare || 0;
    const requestedAmount = parseFloat(amount);
    
    if (Math.abs(deliveryTotal - requestedAmount) > 100) {
      return res.status(400).json({
        success: false,
        message: `Amount must be approximately ${deliveryTotal}`
      });
    }

    const result = await PaymentService.initializePayment({
      deliveryId,
      customerId: customer._id,
      companyId: companyId,
      amount: requestedAmount,
      email,
      callback_url,
      metadata: {
        customerName: customer.name,
        customerId: customer._id,
        deliveryId: delivery._id,
        companyId: companyId,
        companyName: company.name,
        driverId: delivery.driverId?._id || null,
        deliveryType: delivery.itemDetails?.type || 'parcel',
        platform: req.headers['x-platform'] || 'web',
        userAgent: req.headers['user-agent']
      }
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Initialize payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error initializing payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Verify payment webhook (Paystack)
 * @route   POST /api/payments/webhook
 * @access  Public (Paystack calls this)
 */
export const handlePaymentWebhook = async (req, res) => {
  try {
    // Log webhook for debugging
    console.log('Payment webhook received:', {
      event: req.body.event,
      reference: req.body.data?.reference,
      timestamp: new Date().toISOString()
    });

    const signature = req.headers['x-paystack-signature'];
    
    if (!signature) {
      console.warn('Missing Paystack signature');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized webhook'
      });
    }

    const payload = req.body;

    // Verify webhook signature
    const isValid = await PaymentService.verifyWebhookSignature(payload, signature);
    
    if (!isValid) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({
        success: false,
        message: 'Invalid signature'
      });
    }

    // Process webhook
    const result = await PaymentService.handleWebhook(payload);

    if (result.success) {
      console.log('Webhook processed successfully:', result.message);
      res.status(200).send('Webhook processed');
    } else {
      console.error('Webhook processing failed:', result.message);
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).send('Webhook processing error');
  }
};

/**
 * @desc    Verify payment manually
 * @route   GET /api/payments/verify/:reference
 * @access  Private
 */
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const user = req.user;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    // Find payment by reference
    const payment = await Payment.findOne({ reference });
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check permissions
    const isCustomer = user._id.toString() === payment.customerId.toString();
    const isCompanyAdmin = user.role === 'company_admin';
    const isAdmin = user.role === 'admin';
    const isDriver = user.role === 'driver' || user.role === 'rider';
    
    // Drivers can only verify if they're assigned to the delivery's company
    let isAssignedDriver = false;
    if (isDriver) {
      const driver = await Driver.findOne({ userId: user._id });
      if (driver && payment.companyId) {
        if (driver.companyId?.toString() === payment.companyId.toString()) {
          isAssignedDriver = true;
        }
      }
    }
    
    if (!isCustomer && !isCompanyAdmin && !isAdmin && !isAssignedDriver) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to verify this payment'
      });
    }

    const result = await PaymentService.verifyPayment(reference);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Release escrow funds to COMPANY
 * @route   POST /api/payments/:paymentId/release
 * @access  Private (Company Admin, Admin)
 */
export const releaseEscrowFunds = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { reason, otp } = req.body;

    if (!paymentId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment ID is required'
      });
    }

    const payment = await Payment.findById(paymentId)
      .populate('companyId')
      .session(session);
    
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check permissions
    let isCompanyAdmin = false;
    if (user.role === 'company_admin' && payment.companyId) {
      const company = await Company.findOne({
        _id: payment.companyId,
        'admins.userId': user._id
      });
      isCompanyAdmin = !!company;
    }

    const isAdmin = user.role === 'admin';

    if (!isCompanyAdmin && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to release funds'
      });
    }

    // Verify delivery is completed
    const delivery = await Delivery.findById(payment.deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    if (delivery.status !== 'delivered') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Delivery must be completed before releasing funds'
      });
    }

    // OTP verification for extra security (optional)
    if (otp && delivery.dropoff?.otp && otp !== delivery.dropoff.otp) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Release funds to COMPANY
    const result = await PaymentService.releaseEscrowFundsToCompany(
      paymentId,
      reason || 'Delivery completed successfully',
      session
    );

    if (!result.success) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json(result);
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json(result);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Release escrow funds error:', error);
    res.status(500).json({
      success: false,
      message: 'Error releasing escrow funds',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Refund escrow funds to customer
 * @route   POST /api/payments/:paymentId/refund
 * @access  Private (Admin, Company Admin)
 */
export const refundEscrowFunds = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Refund reason is required'
      });
    }

    if (user.role !== 'admin' && user.role !== 'company_admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Check if user is company admin of this payment's company
    if (user.role === 'company_admin') {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: 'Payment not found'
        });
      }

      const company = await Company.findOne({
        _id: payment.companyId,
        'admins.userId': user._id
      }).session(session);

      if (!company) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Not authorized to refund this payment'
        });
      }
    }

    const result = await PaymentService.refundEscrowFunds(paymentId, reason, session);

    if (!result.success) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json(result);
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json(result);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Refund escrow funds error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refunding escrow funds'
    });
  }
};

/**
 * @desc    Raise dispute on escrow payment
 * @route   POST /api/payments/:paymentId/dispute
 * @access  Private (Customer, Company Admin, Driver)
 */
export const raiseDispute = async (req, res) => {
  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { reason, description, evidence } = req.body;

    if (!reason || !description) {
      return res.status(400).json({
        success: false,
        message: 'Reason and description are required'
      });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if dispute can be raised
    if (payment.escrowStatus !== 'held') {
      return res.status(400).json({
        success: false,
        message: `Cannot raise dispute. Payment status: ${payment.escrowStatus}`
      });
    }

    // Determine who is raising the dispute
    let raisedBy;
    let authorized = false;

    if (user._id.toString() === payment.customerId.toString()) {
      raisedBy = 'customer';
      authorized = true;
    } else if (user.role === 'company_admin') {
      // Check if user is admin of the payment's company
      const company = await Company.findOne({
        _id: payment.companyId,
        'admins.userId': user._id
      });
      if (company) {
        raisedBy = 'company_admin';
        authorized = true;
      }
    } else if (user.role === 'driver' || user.role === 'rider') {
      // Check if driver is assigned to the delivery
      const driver = await Driver.findOne({ userId: user._id });
      if (driver) {
        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery && delivery.driverId?.toString() === driver._id.toString()) {
          raisedBy = 'driver';
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to raise dispute'
      });
    }

    // Validate evidence format
    const validatedEvidence = Array.isArray(evidence) ? 
      evidence.filter(item => 
        typeof item === 'string' && 
        item.startsWith('http')
      ).slice(0, 5) : [];

    await payment.raiseDispute(raisedBy, reason, description, validatedEvidence);

    // Notify relevant parties about the dispute
    await PaymentService.notifyDisputeRaised(paymentId, raisedBy);

    res.status(200).json({
      success: true,
      message: 'Dispute raised successfully',
      data: {
        paymentId: payment._id,
        dispute: payment.dispute,
        escrowStatus: payment.escrowStatus
      }
    });
  } catch (error) {
    console.error('Raise dispute error:', error);
    res.status(500).json({
      success: false,
      message: 'Error raising dispute'
    });
  }
};

/**
 * @desc    Resolve dispute
 * @route   POST /api/payments/:paymentId/dispute/resolve
 * @access  Private (Admin)
 */
export const resolveDispute = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { decision, customerAmount, companyAmount, notes } = req.body;

    if (user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    if (!decision) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Decision is required'
      });
    }

    const payment = await Payment.findById(paymentId).session(session);
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Validate amounts based on decision
    if (decision === 'split') {
      if (!customerAmount || !companyAmount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Both customer and company amounts are required for split decision'
        });
      }

      const totalAmount = parseFloat(customerAmount) + parseFloat(companyAmount);
      if (Math.abs(totalAmount - payment.amount) > 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Total amount (${totalAmount}) must equal payment amount (${payment.amount})`
        });
      }
    }

    await payment.resolveDispute(
      decision,
      parseFloat(customerAmount || 0),
      parseFloat(companyAmount || 0),
      user._id,
      notes || ''
    );

    // Process the resolution based on decision
    if (decision === 'customer_wins') {
      await PaymentService.refundEscrowFunds(paymentId, 'Dispute resolved in favor of customer', session);
    } else if (decision === 'company_wins') {
      await PaymentService.releaseEscrowFundsToCompany(
        paymentId,
        'Dispute resolved in favor of company',
        session
      );
    } else if (decision === 'split') {
      // Split payment between customer and company
      await PaymentService.splitEscrowFunds(
        paymentId,
        customerAmount,
        companyAmount,
        session
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: 'Dispute resolved successfully',
      data: payment
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Resolve dispute error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resolving dispute'
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
      .populate('companyId', 'name email phone address')
      .populate('deliveryId', 'status pickup dropoff itemDetails fare driverId');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check permissions
    const isCustomer = user._id.toString() === payment.customerId.toString();
    const isAdmin = user.role === 'admin';
    const isCompanyAdmin = user.role === 'company_admin';
    const isDriver = user.role === 'driver' || user.role === 'rider';

    // Company admin can only view their company's payments
    let isCompanyAdminAuthorized = false;
    if (isCompanyAdmin && payment.companyId) {
      const company = await Company.findOne({
        _id: payment.companyId,
        'admins.userId': user._id
      });
      isCompanyAdminAuthorized = !!company;
    }

    // Driver can only view if assigned to the delivery
    let isAssignedDriver = false;
    if (isDriver) {
      const driver = await Driver.findOne({ userId: user._id });
      if (driver) {
        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery && delivery.driverId?.toString() === driver._id.toString()) {
          isAssignedDriver = true;
        }
      }
    }

    if (!isCustomer && !isAdmin && !isCompanyAdminAuthorized && !isAssignedDriver) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this payment'
      });
    }

    // Format response based on user role
    let formattedPayment = payment.toObject();
    
    // Hide sensitive information from non-admins
    if (!isAdmin) {
      delete formattedPayment.providerData;
      if (formattedPayment.metadata) {
        delete formattedPayment.metadata.userAgent;
      }
    }

    // Add delivery and driver info
    if (payment.deliveryId) {
      const delivery = payment.deliveryId;
      if (delivery.driverId) {
        const driver = await Driver.findById(delivery.driverId)
          .populate('userId', 'name phone avatarUrl');
        formattedPayment.driverInfo = {
          name: driver?.userId?.name || 'Unknown',
          phone: driver?.userId?.phone || '',
          vehicleType: driver?.vehicleType || 'bike'
        };
      }
    }

    res.status(200).json({
      success: true,
      data: formattedPayment
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payment details'
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // Build query
    const query = { customerId: customer._id };
    if (status) {
      query.escrowStatus = status;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('deliveryId', 'status pickup dropoff fare')
        .populate('companyId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query)
    ]);

    // Calculate summary
    const summary = {
      totalPayments: total,
      totalAmount: 0,
      heldAmount: 0,
      releasedAmount: 0,
      refundedAmount: 0
    };

    payments.forEach(payment => {
      summary.totalAmount += payment.amount;
      if (payment.escrowStatus === 'held') summary.heldAmount += payment.amount;
      if (payment.escrowStatus === 'released') summary.releasedAmount += payment.amount;
      if (payment.escrowStatus === 'refunded') summary.refundedAmount += payment.amount;
    });

    res.status(200).json({
      success: true,
      data: payments,
      summary,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get my payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payments'
    });
  }
};

/**
 * @desc    Get driver payments (payments made to their company)
 * @route   GET /api/payments/driver/my
 * @access  Private (Driver/Rider)
 */
export const getDriverPayments = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== 'driver' && driverUser.role !== 'rider') {
      return res.status(403).json({
        success: false,
        message: 'Only drivers/riders can view driver payments'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;

    // Get driver info
    const driver = await Driver.findOne({ userId: driverUser._id })
      .populate('companyId', 'name driverCommissionRate');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found'
      });
    }

    if (!driver.companyId) {
      return res.status(400).json({
        success: false,
        message: 'Driver is not assigned to a company'
      });
    }

    // Get deliveries assigned to this driver
    const deliveries = await Delivery.find({ 
      driverId: driver._id,
      status: 'delivered'
    }).select('_id');
    
    const deliveryIds = deliveries.map(d => d._id);

    // Find payments for these deliveries (paid to the company)
    const query = {
      deliveryId: { $in: deliveryIds },
      companyId: driver.companyId._id
    };

    if (status) {
      query.escrowStatus = status;
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name')
        .populate('deliveryId', 'status pickup dropoff fare')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query)
    ]);

    // Company commission rate (e.g., 30% company, 70% driver)
    const companyCommissionRate = driver.companyId.driverCommissionRate || 30;
    const driverSharePercentage = 100 - companyCommissionRate;

    // Format response with earnings calculation
    const formattedPayments = payments.map(payment => {
      const delivery = payment.deliveryId;
      const driverEarnings = payment.amount * (driverSharePercentage / 100);
      const companyCommission = payment.amount * (companyCommissionRate / 100);

      return {
        ...payment.toObject(),
        paymentStatus: payment.escrowStatus,
        driverEarnings,
        companyCommission,
        driverSharePercentage,
        companyCommissionRate,
        isReleasedToCompany: payment.escrowStatus === 'released',
        deliveryDetails: {
          pickupAddress: delivery?.pickup?.address,
          dropoffAddress: delivery?.dropoff?.address,
          fare: delivery?.fare
        }
      };
    });

    // Calculate total earnings
    const totalEarnings = formattedPayments.reduce((sum, payment) => 
      sum + (payment.driverEarnings || 0), 0
    );

    const pendingEarnings = formattedPayments
      .filter(p => p.escrowStatus === 'held')
      .reduce((sum, payment) => sum + (payment.driverEarnings || 0), 0);

    const releasedEarnings = formattedPayments
      .filter(p => p.escrowStatus === 'released')
      .reduce((sum, payment) => sum + (payment.driverEarnings || 0), 0);

    res.status(200).json({
      success: true,
      data: formattedPayments,
      earningsSummary: {
        totalEarnings,
        pendingEarnings,
        releasedEarnings,
        driverSharePercentage,
        companyCommissionRate
      },
      companyInfo: {
        id: driver.companyId._id,
        name: driver.companyId.name
      },
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get driver payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving driver payments'
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Verify user is admin of this company or platform admin
    const isCompanyAdmin = await Company.findOne({
      _id: companyId,
      'admins.userId': user._id
    });

    const isAdmin = user.role === 'admin';

    if (!isCompanyAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view company payments'
      });
    }

    // Build query
    const query = { companyId: companyId };
    if (status) {
      query.escrowStatus = status;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name email phone')
        .populate('deliveryId', 'status pickup dropoff driverId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query)
    ]);

    // Add driver info to each payment
    const paymentsWithDriverInfo = await Promise.all(
      payments.map(async (payment) => {
        const paymentObj = payment.toObject();
        if (payment.deliveryId?.driverId) {
          const driver = await Driver.findById(payment.deliveryId.driverId)
            .populate('userId', 'name phone');
          if (driver) {
            paymentObj.driverInfo = {
              name: driver.userId?.name,
              phone: driver.userId?.phone
            };
          }
        }
        return paymentObj;
      })
    );

    // Calculate company earnings summary
    const earningsSummary = {
      totalPayments: total,
      totalAmount: 0,
      heldAmount: 0,
      releasedAmount: 0,
      companyEarnings: 0,
      platformFees: 0
    };

    payments.forEach(payment => {
      earningsSummary.totalAmount += payment.amount;
      
      const platformFee = payment.fees?.platformAmount || (payment.amount * 0.05);
      const companyEarnings = payment.amount - platformFee;
      
      earningsSummary.platformFees += platformFee;
      earningsSummary.companyEarnings += companyEarnings;
      
      if (payment.escrowStatus === 'held') earningsSummary.heldAmount += payment.amount;
      if (payment.escrowStatus === 'released') earningsSummary.releasedAmount += payment.amount;
    });

    res.status(200).json({
      success: true,
      data: paymentsWithDriverInfo,
      companyInfo: {
        id: company._id,
        name: company.name,
        totalEarnings: company.totalEarnings || 0,
        availableBalance: company.availableBalance || 0,
        pendingBalance: company.pendingBalance || 0
      },
      earningsSummary,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get company payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving company payments'
    });
  }
};

/**
 * @desc    Get payment statistics
 * @route   GET /api/payments/admin/stats
 * @access  Private (Admin)
 */
export const getPaymentStats = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const stats = await Payment.aggregate([
      {
        $facet: {
          today: [
            {
              $match: {
                createdAt: { $gte: today },
                escrowStatus: 'released'
              }
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                amount: { $sum: '$amount' },
                platformEarnings: { $sum: { $multiply: ['$amount', 0.05] } }
              }
            }
          ],
          week: [
            {
              $match: {
                createdAt: { $gte: weekAgo },
                escrowStatus: 'released'
              }
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                amount: { $sum: '$amount' },
                platformEarnings: { $sum: { $multiply: ['$amount', 0.05] } }
              }
            }
          ],
          month: [
            {
              $match: {
                createdAt: { $gte: monthAgo },
                escrowStatus: 'released'
              }
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                amount: { $sum: '$amount' },
                platformEarnings: { $sum: { $multiply: ['$amount', 0.05] } }
              }
            }
          ],
          allTime: [
            {
              $match: {
                escrowStatus: 'released'
              }
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                amount: { $sum: '$amount' },
                platformEarnings: { $sum: { $multiply: ['$amount', 0.05] } }
              }
            }
          ],
          statusBreakdown: [
            {
              $group: {
                _id: '$escrowStatus',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            }
          ],
          companyBreakdown: [
            {
              $match: {
                companyId: { $exists: true }
              }
            },
            {
              $group: {
                _id: '$companyId',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
              }
            },
            {
              $sort: { amount: -1 }
            },
            {
              $limit: 10
            }
          ]
        }
      }
    ]);

    // Get company names for breakdown
    const companyIds = stats[0]?.companyBreakdown?.map(item => item._id) || [];
    const companies = await Company.find({ _id: { $in: companyIds } })
      .select('name');
    
    const companyMap = {};
    companies.forEach(company => {
      companyMap[company._id] = company.name;
    });

    // Enhance company breakdown with names
    if (stats[0]?.companyBreakdown) {
      stats[0].companyBreakdown = stats[0].companyBreakdown.map(item => ({
        ...item,
        companyName: companyMap[item._id] || 'Unknown Company'
      }));
    }

    res.status(200).json({
      success: true,
      data: stats[0]
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payment statistics'
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
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = { customerId: customer._id };
    
    if (status) query.escrowStatus = status;
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

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('deliveryId', 'status pickup dropoff itemDetails')
        .populate('companyId', 'name')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(query)
    ]);

    // Calculate summary
    const summary = await Payment.aggregate([
      { $match: { customerId: customer._id } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$amount' },
          averagePayment: { $avg: '$amount' },
          paymentCount: { $sum: 1 },
          completedPayments: {
            $sum: { $cond: [{ $eq: ['$escrowStatus', 'released'] }, 1, 0] }
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
        completedPayments: 0
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payment history'
    });
  }
};

/**
 * @desc    Get all disputes
 * @route   GET /api/payments/admin/disputes
 * @access  Private (Admin)
 */
export const getDisputes = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status; // open, resolved

    const query = { 'dispute.status': { $exists: true } };
    if (status === 'open') {
      query['dispute.status'] = 'open';
    } else if (status === 'resolved') {
      query['dispute.status'] = 'resolved';
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name email phone')
        .populate('companyId', 'name')
        .populate('deliveryId', 'status pickup dropoff')
        .sort({ 'dispute.raisedAt': -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get disputes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving disputes'
    });
  }
};

/**
 * @desc    Get all payments (admin)
 * @route   GET /api/payments/admin/all
 * @access  Private (Admin)
 */
export const getCustomerPayments = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const companyId = req.query.companyId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const query = {};
    if (status) query.escrowStatus = status;
    if (companyId) query.companyId = companyId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('customerId', 'name email phone')
        .populate('companyId', 'name')
        .populate('deliveryId', 'status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payments'
    });
  }
};

/**
 * ===========================================
 * TESTING ENDPOINTS (Development Only)
 * ===========================================
 */

/**
 * @desc    Test payment initialization (for development)
 * @route   POST /api/payments/test/initialize
 * @access  Private (Customer)
 */
export const testInitializePayment = async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }

  try {
    const customer = req.user;
    const { deliveryId, amount = 5000, companyId } = req.body;

    if (!deliveryId || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Delivery ID and company ID are required'
      });
    }

    // Verify delivery exists
    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Delivery not found'
      });
    }

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if driver is assigned to this company
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver && driver.companyId?.toString() !== companyId) {
        return res.status(400).json({
          success: false,
          message: 'Driver is not associated with this company'
        });
      }
    }

    // Create test payment
    const payment = new Payment({
      deliveryId: delivery._id,
      customerId: customer._id,
      companyId: company._id,
      amount: parseFloat(amount),
      currency: 'NGN',
      status: 'pending',
      escrowStatus: 'pending',
      paymentMethod: 'test_card',
      isTest: true,
      reference: `TEST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      metadata: {
        test: true,
        customerName: customer.name,
        companyName: company.name
      }
    });

    await payment.save();

    // Simulate successful payment response
    const testResponse = {
      success: true,
      message: 'Test payment initialized successfully',
      data: {
        authorization_url: `http://localhost:3000/test-payment/${payment.reference}`,
        access_code: `test-access-${payment.reference}`,
        reference: payment.reference,
        amount: payment.amount,
        status: 'pending',
        escrowStatus: 'pending',
        company: {
          id: company._id,
          name: company.name,
          email: company.email
        },
        delivery: {
          id: delivery._id,
          status: delivery.status,
          pickupAddress: delivery.pickup?.address,
          dropoffAddress: delivery.dropoff?.address
        },
        customer: {
          id: customer._id,
          name: customer.name,
          email: customer.email
        }
      },
      metadata: {
        isTest: true,
        testInstructions: 'Use this reference to simulate webhook: ' + payment.reference
      }
    };

    res.status(200).json(testResponse);
  } catch (error) {
    console.error('Test initialize payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Test payment initialization failed',
      error: error.message
    });
  }
};

/**
 * @desc    Simulate webhook for testing
 * @route   POST /api/payments/test/webhook-simulate
 * @access  Private (Admin)
 */
export const testWebhookSimulation = async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }

  try {
    const { reference, status = 'success', amount = null } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    // Find the payment
    const payment = await Payment.findOne({ reference });
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (!payment.isTest) {
      return res.status(400).json({
        success: false,
        message: 'Only test payments can be simulated'
      });
    }

    // Simulate webhook payload
    const webhookPayload = {
      event: 'charge.success',
      data: {
        id: payment._id,
        reference: reference,
        amount: (amount || payment.amount) * 100, // In kobo
        status: status,
        metadata: payment.metadata || {},
        customer: {
          id: payment.customerId,
          email: 'test@example.com'
        },
        authorization: {
          authorization_code: 'TEST_AUTH_CODE',
          card_type: 'visa',
          last4: '1234'
        }
      }
    };

    // Process the simulated webhook
    const result = await PaymentService.handleWebhook(webhookPayload);

    // Refresh payment data
    const updatedPayment = await Payment.findById(payment._id)
      .populate('companyId', 'name')
      .populate('customerId', 'name');

    res.status(200).json({
      success: true,
      message: 'Webhook simulation completed',
      data: {
        originalPayment: payment,
        updatedPayment: updatedPayment,
        webhookResult: result,
        simulatedPayload: webhookPayload
      }
    });
  } catch (error) {
    console.error('Webhook simulation error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook simulation failed',
      error: error.message
    });
  }
};

/**
 * @desc    Get test payment status
 * @route   GET /api/payments/test/status/:reference
 * @access  Private
 */
export const getTestPaymentStatus = async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }

  try {
    const { reference } = req.params;
    const user = req.user;

    const payment = await Payment.findOne({ reference })
      .populate('companyId', 'name')
      .populate('customerId', 'name')
      .populate('deliveryId', 'status pickup dropoff');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if it's a test payment
    if (!payment.isTest) {
      return res.status(400).json({
        success: false,
        message: 'Not a test payment'
      });
    }

    // Check permissions
    const isCustomer = user._id.toString() === payment.customerId.toString();
    const isAdmin = user.role === 'admin';

    if (!isCustomer && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Calculate simulated fees
    const platformFee = payment.amount * 0.05;
    const companyAmount = payment.amount - platformFee;

    res.status(200).json({
      success: true,
      data: {
        payment: payment,
        simulatedFees: {
          platformFee,
          companyAmount,
          totalAmount: payment.amount
        },
        nextSteps: payment.escrowStatus === 'held' ? 
          'Use /release endpoint to simulate fund release to company' :
          payment.escrowStatus === 'pending' ?
          'Use /test/webhook-simulate to simulate payment success' :
          'Payment already completed'
      }
    });
  } catch (error) {
    console.error('Get test payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting test payment status',
      error: error.message
    });
  }
};

/**
 * @desc    Get test payment summary
 * @route   GET /api/payments/test/summary
 * @access  Private (Admin)
 */
export const getTestPaymentSummary = async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }

  try {
    const user = req.user;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const testPayments = await Payment.find({ isTest: true })
      .populate('companyId', 'name')
      .populate('customerId', 'name')
      .sort({ createdAt: -1 })
      .limit(50);

    const summary = {
      totalTestPayments: testPayments.length,
      totalAmount: 0,
      byStatus: {},
      byCompany: {}
    };

    testPayments.forEach(payment => {
      summary.totalAmount += payment.amount;
      
      // Count by status
      summary.byStatus[payment.escrowStatus] = 
        (summary.byStatus[payment.escrowStatus] || 0) + 1;
      
      // Group by company
      const companyName = payment.companyId?.name || 'Unknown';
      if (!summary.byCompany[companyName]) {
        summary.byCompany[companyName] = {
          count: 0,
          amount: 0
        };
      }
      summary.byCompany[companyName].count++;
      summary.byCompany[companyName].amount += payment.amount;
    });

    res.status(200).json({
      success: true,
      data: {
        summary,
        recentTestPayments: testPayments.slice(0, 10)
      }
    });
  } catch (error) {
    console.error('Get test payment summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting test payment summary',
      error: error.message
    });
  }
};