// models/payment.models.js
import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    // Reference IDs
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Delivery',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
    },

    // Payment Details
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'NGN',
    },
    
    // Paystack Details
    paystackReference: {
      type: String,
      unique: true,
      sparse: true,
    },
    paystackAccessCode: String,
    paystackAuthorizationUrl: String,
    
    // Payment Status
    status: {
      type: String,
      enum: ['pending', 'processing', 'successful', 'failed', 'refunded'],
      default: 'pending',
    },
    
    // Payment Method
    paymentMethod: {
      type: String,
      enum: ['card', 'bank_transfer', 'ussd', 'qr', 'mobile_money', 'cash'],
      default: 'card',
    },
    
    // Transaction Details
    paidAt: Date,
    verifiedAt: Date,
    
    // Split Payment Details
    companyAmount: Number, // Amount company receives
    driverAmount: Number, // Amount driver receives
    platformFee: Number, // Platform commission
    
    // Metadata
    metadata: {
      channel: String,
      cardType: String,
      bank: String,
      lastFourDigits: String,
      authorizationCode: String,
      customerEmail: String,
      customerName: String,
    },
    
    // Refund Details
    refund: {
      status: {
        type: String,
        enum: ['none', 'pending', 'processing', 'completed', 'failed'],
        default: 'none',
      },
      amount: Number,
      reason: String,
      processedAt: Date,
      paystackRefundId: String,
    },
    
    // Error Tracking
    errorMessage: String,
    failureReason: String,
    
    // Webhook Data
    webhookData: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ deliveryId: 1 });
paymentSchema.index({ customerId: 1 });
paymentSchema.index({ driverId: 1 });
paymentSchema.index({ companyId: 1 });
paymentSchema.index({ paystackReference: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });

// Virtual for formatted amount
paymentSchema.virtual('formattedAmount').get(function() {
  return `₦${this.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});

// Methods
paymentSchema.methods.markAsPaid = function() {
  this.status = 'successful';
  this.paidAt = new Date();
  return this.save();
};

paymentSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  return this.save();
};

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;