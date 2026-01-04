// services/payments.services.js
import axios from 'axios';
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Driver from '../models/riders.models.js';
import User from '../models/user.models.js';
import crypto from 'crypto';

class PaymentService {
  constructor() {
    this.paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    this.paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY;
    this.webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    this.paystackBaseUrl = 'https://api.paystack.co';
  }

  async initializePayment(paymentData) {
    try {
      const {
        deliveryId,
        customerId,
        amount,
        email,
        callback_url,
        metadata
      } = paymentData;

      // Convert amount to kobo (Paystack uses kobo for NGN)
      const amountInKobo = Math.round(amount * 100);

      const payload = {
        email,
        amount: amountInKobo,
        callback_url,
        metadata: {
          ...metadata,
          deliveryId,
          customerId
        },
        currency: 'NGN'
      };

      const response = await axios.post(
        `${this.paystackBaseUrl}/transaction/initialize`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        const { reference, authorization_url, access_code } = response.data.data;

        // Create payment record
        const payment = new Payment({
          deliveryId,
          customerId,
          amount,
          reference,
          provider: 'paystack',
          providerData: {
            access_code,
            authorization_url,
            reference,
            metadata: response.data.data
          },
          escrowStatus: 'pending',
          fees: {
            platformFee: 0.10, // 10% platform fee
            transactionFee: 0.015 * amount // 1.5% transaction fee
          }
        });

        // Calculate fees
        payment.calculateFees();
        await payment.save();

        return {
          success: true,
          message: 'Payment initialized successfully',
          data: {
            authorization_url,
            reference,
            access_code,
            amount,
            paymentId: payment._id
          }
        };
      }

      return {
        success: false,
        message: response.data.message || 'Failed to initialize payment'
      };
    } catch (error) {
      console.error('Initialize payment service error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || 'Payment initialization failed'
      };
    }
  }

  async verifyPayment(reference) {
    try {
      const response = await axios.get(
        `${this.paystackBaseUrl}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`
          }
        }
      );

      if (response.data.status && response.data.data.status === 'success') {
        const paymentData = response.data.data;
        
        // Find payment record
        const payment = await Payment.findOne({ reference });
        
        if (!payment) {
          return {
            success: false,
            message: 'Payment record not found'
          };
        }

        // Update payment status
        payment.escrowStatus = 'held';
        payment.heldAt = new Date();
        payment.providerData = {
          ...payment.providerData,
          verification: paymentData,
          verifiedAt: new Date()
        };

        await payment.save();

        // Update delivery status
        await Delivery.findByIdAndUpdate(payment.deliveryId, {
          'payment.status': 'paid',
          'payment.paidAt': new Date(),
          'payment.method': 'card',
          'payment.transactionId': reference
        });

        // If delivery has driver, update driver's payment reference
        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery && delivery.driverId) {
          await Driver.findByIdAndUpdate(delivery.driverId, {
            $addToSet: { pendingPayments: payment._id }
          });
        }

