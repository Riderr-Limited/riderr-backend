// models/payments.models.js - WITH ESCROW SUPPORT
import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    // Reference IDs
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Delivery',
      required: true,
      index: true,
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
    
    // Payment Type
    paymentType: {
      type: String,
      enum: ['escrow', 'direct', 'cash'],
      default: 'escrow',
      index: true,
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
      index: true,
    },
    
    // Payment Method
    paymentMethod: {
      type: String,
      enum: ['card', 'bank_transfer', 'ussd', 'qr', 'mobile_money', 'cash', 'manual_bank_transfer'],
      default: 'card',
    },
    
    // Transaction Details
    paidAt: Date,
    verifiedAt: Date,
    
    // Split Payment Details (ESCROW)
    companyAmount: {
      type: Number,
      required: true,
    }, // Amount company receives (90%)
    platformFee: {
      type: Number,
      required: true,
    }, // Platform commission (10%)
    
    // Escrow Details
    escrowDetails: {
      subaccountCode: String, // Company's Paystack subaccount
      splitType: {
        type: String,
        enum: ['subaccount', 'percentage', 'flat'],
        default: 'subaccount',
      },
      platformPercentage: {
        type: Number,
        default: 10,
      },
      settledToCompany: {
        type: Boolean,
        default: false,
      },
      settlementDate: Date,
      paystackTransferId: String,
    },
    
    // Metadata
    metadata: {
      channel: String,
      cardType: String,
      bank: String,
      lastFourDigits: String,
      authorizationCode: String,
      customerEmail: String,
      customerName: String,
      companySubaccount: String,
      splitType: String,
      // Split amounts from Paystack
      subaccountAmount: Number,
      platformAmount: Number,
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
    
    // Audit Trail
    auditLog: [{
      action: String,
      performedBy: mongoose.Schema.Types.ObjectId,
      timestamp: {
        type: Date,
        default: Date.now,
      },
      details: mongoose.Schema.Types.Mixed,
    }],
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ paystackReference: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ 'escrowDetails.subaccountCode': 1 });
paymentSchema.index({ paymentType: 1, status: 1 });

// Virtual for formatted amount
paymentSchema.virtual('formattedAmount').get(function() {
  return `₦${this.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});

paymentSchema.virtual('formattedCompanyAmount').get(function() {
  return `₦${this.companyAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});

paymentSchema.virtual('formattedPlatformFee').get(function() {
  return `₦${this.platformFee.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});

// Methods
paymentSchema.methods.markAsPaid = function() {
  this.status = 'successful';
  this.paidAt = new Date();
  
  this.auditLog.push({
    action: 'payment_successful',
    timestamp: new Date(),
    details: { amount: this.amount },
  });
  
  return this.save();
};

paymentSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.failureReason = reason;
  
  this.auditLog.push({
    action: 'payment_failed',
    timestamp: new Date(),
    details: { reason },
  });
  
  return this.save();
};

paymentSchema.methods.markAsSettled = function(transferId) {
  this.escrowDetails.settledToCompany = true;
  this.escrowDetails.settlementDate = new Date();
  this.escrowDetails.paystackTransferId = transferId;
  
  this.auditLog.push({
    action: 'settled_to_company',
    timestamp: new Date(),
    details: { transferId },
  });
  
  return this.save();
};

// Statics
paymentSchema.statics.getTotalEarnings = async function(companyId, startDate, endDate) {
  const match = {
    companyId: companyId,
    status: 'successful',
  };
  
  if (startDate || endDate) {
    match.paidAt = {};
    if (startDate) match.paidAt.$gte = new Date(startDate);
    if (endDate) match.paidAt.$lte = new Date(endDate);
  }
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        totalCompanyAmount: { $sum: '$companyAmount' },
        totalPlatformFee: { $sum: '$platformFee' },
        count: { $sum: 1 },
      },
    },
  ]);
  
  return result[0] || {
    totalAmount: 0,
    totalCompanyAmount: 0,
    totalPlatformFee: 0,
    count: 0,
  };
};

paymentSchema.statics.getPlatformEarnings = async function(startDate, endDate) {
  const match = {
    status: 'successful',
  };
  
  if (startDate || endDate) {
    match.paidAt = {};
    if (startDate) match.paidAt.$gte = new Date(startDate);
    if (endDate) match.paidAt.$lte = new Date(endDate);
  }
  
  const result = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalPlatformFee: { $sum: '$platformFee' },
        totalTransactions: { $sum: 1 },
        totalVolume: { $sum: '$amount' },
      },
    },
  ]);
  
  return result[0] || {
    totalPlatformFee: 0,
    totalTransactions: 0,
    totalVolume: 0,
  };
};

// Pre-save hook
paymentSchema.pre('save', function(next) {
  // Auto-calculate split if not set
  if (this.isModified('amount') && !this.platformFee) {
    this.platformFee = Math.round((this.amount * 10) / 100);
    this.companyAmount = this.amount - this.platformFee;
  }
  
  // Store subaccount in escrowDetails
  if (this.metadata?.companySubaccount && !this.escrowDetails.subaccountCode) {
    this.escrowDetails.subaccountCode = this.metadata.companySubaccount;
  }
  
 // next();
});

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;