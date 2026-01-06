// controllers/payment.controller.js
import PaymentService from '../services/payments.services.js';
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';

/**
 * @desc    Initialize payment for delivery
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializePayment = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId, amount, email, callback_url } = req.body;

    if (!deliveryId || !amount || !email) {
      return res.status(400).json({
        success: false,
        message: 'Delivery ID, amount, and email are required'
      });
    }

    // Verify delivery exists and belongs to customer
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

    // Check if delivery can be paid for
    if (delivery.status !== 'assigned' && delivery.status !== 'created') {
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
    
    if (Math.abs(deliveryTotal - requestedAmount) > 100) { // Allow small variance
      return res.status(400).json({
        success: false,
        message: `Amount must be approximately ${deliveryTotal}`
      });
    }

    const result = await PaymentService.initializePayment({
      deliveryId,
      customerId: customer._id,
      amount: requestedAmount,
      email,
      callback_url,
      metadata: {
        customerName: customer.name,
        customerId: customer._id,
        deliveryId: delivery._id,
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
    const isAdmin = user.role === 'admin';
    const isCompanyAdmin = user.role === 'company_admin';
    
    if (!isCustomer && !isAdmin && !isCompanyAdmin) {
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
 * @desc    Release escrow funds to delivery person
 * @route   POST /api/payments/:paymentId/release
 * @access  Private (Customer, Admin)
 */
export const releaseEscrowFunds = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { reason, deliveryPersonId, otp } = req.body;

    if (!paymentId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Payment ID is required'
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

    // Check permissions
    const isCustomer = user._id.toString() === payment.customerId.toString();
    const isAdmin = user.role === 'admin';
    const isCompanyAdmin = user.role === 'company_admin';

    if (!isCustomer && !isAdmin && !isCompanyAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to release funds'
      });
    }

    // For customers, require OTP verification
    if (isCustomer && !isAdmin && !isCompanyAdmin) {
      const delivery = await Delivery.findById(payment.deliveryId).session(session);
      
      if (!delivery) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: 'Delivery not found'
        });
      }

      // Check if delivery is completed
      if (delivery.status !== 'delivered') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Delivery must be completed before releasing funds'
        });
      }

      // OTP verification for customer-initiated release
      if (delivery.dropoff?.otp && otp !== delivery.dropoff.otp) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP'
        });
      }
    }

    const result = await PaymentService.releaseEscrowFunds(
      paymentId,
      deliveryPersonId || payment.deliveryPersonId,
      reason,
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
 * @access  Private (Customer, Delivery Person)
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
    if (user._id.toString() === payment.customerId.toString()) {
      raisedBy = 'customer';
    } else if (payment.deliveryPersonId && 
               user._id.toString() === payment.deliveryPersonId.toString()) {
      raisedBy = 'delivery_person';
    } else {
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
      ).slice(0, 5) : []; // Limit to 5 evidence items

    await payment.raiseDispute(raisedBy, reason, description, validatedEvidence);

    // Notify admins about the dispute
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
    const { decision, customerAmount, deliveryPersonAmount, notes } = req.body;

    if (user.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    if (!decision || !customerAmount || !deliveryPersonAmount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Decision and amounts are required'
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

    // Validate amounts
    const totalAmount = parseFloat(customerAmount) + parseFloat(deliveryPersonAmount);
    if (Math.abs(totalAmount - payment.amount) > 1) { // Allow 1 unit variance
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Total amount (${totalAmount}) must equal payment amount (${payment.amount})`
      });
    }

    await payment.resolveDispute(
      decision,
      parseFloat(customerAmount),
      parseFloat(deliveryPersonAmount),
      user._id,
      notes || ''
    );

    // Process the resolution based on decision
    if (decision === 'customer_wins') {
      await PaymentService.refundEscrowFunds(paymentId, 'Dispute resolved in favor of customer', session);
    } else if (decision === 'delivery_person_wins') {
      await PaymentService.releaseEscrowFunds(
        paymentId,
        payment.deliveryPersonId,
        'Dispute resolved in favor of delivery person',
        session
      );
    } else if (decision === 'split') {
      // Split payment based on resolved amounts
      await PaymentService.splitEscrowFunds(
        paymentId,
        customerAmount,
        deliveryPersonAmount,
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
      .populate('deliveryPersonId', 'userId vehicleType vehicleMake vehicleModel')
      .populate('deliveryId', 'status pickup dropoff itemDetails');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check permissions
    const isCustomer = user._id.toString() === payment.customerId.toString();
    const isDeliveryPerson = payment.deliveryPersonId && 
                           user._id.toString() === payment.deliveryPersonId.toString();
    const isAdmin = user.role === 'admin';
    const isCompanyAdmin = user.role === 'company_admin';

    if (!isCustomer && !isDeliveryPerson && !isAdmin && !isCompanyAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this payment'
      });
    }

    // Format response based on user role
    let formattedPayment = payment.toObject();
    
    if (!isAdmin && !isCompanyAdmin) {
      // Hide sensitive information from non-admins
      delete formattedPayment.providerData;
      delete formattedPayment.metadata;
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

    // Build query
    const query = { customerId: customer._id };
    if (status) {
      query.escrowStatus = status;
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('deliveryId', 'status pickup dropoff')
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
    console.error('Get my payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payments'
    });
  }
};

/**
 * @desc    Create transfer recipient for delivery person
 * @route   POST /api/payments/transfer-recipient
 * @access  Private (Delivery Person)
 */
export const createTransferRecipient = async (req, res) => {
  try {
    const user = req.user;
    const { accountNumber, bankCode, email } = req.body;

    if (user.role !== 'driver' && user.role !== 'rider') {
      return res.status(403).json({
        success: false,
        message: 'Only delivery persons can create transfer recipients'
      });
    }

    if (!accountNumber || !bankCode || !email) {
      return res.status(400).json({
        success: false,
        message: 'Account number, bank code, and email are required'
      });
    }

    // Validate Nigerian bank account number (10 digits)
    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Account number must be 10 digits'
      });
    }

    const result = await PaymentService.createTransferRecipient({
      userId: user._id,
      name: user.name,
      accountNumber,
      bankCode,
      email
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Create transfer recipient error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating transfer recipient'
    });
  }
};

/**
 * @desc    Get payment statistics
 * @route   GET /api/payments/stats
 * @access  Private (Admin, Company Admin)
 */
export const getPaymentStats = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'company_admin') {
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
                platformEarnings: { $sum: '$fees.platformAmount' }
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
                platformEarnings: { $sum: '$fees.platformAmount' }
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
                platformEarnings: { $sum: '$fees.platformAmount' }
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
                platformEarnings: { $sum: '$fees.platformAmount' }
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
          ]
        }
      }
    ]);

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