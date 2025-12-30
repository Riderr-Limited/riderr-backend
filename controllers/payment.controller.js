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

    // Check if payment already exists
    const existingPayment = await Payment.findOne({ deliveryId });
    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: 'Payment already initialized for this delivery'
      });
    }

    const result = await PaymentService.initializePayment({
      deliveryId,
      customerId: customer._id,
      amount,
      email,
      callback_url,
      metadata: {
        customerName: customer.name,
        deliveryType: delivery.itemType,
        platform: req.headers['x-platform'] || 'web'
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
      message: error.message || 'Server error'
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
    const signature = req.headers['x-paystack-signature'];
    const payload = req.body;

    const result = await PaymentService.handleWebhook(payload, signature);

    if (result.success) {
      res.status(200).send('Webhook processed');
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).send('Webhook error');
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
    const result = await PaymentService.verifyPayment(reference);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

/**
 * @desc    Release escrow funds to delivery person
 * @route   POST /api/payments/:paymentId/release
 * @access  Private (Customer, Admin)
 */
export const releaseEscrowFunds = async (req, res) => {
  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { reason, deliveryPersonId } = req.body;

    const payment = await Payment.findById(paymentId);
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
        message: 'Not authorized to release funds'
      });
    }

    // Verify delivery is completed
    const delivery = await Delivery.findById(payment.deliveryId);
    if (!delivery || delivery.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Delivery must be completed before releasing funds'
      });
    }

    const result = await PaymentService.releaseEscrowFunds(
      paymentId,
      deliveryPersonId || delivery.deliveryPersonId,
      reason
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Release escrow funds error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

/**
 * @desc    Refund escrow funds to customer
 * @route   POST /api/payments/:paymentId/refund
 * @access  Private (Admin, Company Admin)
 */
export const refundEscrowFunds = async (req, res) => {
  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { reason } = req.body;

    if (user.role !== 'admin' && user.role !== 'company_admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const result = await PaymentService.refundEscrowFunds(paymentId, reason);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Refund escrow funds error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
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

    await payment.raiseDispute(raisedBy, reason, description, evidence);

    res.status(200).json({
      success: true,
      message: 'Dispute raised successfully',
      data: payment
    });
  } catch (error) {
    console.error('Raise dispute error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
};

/**
 * @desc    Resolve dispute
 * @route   POST /api/payments/:paymentId/dispute/resolve
 * @access  Private (Admin)
 */
export const resolveDispute = async (req, res) => {
  try {
    const user = req.user;
    const { paymentId } = req.params;
    const { decision, customerAmount, deliveryPersonAmount, notes } = req.body;

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    await payment.resolveDispute(
      decision,
      customerAmount,
      deliveryPersonAmount,
      user._id,
      notes
    );

    res.status(200).json({
      success: true,
      message: 'Dispute resolved successfully',
      data: payment
    });
  } catch (error) {
    console.error('Resolve dispute error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
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

    const payment = await Payment.findById(paymentId);
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

    const result = await PaymentService.getPaymentDetails(paymentId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
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

    const result = await PaymentService.getCustomerPayments(
      customer._id,
      page,
      limit
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Get my payments error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
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
    
    if (user.role !== 'rider') {
      return res.status(403).json({
        success: false,
        message: 'Only delivery persons can create transfer recipients'
      });
    }

    const { accountNumber, bankCode, email } = req.body;

    if (!accountNumber || !bankCode || !email) {
      return res.status(400).json({
        success: false,
        message: 'Account number, bank code, and email are required'
      });
    }

    const result = await PaymentService.createTransferRecipient({
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
      message: error.message || 'Server error'
    });
  }
};