// services/payment.service.js
import axios from 'axios';
import crypto from 'crypto';
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';

class PaymentService {
  constructor() {
    this.paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    this.paystackPublic = process.env.PAYSTACK_PUBLIC_KEY;
    this.baseURL = 'https://api.paystack.co';
  }

  // Initialize payment (creates escrow)
  async initializePayment(paymentData) {
    try {
      const {
        deliveryId,
        customerId,
        amount,
        email,
        callback_url,
        metadata = {}
      } = paymentData;

      // Create payment record
      const payment = new Payment({
        deliveryId,
        customerId,
        amount: amount * 100, // Convert to kobo (Paystack expects amount in kobo)
        currency: 'NGN',
        isEscrow: true,
        escrowStatus: 'pending',
        provider: 'paystack',
        metadata
      });

      await payment.save();

      // Initialize Paystack payment
      const response = await axios.post(
        `${this.baseURL}/transaction/initialize`,
        {
          email,
          amount: payment.amount,
          reference: payment.reference,
          callback_url,
          metadata: {
            paymentId: payment._id,
            deliveryId,
            customerId
          }
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        data: {
          payment,
          authorization_url: response.data.data.authorization_url,
          access_code: response.data.data.access_code,
          reference: payment.reference
        }
      };
    } catch (error) {
      console.error('Initialize payment error:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  // Verify payment webhook
  async verifyPayment(reference) {
    try {
      const response = await axios.get(
        `${this.baseURL}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecret}`
          }
        }
      );

      const paymentData = response.data.data;
      
      // Find payment
      const payment = await Payment.findOne({ reference });
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Update payment status
      if (paymentData.status === 'success') {
        // Hold funds in escrow
        await payment.holdInEscrow({
          escrowId: paymentData.id,
          holdReference: paymentData.reference,
          transactionData: paymentData
        });

        // Update delivery payment status
        await Delivery.findByIdAndUpdate(payment.deliveryId, {
          'payment.status': 'paid',
          'payment.amount': payment.amount / 100,
          'payment.transactionId': paymentData.reference
        });

        return {
          success: true,
          data: payment,
          message: 'Payment successful, funds held in escrow'
        };
      } else {
        payment.escrowStatus = 'cancelled';
        await payment.save();

        return {
          success: false,
          data: payment,
          message: `Payment failed: ${paymentData.gateway_response}`
        };
      }
    } catch (error) {
      console.error('Verify payment error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  // Release funds from escrow to delivery person
  async releaseEscrowFunds(paymentId, deliveryPersonId, reason = 'delivery_confirmed') {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Verify delivery is completed
      const delivery = await Delivery.findById(payment.deliveryId);
      if (!delivery || delivery.status !== 'delivered') {
        throw new Error('Delivery not completed');
      }

      // Calculate amounts
      payment.calculateFees();
      payment.deliveryPersonId = deliveryPersonId;

      // For Paystack, we'd use transfer API
      // Note: You need to have the delivery person's transfer recipient setup
      const transferResponse = await axios.post(
        `${this.baseURL}/transfer`,
        {
          source: 'balance',
          amount: payment.fees.deliveryPersonAmount,
          recipient: deliveryPerson.recipientCode, // You need to create recipient first
          reason: `Payment for delivery ${delivery._id}`
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Update payment status
      await payment.releaseFromEscrow(reason);

      return {
        success: true,
        data: {
          payment,
          transfer: transferResponse.data.data
        },
        message: 'Funds released successfully'
      };
    } catch (error) {
      console.error('Release escrow funds error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  // Refund funds to customer
  async refundEscrowFunds(paymentId, reason = 'cancelled') {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Initiate refund through Paystack
      const refundResponse = await axios.post(
        `${this.baseURL}/refund`,
        {
          transaction: payment.providerData.holdReference,
          amount: payment.amount,
          customer_note: `Refund for ${reason}`,
          merchant_note: `Refund processed for payment ${paymentId}`
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Update payment status
      await payment.refundFromEscrow(reason);

      return {
        success: true,
        data: {
          payment,
          refund: refundResponse.data.data
        },
        message: 'Refund processed successfully'
      };
    } catch (error) {
      console.error('Refund escrow funds error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  // Create transfer recipient for delivery person
  async createTransferRecipient(deliveryPersonData) {
    try {
      const { name, accountNumber, bankCode, email } = deliveryPersonData;

      const response = await axios.post(
        `${this.baseURL}/transferrecipient`,
        {
          type: 'nuban',
          name,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: 'NGN',
          email
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        data: response.data.data,
        message: 'Transfer recipient created successfully'
      };
    } catch (error) {
      console.error('Create transfer recipient error:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  // Webhook handler for Paystack events
  async handleWebhook(payload, signature) {
    try {
      // Verify webhook signature
      const hash = crypto
        .createHmac('sha512', this.paystackSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

      if (hash !== signature) {
        throw new Error('Invalid signature');
      }

      const event = payload.event;
      const data = payload.data;

      switch (event) {
        case 'charge.success':
          await this.verifyPayment(data.reference);
          break;

        case 'transfer.success':
          // Handle successful transfer to delivery person
          console.log('Transfer successful:', data);
          break;

        case 'transfer.failed':
          // Handle failed transfer
          console.log('Transfer failed:', data);
          break;

        case 'refund.processed':
          // Handle refund processed
          console.log('Refund processed:', data);
          break;
      }

      return { success: true, message: 'Webhook processed' };
    } catch (error) {
      console.error('Webhook handler error:', error);
      return { success: false, message: error.message };
    }
  }

  // Get payment details
  async getPaymentDetails(paymentId) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate('deliveryId')
        .populate('customerId', 'name email phone')
        .populate('deliveryPersonId', 'userId')
        .populate({
          path: 'deliveryPersonId.userId',
          select: 'name email'
        });

      if (!payment) {
        throw new Error('Payment not found');
      }

      return {
        success: true,
        data: payment
      };
    } catch (error) {
      console.error('Get payment details error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  // Get customer payments
  async getCustomerPayments(customerId, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;

      const [payments, total] = await Promise.all([
        Payment.find({ customerId })
          .populate('deliveryId', 'status pickup dropoff')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Payment.countDocuments({ customerId })
      ]);

      return {
        success: true,
        data: payments,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Get customer payments error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }
}

export default new PaymentService();