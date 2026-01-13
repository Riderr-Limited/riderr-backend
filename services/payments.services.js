// services/payments.services.js
import Payment from '../models/payments.models.js';
import Delivery from '../models/delivery.models.js';
import Company from '../models/company.models.js';
import Driver from '../models/riders.models.js';
import User from '../models/user.models.js';
import axios from 'axios';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { sendNotification } from '../utils/notification.js';

class PaymentService {
  constructor() {
    this.paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    this.paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY;
    this.paystackBaseUrl = 'https://api.paystack.co';
    this.webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET;
    
    // Configuration
    this.platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 5;
    this.defaultDriverSharePercentage = parseFloat(process.env.DRIVER_SHARE_PERCENTAGE) || 70;
    this.defaultCompanyCommissionPercentage = parseFloat(process.env.COMPANY_COMMISSION_PERCENTAGE) || 30;
  }

  /**
   * Initialize payment with company as recipient
   */
  async initializePayment(paymentData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { deliveryId, customerId, companyId, amount, email, callback_url, metadata } = paymentData;

      // Get company details
      const company = await Company.findById(companyId).session(session);
      if (!company) {
        await session.abortTransaction();
        session.endSession();
        return {
          success: false,
          message: 'Company not found'
        };
      }

      // Get customer details
      const customer = await User.findById(customerId).session(session);
      if (!customer) {
        await session.abortTransaction();
        session.endSession();
        return {
          success: false,
          message: 'Customer not found'
        };
      }

      // Check if company has Paystack subaccount
      if (!company.paystackSubaccountCode && process.env.NODE_ENV !== 'development') {
        await session.abortTransaction();
        session.endSession();
        return {
          success: false,
          message: 'Company payment configuration not set up'
        };
      }

      // Generate unique reference
      const reference = `RID-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      
      // For development/testing, use test response
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_TEST_PAYMENTS === 'true') {
        // Create test payment record
        const payment = new Payment({
          reference: reference,
          deliveryId: deliveryId,
          customerId: customerId,
          companyId: companyId,
          amount: amount,
          currency: 'NGN',
          status: 'pending',
          escrowStatus: 'pending',
          paymentMethod: 'test_card',
          isTest: true,
          provider: 'test',
          providerData: {
            test: true,
            reference: reference
          },
          metadata: {
            ...metadata,
            testMode: true
          }
        });

        await payment.save({ session });

        await session.commitTransaction();
        session.endSession();

        return {
          success: true,
          message: 'Test payment initialized successfully',
          data: {
            authorization_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/test-payment/${reference}`,
            access_code: `test-access-${reference}`,
            reference: reference,
            amount: amount,
            currency: 'NGN',
            company: {
              id: company._id,
              name: company.name,
              email: company.email
            },
            customer: {
              id: customer._id,
              name: customer.name,
              email: customer.email
            }
          },
          metadata: {
            isTest: true,
            testInstructions: 'This is a test payment. Use test webhook to simulate success.'
          }
        };
      }

      // Production: Call Paystack API
      const requestData = {
        email: email || customer.email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference: reference,
        callback_url: callback_url || `${process.env.FRONTEND_URL}/payment/callback`,
        metadata: {
          ...metadata,
          companyId: companyId,
          companyName: company.name,
          deliveryId: deliveryId,
          customerId: customerId,
          customerName: customer.name
        },
        channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money']
      };

      // Add subaccount if company has one
      if (company.paystackSubaccountCode) {
        requestData.subaccount = company.paystackSubaccountCode;
        requestData.bearer = 'subaccount'; // Company bears the transaction fee
      }

      // Call Paystack API
      const response = await axios.post(
        `${this.paystackBaseUrl}/transaction/initialize`,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        // Create payment record
        const payment = new Payment({
          reference: response.data.data.reference,
          deliveryId: deliveryId,
          customerId: customerId,
          companyId: companyId,
          amount: amount,
          currency: 'NGN',
          status: 'pending',
          escrowStatus: 'pending',
          paymentMethod: 'card',
          provider: 'paystack',
          providerData: response.data.data,
          metadata: metadata
        });

        await payment.save({ session });

        // Update delivery payment status
        await Delivery.findByIdAndUpdate(
          deliveryId,
          { 
            paymentStatus: 'pending',
            paymentReference: response.data.data.reference
          },
          { session }
        );

        await session.commitTransaction();
        session.endSession();

        return {
          success: true,
          message: 'Payment initialized successfully',
          data: {
            authorization_url: response.data.data.authorization_url,
            access_code: response.data.data.access_code,
            reference: response.data.data.reference,
            amount: amount,
            currency: 'NGN',
            company: {
              id: company._id,
              name: company.name,
              email: company.email
            }
          }
        };
      }

      await session.abortTransaction();
      session.endSession();

      return {
        success: false,
        message: response.data.message || 'Failed to initialize payment',
        error: response.data
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      
      console.error('Initialize payment service error:', error);
      
      return {
        success: false,
        message: 'Payment initialization failed',
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Verify webhook signature from Paystack
   */
  async verifyWebhookSignature(payload, signature) {
    try {
      // For test payments, accept any signature in development
      if (process.env.NODE_ENV === 'development' && payload.data?.metadata?.testMode) {
        return true;
      }

      // Verify Paystack signature
      const hash = crypto
        .createHmac('sha512', this.webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      return hash === signature;
    } catch (error) {
      console.error('Verify webhook signature error:', error);
      return false;
    }
  }

  /**
   * Handle webhook from Paystack
   */
  async handleWebhook(payload) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { event, data } = payload;

      console.log(`Processing webhook event: ${event}`, {
        reference: data.reference,
        amount: data.amount,
        timestamp: new Date().toISOString()
      });

      // Handle different events
      switch (event) {
        case 'charge.success':
          return await this.handleSuccessfulCharge(data, session);
        
        case 'charge.failed':
          return await this.handleFailedCharge(data, session);
        
        case 'transfer.success':
          return await this.handleTransferSuccess(data, session);
        
        case 'transfer.failed':
          return await this.handleTransferFailed(data, session);
        
        case 'transfer.reversed':
          return await this.handleTransferReversed(data, session);
        
        default:
          console.log(`Unhandled webhook event: ${event}`);
          await session.abortTransaction();
          session.endSession();
          return {
            success: false,
            message: `Unhandled event: ${event}`
          };
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Handle webhook error:', error);
      return {
        success: false,
        message: 'Webhook processing failed',
        error: error.message
      };
    }
  }

  /**
   * Handle successful charge
   */
  async handleSuccessfulCharge(data, session) {
    try {
      const { reference, amount, metadata } = data;

      // Find payment by reference
      const payment = await Payment.findOne({ reference }).session(session);
      if (!payment) {
        await session.abortTransaction();
        session.endSession();
        return {
          success: false,
          message: 'Payment not found'
        };
      }

      // Check if already processed
      if (payment.status === 'success') {
        await session.abortTransaction();
        session.endSession();
        return {
          success: true,
          message: 'Payment already processed'
        };
      }

      // Update payment status
      payment.status = 'success';
      payment.paidAt = new Date();
      payment.escrowStatus = 'held'; // Funds now held in escrow
      payment.providerData = { ...payment.providerData, ...data };

      // Convert amount from kobo to Naira
      const amountInNaira = amount / 100;
      payment.amount = amountInNaira; // Update with actual amount if different

      // Get company
      const company = await Company.findById(payment.companyId).session(session);
      if (company) {
        // Update company pending balance
        company.pendingBalance = (company.pendingBalance || 0) + amountInNaira;
        await company.save({ session });
      }

      // Update delivery
      const delivery = await Delivery.findById(payment.deliveryId).session(session);
      if (delivery) {
        delivery.paymentStatus = 'paid';
        delivery.paidAt = new Date();
        delivery.paymentReference = reference;
        await delivery.save({ session });

        // Notify customer
        await sendNotification({
          userId: payment.customerId,
          title: '✅ Payment Successful',
          message: `Your payment of ₦${amountInNaira.toLocaleString()} has been received`,
          data: {
            type: 'payment_success',
            paymentId: payment._id,
            deliveryId: delivery._id,
            amount: amountInNaira
          }
        });

        // Notify company admin
        if (company) {
          const companyAdmins = company.admins || [];
          for (const admin of companyAdmins) {
            await sendNotification({
              userId: admin.userId,
              title: '💰 New Payment Received',
              message: `Payment received for delivery ${delivery.referenceId}`,
              data: {
                type: 'company_payment_received',
                paymentId: payment._id,
                deliveryId: delivery._id,
                amount: amountInNaira
              }
            });
          }
        }
      }

      await payment.save({ session });
      await session.commitTransaction();
      session.endSession();

      console.log(`Payment ${reference} processed successfully`);

      return {
        success: true,
        message: 'Payment processed successfully',
        data: {
          paymentId: payment._id,
          amount: amountInNaira,
          escrowStatus: payment.escrowStatus,
          companyId: payment.companyId
        }
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Handle successful charge error:', error);
      throw error;
    }
  }

  /**
   * Handle failed charge
   */
  async handleFailedCharge(data, session) {
    try {
      const { reference, metadata } = data;

      const payment = await Payment.findOne({ reference }).session(session);
      if (!payment) {
        await session.abortTransaction();
        session.endSession();
        return {
          success: false,
          message: 'Payment not found'
        };
      }

      // Update payment status
      payment.status = 'failed';
      payment.escrowStatus = 'failed';
      payment.failedAt = new Date();
      payment.providerData = { ...payment.providerData, ...data };

      // Update delivery
      await Delivery.findByIdAndUpdate(
        payment.deliveryId,
        { paymentStatus: 'failed' },
        { session }
      );

      // Notify customer
      await sendNotification({
        userId: payment.customerId,
        title: '❌ Payment Failed',
        message: 'Your payment failed. Please try again.',
        data: {
          type: 'payment_failed',
          paymentId: payment._id,
          deliveryId: payment.deliveryId
        }
      });

      await payment.save({ session });
      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        message: 'Payment failure handled',
        data: {
          paymentId: payment._id,
          status: payment.status
        }
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Handle failed charge error:', error);
      throw error;
    }
  }

  /**
   * Verify payment manually
   */
  async verifyPayment(reference) {
    try {
      // Find payment
      const payment = await Payment.findOne({ reference })
        .populate('companyId', 'name')
        .populate('customerId', 'name email');

      if (!payment) {
        return {
          success: false,
          message: 'Payment not found'
        };
      }

      // For test payments
      if (payment.isTest) {
        return {
          success: true,
          message: 'Test payment verified',
          data: {
            payment: payment,
            isTest: true
          }
        };
      }

      // Call Paystack API to verify
      const response = await axios.get(
        `${this.paystackBaseUrl}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`
          }
        }
      );

      if (response.data.status && response.data.data.status === 'success') {
        // Update payment if status changed
        if (payment.status !== 'success') {
          payment.status = 'success';
          payment.paidAt = new Date(response.data.data.paid_at);
          payment.escrowStatus = 'held';
          payment.providerData = response.data.data;

          // Get company and update pending balance
          const company = await Company.findById(payment.companyId);
          if (company) {
            const amountInNaira = response.data.data.amount / 100;
            company.pendingBalance = (company.pendingBalance || 0) + amountInNaira;
            await company.save();
          }

          // Update delivery
          await Delivery.findByIdAndUpdate(payment.deliveryId, {
            paymentStatus: 'paid',
            paidAt: new Date()
          });

          await payment.save();
        }

        return {
          success: true,
          message: 'Payment verified successfully',
          data: {
            payment: payment,
            providerData: response.data.data
          }
        };
      }

      return {
        success: false,
        message: response.data.message || 'Payment verification failed',
        data: response.data
      };
    } catch (error) {
      console.error('Verify payment error:', error);
      return {
        success: false,
        message: 'Payment verification failed',
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Release escrow funds to COMPANY
   */
  async releaseEscrowFundsToCompany(paymentId, reason, session = null) {
    let internalSession = session;
    let shouldCommit = !session;

    try {
      if (!internalSession) {
        internalSession = await mongoose.startSession();
        internalSession.startTransaction();
      }

      const payment = await Payment.findById(paymentId)
        .populate('companyId')
        .populate('customerId', 'name email')
        .session(internalSession);
      
      if (!payment) {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: 'Payment not found'
        };
      }

      if (payment.escrowStatus !== 'held') {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: `Funds cannot be released. Current status: ${payment.escrowStatus}`
        };
      }

      const company = payment.companyId;
      if (!company) {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: 'Company not found'
        };
      }

      // Calculate fees and splits
      const platformFee = payment.amount * (this.platformFeePercentage / 100);
      const companyAmount = payment.amount - platformFee;

      // Get driver if assigned to delivery
      let driver = null;
      let driverAmount = 0;
      const delivery = await Delivery.findById(payment.deliveryId).session(internalSession);
      
      if (delivery && delivery.driverId) {
        driver = await Driver.findById(delivery.driverId)
          .populate('userId', 'name email')
          .session(internalSession);
        
        if (driver) {
          // Use company's driver commission rate or default
          const driverSharePercentage = company.driverCommissionRate || this.defaultDriverSharePercentage;
          driverAmount = companyAmount * (driverSharePercentage / 100);
          
          // Update driver earnings
          driver.earnings = (driver.earnings || 0) + driverAmount;
          driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
          
          // Record driver payment
          driver.payments = driver.payments || [];
          driver.payments.push({
            paymentId: payment._id,
            amount: driverAmount,
            date: new Date(),
            status: 'pending' // Will be marked as paid when company transfers to driver
          });
          
          await driver.save({ session: internalSession });
        }
      }

      // Update company earnings
      const companyCommission = companyAmount - driverAmount;
      company.totalEarnings = (company.totalEarnings || 0) + companyCommission;
      company.availableBalance = (company.availableBalance || 0) + companyCommission;
      company.pendingBalance = (company.pendingBalance || 0) - payment.amount;

      // Update payment
      payment.escrowStatus = 'released';
      payment.releasedAt = new Date();
      payment.releaseReason = reason;
      payment.isReleasedToCompany = true;
      payment.fees = {
        platformAmount: platformFee,
        platformPercentage: this.platformFeePercentage,
        companyAmount: companyAmount,
        companyCommission: companyCommission,
        driverAmount: driverAmount,
        driverSharePercentage: company.driverCommissionRate || this.defaultDriverSharePercentage,
        totalAmount: payment.amount
      };

      // In production, initiate actual bank transfer to company
      if (process.env.NODE_ENV === 'production' && company.paystackRecipientCode) {
        try {
          const transferResponse = await this.initiateBankTransfer({
            recipient: company.paystackRecipientCode,
            amount: companyCommission * 100, // Convert to kobo
            reason: `Payment release for delivery ${delivery?.referenceId || paymentId}`,
            reference: `COMP-REL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
          });

          if (transferResponse.success) {
            payment.transferReference = transferResponse.data.reference;
            payment.transferStatus = 'initiated';
          } else {
            console.error('Bank transfer initiation failed:', transferResponse.message);
          }
        } catch (transferError) {
          console.error('Bank transfer error:', transferError);
          // Don't fail the entire process if transfer initiation fails
        }
      }

      // Save changes
      await Promise.all([
        payment.save({ session: internalSession }),
        company.save({ session: internalSession })
      ]);

      // Notify customer
      await sendNotification({
        userId: payment.customerId,
        title: '💰 Payment Released',
        message: `Payment of ₦${payment.amount.toLocaleString()} has been released to ${company.name}`,
        data: {
          type: 'payment_released_to_company',
          paymentId: payment._id,
          companyName: company.name,
          amount: payment.amount
        }
      });

      // Notify company
      if (company.admins && company.admins.length > 0) {
        for (const admin of company.admins) {
          await sendNotification({
            userId: admin.userId,
            title: '✅ Funds Released',
            message: `₦${companyCommission.toLocaleString()} has been added to your company balance`,
            data: {
              type: 'company_funds_released',
              paymentId: payment._id,
              amount: companyCommission,
              driverAmount: driverAmount,
              platformFee: platformFee
            }
          });
        }
      }

      // Notify driver if applicable
      if (driver && driver.userId) {
        await sendNotification({
          userId: driver.userId._id,
          title: '💸 Earnings Updated',
          message: `₦${driverAmount.toLocaleString()} has been added to your earnings`,
          data: {
            type: 'driver_earnings_updated',
            paymentId: payment._id,
            amount: driverAmount,
            deliveryId: delivery?._id
          }
        });
      }

      if (shouldCommit) {
        await internalSession.commitTransaction();
        internalSession.endSession();
      }

      return {
        success: true,
        message: 'Funds released to company successfully',
        data: {
          paymentId: payment._id,
          amount: payment.amount,
          platformFee: platformFee,
          companyCommission: companyCommission,
          driverAmount: driverAmount,
          company: {
            id: company._id,
            name: company.name,
            newBalance: company.availableBalance
          },
          releasedAt: payment.releasedAt
        }
      };
    } catch (error) {
      if (shouldCommit && internalSession) {
        await internalSession.abortTransaction();
        internalSession.endSession();
      }
      console.error('Release escrow funds to company error:', error);
      return {
        success: false,
        message: 'Failed to release funds to company',
        error: error.message
      };
    }
  }

  /**
   * Refund escrow funds to customer
   */
  async refundEscrowFunds(paymentId, reason, session = null) {
    let internalSession = session;
    let shouldCommit = !session;

    try {
      if (!internalSession) {
        internalSession = await mongoose.startSession();
        internalSession.startTransaction();
      }

      const payment = await Payment.findById(paymentId)
        .populate('customerId', 'name email')
        .populate('companyId', 'name')
        .session(internalSession);

      if (!payment) {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: 'Payment not found'
        };
      }

      if (payment.escrowStatus !== 'held') {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: `Funds cannot be refunded. Current status: ${payment.escrowStatus}`
        };
      }

      // Update company pending balance
      if (payment.companyId) {
        const company = await Company.findById(payment.companyId).session(internalSession);
        if (company) {
          company.pendingBalance = Math.max(0, (company.pendingBalance || 0) - payment.amount);
          await company.save({ session: internalSession });
        }
      }

      // Update payment
      payment.escrowStatus = 'refunded';
      payment.refundedAt = new Date();
      payment.refundReason = reason;
      payment.status = 'refunded';

      // Update delivery
      await Delivery.findByIdAndUpdate(
        payment.deliveryId,
        { 
          paymentStatus: 'refunded',
          status: 'cancelled'
        },
        { session: internalSession }
      );

      // In production, initiate actual refund via Paystack
      if (process.env.NODE_ENV === 'production' && !payment.isTest) {
        try {
          const refundResponse = await this.initiatePaystackRefund(
            payment.reference,
            payment.amount,
            reason
          );

          if (refundResponse.success) {
            payment.refundReference = refundResponse.data.reference;
            payment.refundStatus = 'initiated';
          }
        } catch (refundError) {
          console.error('Paystack refund error:', refundError);
          // Mark as refunded internally even if Paystack refund fails
        }
      }

      await payment.save({ session: internalSession });

      // Notify customer
      await sendNotification({
        userId: payment.customerId,
        title: '💸 Payment Refunded',
        message: `₦${payment.amount.toLocaleString()} has been refunded to your account`,
        data: {
          type: 'payment_refunded',
          paymentId: payment._id,
          amount: payment.amount,
          reason: reason
        }
      });

      // Notify company if applicable
      if (payment.companyId) {
        const company = await Company.findById(payment.companyId);
        if (company && company.admins) {
          for (const admin of company.admins) {
            await sendNotification({
              userId: admin.userId,
              title: '🔄 Payment Refunded',
              message: `Payment refunded to customer: ${reason}`,
              data: {
                type: 'company_payment_refunded',
                paymentId: payment._id,
                amount: payment.amount
              }
            });
          }
        }
      }

      if (shouldCommit) {
        await internalSession.commitTransaction();
        internalSession.endSession();
      }

      return {
        success: true,
        message: 'Funds refunded successfully',
        data: {
          paymentId: payment._id,
          amount: payment.amount,
          refundedAt: payment.refundedAt,
          reason: reason
        }
      };
    } catch (error) {
      if (shouldCommit && internalSession) {
        await internalSession.abortTransaction();
        internalSession.endSession();
      }
      console.error('Refund escrow funds error:', error);
      return {
        success: false,
        message: 'Failed to refund funds',
        error: error.message
      };
    }
  }

  /**
   * Split escrow funds (for dispute resolution)
   */
  async splitEscrowFunds(paymentId, customerAmount, companyAmount, session = null) {
    let internalSession = session;
    let shouldCommit = !session;

    try {
      if (!internalSession) {
        internalSession = await mongoose.startSession();
        internalSession.startTransaction();
      }

      const payment = await Payment.findById(paymentId)
        .populate('customerId', 'name email')
        .populate('companyId', 'name')
        .session(internalSession);

      if (!payment) {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: 'Payment not found'
        };
      }

      if (payment.escrowStatus !== 'held') {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: `Funds cannot be split. Current status: ${payment.escrowStatus}`
        };
      }

      const total = parseFloat(customerAmount) + parseFloat(companyAmount);
      if (Math.abs(total - payment.amount) > 1) {
        if (shouldCommit) {
          await internalSession.abortTransaction();
          internalSession.endSession();
        }
        return {
          success: false,
          message: `Total split amount (${total}) must equal payment amount (${payment.amount})`
        };
      }

      // Update payment
      payment.escrowStatus = 'split';
      payment.splitAmounts = {
        customer: parseFloat(customerAmount),
        company: parseFloat(companyAmount)
      };
      payment.splitAt = new Date();

      // Update company balance
      if (payment.companyId) {
        const company = await Company.findById(payment.companyId).session(internalSession);
        if (company) {
          company.pendingBalance = Math.max(0, (company.pendingBalance || 0) - payment.amount);
          company.availableBalance = (company.availableBalance || 0) + parseFloat(companyAmount);
          await company.save({ session: internalSession });
        }
      }

      // Refund customer portion
      if (parseFloat(customerAmount) > 0) {
        await this.refundEscrowFunds(
          paymentId,
          'Dispute resolution split - customer portion',
          internalSession
        );
      }

      // Release company portion
      if (parseFloat(companyAmount) > 0) {
        await this.releaseEscrowFundsToCompany(
          paymentId,
          'Dispute resolution split - company portion',
          internalSession
        );
      }

      await payment.save({ session: internalSession });

      // Notify customer
      if (parseFloat(customerAmount) > 0) {
        await sendNotification({
          userId: payment.customerId,
          title: '💰 Partial Refund',
          message: `₦${parseFloat(customerAmount).toLocaleString()} has been refunded to your account`,
          data: {
            type: 'payment_split_customer',
            paymentId: payment._id,
            amount: parseFloat(customerAmount),
            total: payment.amount
          }
        });
      }

      // Notify company
      if (parseFloat(companyAmount) > 0 && payment.companyId) {
        const company = await Company.findById(payment.companyId);
        if (company && company.admins) {
          for (const admin of company.admins) {
            await sendNotification({
              userId: admin.userId,
              title: '💰 Partial Release',
              message: `₦${parseFloat(companyAmount).toLocaleString()} has been added to your company balance`,
              data: {
                type: 'payment_split_company',
                paymentId: payment._id,
                amount: parseFloat(companyAmount),
                total: payment.amount
              }
            });
          }
        }
      }

      if (shouldCommit) {
        await internalSession.commitTransaction();
        internalSession.endSession();
      }

      return {
        success: true,
        message: 'Funds split successfully',
        data: {
          paymentId: payment._id,
          customerAmount: parseFloat(customerAmount),
          companyAmount: parseFloat(companyAmount),
          total: payment.amount,
          splitAt: payment.splitAt
        }
      };
    } catch (error) {
      if (shouldCommit && internalSession) {
        await internalSession.abortTransaction();
        internalSession.endSession();
      }
      console.error('Split escrow funds error:', error);
      return {
        success: false,
        message: 'Failed to split funds',
        error: error.message
      };
    }
  }

  /**
   * Create transfer recipient for company
   */
  async createTransferRecipient(data) {
    try {
      const { companyId, accountNumber, bankCode, accountName } = data;

      const company = await Company.findById(companyId);
      if (!company) {
        return {
          success: false,
          message: 'Company not found'
        };
      }

      // If already has recipient code
      if (company.paystackRecipientCode) {
        return {
          success: false,
          message: 'Transfer recipient already exists'
        };
      }

      // Call Paystack API to create transfer recipient
      const response = await axios.post(
        `${this.paystackBaseUrl}/transferrecipient`,
        {
          type: 'nuban',
          name: accountName || company.name,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: 'NGN'
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        company.paystackRecipientCode = response.data.data.recipient_code;
        company.bankDetails = {
          accountNumber,
          bankCode,
          accountName: accountName || company.name,
          bankName: response.data.data.details?.bank_name || 'Unknown'
        };
        await company.save();

        return {
          success: true,
          message: 'Transfer recipient created successfully',
          data: {
            recipientCode: response.data.data.recipient_code,
            companyId: company._id,
            bankDetails: company.bankDetails
          }
        };
      }

      return {
        success: false,
        message: response.data.message || 'Failed to create transfer recipient'
      };
    } catch (error) {
      console.error('Create transfer recipient error:', error);
      return {
        success: false,
        message: 'Failed to create transfer recipient',
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Initiate bank transfer to company
   */
  async initiateBankTransfer(transferData) {
    try {
      const { recipient, amount, reason, reference } = transferData;

      const response = await axios.post(
        `${this.paystackBaseUrl}/transfer`,
        {
          source: 'balance',
          amount: Math.round(amount),
          recipient: recipient,
          reason: reason || 'Payment release',
          reference: reference || `TRF-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        return {
          success: true,
          message: 'Transfer initiated successfully',
          data: response.data.data
        };
      }

      return {
        success: false,
        message: response.data.message || 'Failed to initiate transfer'
      };
    } catch (error) {
      console.error('Initiate bank transfer error:', error);
      return {
        success: false,
        message: 'Bank transfer failed',
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Initiate Paystack refund
   */
  async initiatePaystackRefund(reference, amount, reason) {
    try {
      const response = await axios.post(
        `${this.paystackBaseUrl}/refund`,
        {
          transaction: reference,
          amount: Math.round(amount * 100), // Convert to kobo
          currency: 'NGN',
          customer_note: reason || 'Refund requested'
        },
        {
          headers: {
            Authorization: `Bearer ${this.paystackSecretKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.status) {
        return {
          success: true,
          message: 'Refund initiated successfully',
          data: response.data.data
        };
      }

      return {
        success: false,
        message: response.data.message || 'Failed to initiate refund'
      };
    } catch (error) {
      console.error('Initiate Paystack refund error:', error);
      return {
        success: false,
        message: 'Refund initiation failed',
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Notify about dispute raised
   */
  async notifyDisputeRaised(paymentId, raisedBy) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate('customerId', 'name')
        .populate('companyId', 'name admins');

      if (!payment) return;

      // Notify admins
      const admins = await User.find({ role: 'admin' });
      
      for (const admin of admins) {
        await sendNotification({
          userId: admin._id,
          title: '⚠️ New Dispute Raised',
          message: `Dispute raised by ${raisedBy} for payment ${payment.reference}`,
          data: {
            type: 'new_dispute',
            paymentId: payment._id,
            raisedBy: raisedBy,
            amount: payment.amount
          }
        });
      }

      // Notify the other party
      if (raisedBy === 'customer' && payment.companyId) {
        const company = payment.companyId;
        if (company.admins) {
          for (const admin of company.admins) {
            await sendNotification({
              userId: admin.userId,
              title: '⚠️ Dispute Raised',
              message: `Customer raised dispute for payment ${payment.reference}`,
              data: {
                type: 'customer_dispute',
                paymentId: payment._id,
                customerName: payment.customerId?.name
              }
            });
          }
        }
      } else if (raisedBy === 'company_admin' || raisedBy === 'driver') {
        await sendNotification({
          userId: payment.customerId,
          title: '⚠️ Dispute Raised',
          message: `Company raised dispute for your payment ${payment.reference}`,
          data: {
            type: 'company_dispute',
            paymentId: payment._id,
            companyName: payment.companyId?.name
          }
        });
      }
    } catch (error) {
      console.error('Notify dispute raised error:', error);
    }
  }

  /**
   * Handle transfer success webhook
   */
  async handleTransferSuccess(data, session) {
    try {
      const { reference, amount, recipient } = data;

      // Find payment by transfer reference
      const payment = await Payment.findOne({ transferReference: reference }).session(session);
      if (payment) {
        payment.transferStatus = 'success';
        payment.transferCompletedAt = new Date();
        await payment.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        message: 'Transfer success handled'
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Handle transfer success error:', error);
      throw error;
    }
  }

  /**
   * Handle transfer failed webhook
   */
  async handleTransferFailed(data, session) {
    try {
      const { reference, amount, recipient } = data;

      // Find payment by transfer reference
      const payment = await Payment.findOne({ transferReference: reference }).session(session);
      if (payment) {
        payment.transferStatus = 'failed';
        payment.transferFailedAt = new Date();
        await payment.save({ session });

        // Notify company admin
        if (payment.companyId) {
          const company = await Company.findById(payment.companyId);
          if (company && company.admins) {
            for (const admin of company.admins) {
              await sendNotification({
                userId: admin.userId,
                title: '❌ Transfer Failed',
                message: `Bank transfer failed for payment ${payment.reference}`,
                data: {
                  type: 'transfer_failed',
                  paymentId: payment._id,
                  amount: amount / 100
                }
              });
            }
          }
        }
      }

      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        message: 'Transfer failure handled'
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Handle transfer failed error:', error);
      throw error;
    }
  }

  /**
   * Handle transfer reversed webhook
   */
  async handleTransferReversed(data, session) {
    try {
      const { reference, amount, recipient } = data;

      // Find payment by transfer reference
      const payment = await Payment.findOne({ transferReference: reference }).session(session);
      if (payment) {
        payment.transferStatus = 'reversed';
        payment.transferReversedAt = new Date();
        await payment.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      return {
        success: true,
        message: 'Transfer reversal handled'
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Handle transfer reversed error:', error);
      throw error;
    }
  }

  /**
   * Get payment analytics for dashboard
   */
  async getPaymentAnalytics(companyId = null, startDate = null, endDate = null) {
    try {
      const matchStage = {};
      
      if (companyId) {
        matchStage.companyId = new mongoose.Types.ObjectId(companyId);
      }
      
      if (startDate || endDate) {
        matchStage.createdAt = {};
        if (startDate) matchStage.createdAt.$gte = new Date(startDate);
        if (endDate) matchStage.createdAt.$lte = new Date(endDate);
      }

      const analytics = await Payment.aggregate([
        { $match: matchStage },
        {
          $facet: {
            // Total summary
            totals: [
              {
                $group: {
                  _id: null,
                  totalPayments: { $sum: 1 },
                  totalAmount: { $sum: '$amount' },
                  averageAmount: { $avg: '$amount' },
                  minAmount: { $min: '$amount' },
                  maxAmount: { $max: '$amount' }
                }
              }
            ],
            // Status breakdown
            byStatus: [
              {
                $group: {
                  _id: '$escrowStatus',
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' }
                }
              }
            ],
            // Daily trends (last 30 days)
            dailyTrends: [
              {
                $match: {
                  createdAt: {
                    $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
                  }
                }
              },
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' }
                }
              },
              { $sort: { '_id': 1 } }
            ],
            // Company breakdown (for admin)
            companyBreakdown: companyId ? [] : [
              {
                $group: {
                  _id: '$companyId',
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' }
                }
              },
              { $sort: { amount: -1 } },
              { $limit: 10 }
            ],
            // Monthly breakdown
            monthlyBreakdown: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  amount: { $sum: '$amount' }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1 } }
            ]
          }
        }
      ]);

      // Get company names for breakdown
      if (analytics[0]?.companyBreakdown && !companyId) {
        const companyIds = analytics[0].companyBreakdown.map(item => item._id);
        const companies = await Company.find({ _id: { $in: companyIds } })
          .select('name');
        
        const companyMap = {};
        companies.forEach(company => {
          companyMap[company._id] = company.name;
        });

        analytics[0].companyBreakdown = analytics[0].companyBreakdown.map(item => ({
          ...item,
          companyName: companyMap[item._id] || 'Unknown Company'
        }));
      }

      return {
        success: true,
        data: analytics[0]
      };
    } catch (error) {
      console.error('Get payment analytics error:', error);
      return {
        success: false,
        message: 'Failed to get payment analytics',
        error: error.message
      };
    }
  }

  /**
   * Get driver earnings report
   */
  async getDriverEarningsReport(driverId, startDate = null, endDate = null) {
    try {
      // Get driver
      const driver = await Driver.findById(driverId)
        .populate('companyId', 'name driverCommissionRate')
        .populate('userId', 'name email');
      
      if (!driver) {
        return {
          success: false,
          message: 'Driver not found'
        };
      }

      // Get deliveries by this driver
      const deliveries = await Delivery.find({ 
        driverId: driver._id,
        status: 'delivered'
      }).select('_id');

      const deliveryIds = deliveries.map(d => d._id);

      // Build query
      const query = {
        deliveryId: { $in: deliveryIds },
        companyId: driver.companyId?._id
      };

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      // Get payments
      const payments = await Payment.find(query)
        .populate('deliveryId', 'pickup dropoff fare createdAt')
        .sort({ createdAt: -1 });

      // Calculate earnings
      const driverSharePercentage = driver.companyId?.driverCommissionRate || this.defaultDriverSharePercentage;
      let totalEarnings = 0;
      let pendingEarnings = 0;
      let releasedEarnings = 0;

      const earningsByMonth = {};
      const earningsByDelivery = payments.map(payment => {
        const driverEarnings = payment.amount * (driverSharePercentage / 100);
        
        // Add to totals
        totalEarnings += driverEarnings;
        if (payment.escrowStatus === 'held') pendingEarnings += driverEarnings;
        if (payment.escrowStatus === 'released') releasedEarnings += driverEarnings;

        // Group by month
        const monthKey = `${payment.createdAt.getFullYear()}-${payment.createdAt.getMonth() + 1}`;
        earningsByMonth[monthKey] = (earningsByMonth[monthKey] || 0) + driverEarnings;

        return {
          paymentId: payment._id,
          deliveryId: payment.deliveryId?._id,
          amount: payment.amount,
          driverEarnings,
          commissionPercentage: driverSharePercentage,
          status: payment.escrowStatus,
          date: payment.createdAt,
          pickup: payment.deliveryId?.pickup?.address,
          dropoff: payment.deliveryId?.dropoff?.address
        };
      });

      // Format monthly breakdown
      const monthlyBreakdown = Object.entries(earningsByMonth).map(([month, amount]) => ({
        month,
        amount,
        deliveryCount: earningsByDelivery.filter(e => 
          `${e.date.getFullYear()}-${e.date.getMonth() + 1}` === month
        ).length
      })).sort((a, b) => b.month.localeCompare(a.month));

      return {
        success: true,
        data: {
          driver: {
            id: driver._id,
            name: driver.userId?.name,
            email: driver.userId?.email,
            company: driver.companyId?.name
          },
          summary: {
            totalEarnings,
            pendingEarnings,
            releasedEarnings,
            commissionPercentage: driverSharePercentage,
            totalDeliveries: deliveries.length,
            averageEarningsPerDelivery: deliveries.length > 0 ? totalEarnings / deliveries.length : 0
          },
          monthlyBreakdown,
          recentEarnings: earningsByDelivery.slice(0, 20)
        }
      };
    } catch (error) {
      console.error('Get driver earnings report error:', error);
      return {
        success: false,
        message: 'Failed to get driver earnings report',
        error: error.message
      };
    }
  }
}

export default new PaymentService();