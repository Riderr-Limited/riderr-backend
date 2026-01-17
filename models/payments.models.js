// models/payment.models.js
import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    // Reference IDs
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Delivery',
      required: true,
      index: true, // Added index here
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, 
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      index: true, 
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      index: true, 
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
      sparse: true, // This allows null values without violating uniqueness
    },
    paystackAccessCode: String,
    paystackAuthorizationUrl: String,
    
    // Payment Status
    status: {
      type: String,
      enum: ['pending', 'processing', 'successful', 'failed', 'refunded'],
      default: 'pending',
      index: true, // Added index here
    },
    
    // Payment Method
    paymentMethod: {
      type: String,
      enum: ['card', 'bank_transfer', 'ussd', 'qr', 'mobile_money', 'cash'],
      default: 'card',
    },
    
paymentId: {
  type: String,
  unique: true,
  sparse: true,
  default: () => new mongoose.Types.ObjectId().toString(), // Generate unique ID
},
    
    // Transaction Details
    paidAt: Date,
    verifiedAt: Date,
    
    // Split Payment Details
    companyAmount: Number, // Amount company receives
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

// REMOVE THESE INDEXES - they're now defined in the schema
// paymentSchema.index({ deliveryId: 1 });
// paymentSchema.index({ customerId: 1 });
// paymentSchema.index({ driverId: 1 });
// paymentSchema.index({ companyId: 1 });
// paymentSchema.index({ status: 1 });

// Only keep these compound or specific indexes
paymentSchema.index({ paystackReference: 1 }); // Keep this separate
paymentSchema.index({ createdAt: -1 }); // For sorting by latest

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

// Add a pre-save hook to prevent the null paymentId issue
paymentSchema.pre('save', function( ) {
  // If there's a paymentId field that's null, delete it
  if (this.paymentId === null || this.paymentId === undefined) {
    delete this.paymentId;
  }
 
});

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;