        return {
          success: true,
          message: 'Payment verified successfully',
          data: {
            paymentId: payment._id,
            status: payment.escrowStatus,
            amount: payment.amount,
            deliveryId: payment.deliveryId,
            verifiedAt: payment.heldAt
          }
        };
      }

      return {
        success: false,
        message: response.data.message || 'Payment verification failed'
      };
    } catch (error) {
      console.error('Verify payment service error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || 'Payment verification failed'
      };
    }
  }

  async handleWebhook(payload, signature) {
    try {
      // Verify webhook signature
      const hash = crypto
        .createHmac('sha512', this.webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

      if (hash !== signature) {
        throw new Error('Invalid webhook signature');
      }

      const event = payload.event;
      const data = payload.data;

      switch (event) {
        case 'charge.success':
          await this.handleSuccessfulCharge(data);
          break;
        
        case 'transfer.success':
          await this.handleSuccessfulTransfer(data);
          break;
        
        case 'transfer.failed':
          await this.handleFailedTransfer(data);
          break;
        
        case 'transfer.reversed':
          await this.handleReversedTransfer(data);
          break;
        
        default:
          console.log(`Unhandled webhook event: ${event}`);
      }

      return { success: true, message: 'Webhook processed' };
    } catch (error) {
      console.error('Webhook processing error:', error);
      return { success: false, message: error.message };
    }
  }

  async handleSuccessfulCharge(data) {
    const { reference, amount, metadata } = data;
    
    // Verify and process payment
    await this.verifyPayment(reference);
    
    // Additional logic for successful charge
    if (metadata && metadata.deliveryId) {
      await Delivery.findByIdAndUpdate(metadata.deliveryId, {
        'payment.webhookProcessed': true,
        'payment.webhookProcessedAt': new Date()
      });
    }
  }

  async releaseEscrowFunds(paymentId, deliveryPersonId, reason, session = null) {
    try {
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.escrowStatus !== 'held') {
        throw new Error(`Cannot release funds. Current status: ${payment.escrowStatus}`);
      }

      // Get driver's transfer recipient
      const driver = await Driver.findById(deliveryPersonId);
      if (!driver || !driver.transferRecipientCode) {
        throw new Error('Driver transfer recipient not found');
      }

      // Calculate amount to transfer (after platform fee)
      const transferAmount = payment.fees.deliveryPersonAmount * 100; // Convert to kobo
      
      const payload = {
        source: 'balance',
        amount: transferAmount,
        recipient: driver.transferRecipientCode,
        reason: reason || 'Delivery completed'
      };

      const response = await axios.post(
        `${this.paystackBaseUrl}/transfer`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        const transferData = response.data.data;

        // Update payment status
        payment.escrowStatus = 'released';
        payment.deliveryPersonId = deliveryPersonId;
        payment.releasedAt = new Date();
        payment.providerData = {
          ...payment.providerData,
          transfer: transferData,
          releasedAt: new Date()
        };

        if (session) {
          await payment.save({ session });
        } else {
          await payment.save();
        }

        // Update driver earnings
        await Driver.findByIdAndUpdate(deliveryPersonId, {
          $inc: { earnings: payment.fees.deliveryPersonAmount },
          $pull: { pendingPayments: paymentId },
          $push: { 
            completedPayments: {
              paymentId,
              amount: payment.fees.deliveryPersonAmount,
              transferredAt: new Date()
            }
          }
        });

        // Notify driver
        const driverUser = await User.findById(driver.userId);
        if (driverUser) {
          await this.sendNotification(driverUser._id, {
            title: '💰 Payment Released',
            message: `₦${payment.fees.deliveryPersonAmount} has been transferred to your account`,
            data: { paymentId, amount: payment.fees.deliveryPersonAmount }
          });
        }

        return {
          success: true,
          message: 'Funds released successfully',
          data: {
            paymentId: payment._id,
            amount: payment.fees.deliveryPersonAmount,
            transferReference: transferData.reference,
            releasedAt: payment.releasedAt
          }
        };
      }

      throw new Error(response.data.message || 'Transfer failed');
    } catch (error) {
      console.error('Release escrow funds error:', error.response?.data || error.message);
      throw error;
    }
  }

  async refundEscrowFunds(paymentId, reason, session = null) {
    try {
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (!['held', 'pending'].includes(payment.escrowStatus)) {
        throw new Error(`Cannot refund funds. Current status: ${payment.escrowStatus}`);
      }

      // For Paystack, initiate refund
      const refundAmount = payment.amount * 100; // Convert to kobo
      
      const payload = {
        transaction: payment.reference,
        amount: refundAmount,
        currency: 'NGN',
        customer_note: reason || 'Refund requested'
      };

      const response = await axios.post(
        `${this.paystackBaseUrl}/refund`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        const refundData = response.data.data;

        // Update payment status
        payment.escrowStatus = 'refunded';
        payment.refundedAt = new Date();
        payment.providerData = {
          ...payment.providerData,
          refund: refundData,
          refundedAt: new Date()
        };

        if (session) {
          await payment.save({ session });
        } else {
          await payment.save();
        }

        // Update delivery status
        await Delivery.findByIdAndUpdate(payment.deliveryId, {
          'payment.status': 'refunded',
          'payment.refundedAt': new Date(),
          status: 'cancelled'
        });

        // Notify customer
        await this.sendNotification(payment.customerId, {
          title: '💸 Refund Processed',
          message: `₦${payment.amount} has been refunded to your account`,
          data: { paymentId, amount: payment.amount, reason }
        });

        return {
          success: true,
          message: 'Refund processed successfully',
          data: {
            paymentId: payment._id,
            amount: payment.amount,
            refundReference: refundData.reference,
            refundedAt: payment.refundedAt
          }
        };
      }

      throw new Error(response.data.message || 'Refund failed');
    } catch (error) {
      console.error('Refund escrow funds error:', error.response?.data || error.message);
      throw error;
    }
  }

  async createTransferRecipient(recipientData) {
    try {
      const { userId, name, accountNumber, bankCode, email } = recipientData;

      const payload = {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
        email
      };

      const response = await axios.post(
        `${this.paystackBaseUrl}/transferrecipient`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        const recipient = response.data.data;

        // Save recipient code to driver profile
        await Driver.findOneAndUpdate(
          { userId },
          { 
            transferRecipientCode: recipient.recipient_code,
            bankDetails: {
              accountNumber,
              bankCode,
              bankName: recipient.details.bank_name,
              accountName: recipient.details.account_name
            }
          }
        );

        return {
          success: true,
          message: 'Transfer recipient created successfully',
          data: recipient
        };
      }

      return {
        success: false,
        message: response.data.message || 'Failed to create transfer recipient'
      };
    } catch (error) {
      console.error('Create transfer recipient error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to create transfer recipient'
      };
    }
  }

  async verifyWebhookSignature(payload, signature) {
    const hash = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return hash === signature;
  }

  async sendNotification(userId, notification) {
    // Implement your notification logic here
    // This could be email, push notification, etc.
    console.log('Sending notification to user:', userId, notification);
  }

  async splitEscrowFunds(paymentId, customerAmount, deliveryPersonAmount, session) {
    // Implement split payment logic
    // This would involve partial refund to customer and partial transfer to driver
    // You'll need to implement this based on your specific requirements
  }

  async notifyDisputeRaised(paymentId, raisedBy) {
    // Notify admins about dispute
    const payment = await Payment.findById(paymentId);
    
    // Find admin users
    const admins = await User.find({ role: 'admin' });
    
    for (const admin of admins) {
      await this.sendNotification(admin._id, {
        title: '⚠️ Dispute Raised',
        message: `A dispute has been raised by ${raisedBy} for payment ${paymentId}`,
        data: { paymentId, raisedBy, payment }
      });
    }
  }
}

export default new PaymentService();