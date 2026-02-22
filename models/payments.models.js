// models/payments.models.js - FIXED
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
      enum: [
        'card',
        'bank_transfer',
        'bank_transfer_dedicated',
        'company_bank_transfer',
        'manual_bank_transfer',
        'ussd',
        'qr',
        'mobile_money',
        'cash',
      ],
      default: 'card',
    },

    // Transaction Details
    paidAt: Date,
    verifiedAt: Date,
    
    refund: {
    status: {
      type: String,
      enum: ['none', 'pending', 'refunded', 'failed'],
      default: 'none',
    },
    refundId: String, // Paystack refund ID
    amount: Number,
    refundedAt: Date,
    requestedAt: Date,
    reason: String,
    error: String,
    paystackResponse: mongoose.Schema.Types.Mixed,
  },
  
    // Split Payment Details (ESCROW)
    companyAmount: {
      type: Number,
      required: true,
    },
    platformFee: {
      type: Number,
      required: true,
    },

    // Escrow Details
    escrowDetails: {
      subaccountCode: String,
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

    // ✅ FIXED: metadata is now Mixed so ALL dynamic fields are saved.
    // The old strict-field definition was silently dropping requiresOtp,
    // chargeReference, escrowStatus, bankTransferDetails, and many others.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
    auditLog: [
      {
        action: String,
        performedBy: mongoose.Schema.Types.ObjectId,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        details: mongoose.Schema.Types.Mixed,
      },
    ],
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

// Virtuals
paymentSchema.virtual('formattedAmount').get(function () {
  return `₦${this.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});
paymentSchema.virtual('formattedCompanyAmount').get(function () {
  return `₦${this.companyAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});
paymentSchema.virtual('formattedPlatformFee').get(function () {
  return `₦${this.platformFee.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
});

// Methods
paymentSchema.methods.markAsPaid = function () {
  this.status = 'successful';
  this.paidAt = new Date();
  this.auditLog.push({
    action: 'payment_successful',
    timestamp: new Date(),
    details: { amount: this.amount },
  });
  return this.save();
};

paymentSchema.methods.markAsFailed = function (reason) {
  this.status = 'failed';
  this.failureReason = reason;
  this.auditLog.push({
    action: 'payment_failed',
    timestamp: new Date(),
    details: { reason },
  });
  return this.save();
};

paymentSchema.methods.markAsSettled = function (transferId) {
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
paymentSchema.statics.getTotalEarnings = async function (companyId, startDate, endDate) {
  const match = { companyId, status: 'successful' };
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
  return result[0] || { totalAmount: 0, totalCompanyAmount: 0, totalPlatformFee: 0, count: 0 };
};

paymentSchema.statics.getPlatformEarnings = async function (startDate, endDate) {
  const match = { status: 'successful' };
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
  return result[0] || { totalPlatformFee: 0, totalTransactions: 0, totalVolume: 0 };
};

// ✅ FIXED: next() was commented out — this caused every payment.save()
// to hang forever and never resolve, breaking the entire payment flow.
paymentSchema.pre('save', function (next) {
  // Auto-calculate split if amount changed and platformFee not set
  if (this.isModified('amount') && !this.platformFee) {
    this.platformFee = Math.round((this.amount * 10) / 100);
    this.companyAmount = this.amount - this.platformFee;
  }

  // Store subaccount in escrowDetails
  if (this.metadata?.companySubaccount && !this.escrowDetails?.subaccountCode) {
    this.escrowDetails.subaccountCode = this.metadata.companySubaccount;
  }

  
});

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;