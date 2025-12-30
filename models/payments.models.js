// models/payment.models.js
import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  // Payment details
  paymentId: {
    type: String,
    unique: true,
    required: true
  },
  reference: {
    type: String,
    unique: true,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'NGN',
    enum: ['NGN', 'USD', 'EUR', 'GBP']
  },
  
  // Related entities
  deliveryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery',
    required: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deliveryPersonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  
  // Escrow details
  isEscrow: {
    type: Boolean,
    default: true
  },
  escrowStatus: {
    type: String,
    enum: [
      'pending',      // Payment initiated
      'held',         // Funds held in escrow
      'released',     // Funds released to delivery person
      'refunded',     // Funds refunded to customer
      'disputed',     // Dispute initiated
      'cancelled'     // Payment cancelled
    ],
    default: 'pending'
  },
  
  // Payment provider details
  provider: {
    type: String,
    enum: ['paystack', 'flutterwave', 'stripe', 'manual'],
    default: 'paystack'
  },
  providerData: {
    type: mongoose.Schema.Types.Mixed
  },
  
  // Payment timeline
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  heldAt: Date,        // When funds moved to escrow
  releasedAt: Date,    // When funds released
  refundedAt: Date,    // When funds refunded
  disputedAt: Date,    // When dispute started
  resolvedAt: Date,    // When dispute resolved
  
  // Release conditions
  releaseConditions: {
    type: String,
    enum: [
      'delivery_confirmed',  // Customer confirms delivery
      'auto_24h',            // Auto-release after 24h
      'auto_48h',            // Auto-release after 48h
      'manual_release',      // Manual release by admin
      'dispute_resolution'   // After dispute resolution
    ],
    default: 'delivery_confirmed'
  },
  
  // Dispute information
  dispute: {
    reason: String,
    description: String,
    raisedBy: {
      type: String,
      enum: ['customer', 'delivery_person']
    },
    evidence: [{
      type: String, // URLs to evidence files
      description: String
    }],
    resolution: {
      decision: {
        type: String,
        enum: ['customer_wins', 'delivery_person_wins', 'split', 'cancelled']
      },
      customerAmount: Number,
      deliveryPersonAmount: Number,
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User' // Admin who resolved
      },
      notes: String
    }
  },
  
  // Fees and breakdown
  fees: {
    platformFee: {
      type: Number,
      default: 0.10 // 10% platform fee
    },
    transactionFee: Number,
    deliveryPersonAmount: Number,
    platformAmount: Number,
    totalAmount: Number
  },
  
  // Metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceInfo: String
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
paymentSchema.index({ customerId: 1, status: 1 });
paymentSchema.index({ deliveryId: 1 }, { unique: true });
paymentSchema.index({ reference: 1 }, { unique: true });
paymentSchema.index({ escrowStatus: 1 });
paymentSchema.index({ createdAt: -1 });

// Pre-save middleware
paymentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Generate payment ID if not exists
  if (!this.paymentId) {
    this.paymentId = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Generate reference if not exists
  if (!this.reference) {
    this.reference = `REF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  next();
});

// Calculate fees
paymentSchema.methods.calculateFees = function() {
  const platformFeePercentage = this.fees.platformFee || 0.10;
  const platformAmount = this.amount * platformFeePercentage;
  const deliveryPersonAmount = this.amount - platformAmount;
  
  this.fees = {
    ...this.fees,
    platformAmount,
    deliveryPersonAmount,
    totalAmount: this.amount
  };
  
  return this.fees;
};

// Method to hold funds in escrow
paymentSchema.methods.holdInEscrow = async function(providerData = {}) {
  if (this.escrowStatus !== 'pending') {
    throw new Error(`Cannot hold funds. Current status: ${this.escrowStatus}`);
  }
  
  this.escrowStatus = 'held';
  this.heldAt = new Date();
  this.providerData = {
    ...this.providerData,
    escrowId: providerData.escrowId || `ESCROW-${Date.now()}`,
    holdReference: providerData.holdReference
  };
  
  return this.save();
};

// Method to release funds
paymentSchema.methods.releaseFromEscrow = async function(reason = 'delivery_confirmed') {
  if (this.escrowStatus !== 'held') {
    throw new Error(`Cannot release funds. Current status: ${this.escrowStatus}`);
  }
  
  this.escrowStatus = 'released';
  this.releasedAt = new Date();
  this.releaseConditions = reason;
  
  return this.save();
};

// Method to refund funds
paymentSchema.methods.refundFromEscrow = async function(reason = 'cancelled') {
  if (!['held', 'pending'].includes(this.escrowStatus)) {
    throw new Error(`Cannot refund funds. Current status: ${this.escrowStatus}`);
  }
  
  this.escrowStatus = 'refunded';
  this.refundedAt = new Date();
  
  return this.save();
};

// Method to raise dispute
paymentSchema.methods.raiseDispute = async function(raisedBy, reason, description, evidence = []) {
  if (this.escrowStatus !== 'held') {
    throw new Error(`Cannot raise dispute. Funds not in escrow: ${this.escrowStatus}`);
  }
  
  this.escrowStatus = 'disputed';
  this.disputedAt = new Date();
  this.dispute = {
    reason,
    description,
    raisedBy,
    evidence
  };
  
  return this.save();
};

// Method to resolve dispute
paymentSchema.methods.resolveDispute = async function(decision, customerAmount, deliveryPersonAmount, resolvedBy, notes = '') {
  if (this.escrowStatus !== 'disputed') {
    throw new Error(`Cannot resolve dispute. Current status: ${this.escrowStatus}`);
  }
  
  this.escrowStatus = decision === 'cancelled' ? 'refunded' : 'released';
  this.resolvedAt = new Date();
  this.dispute.resolution = {
    decision,
    customerAmount,
    deliveryPersonAmount,
    resolvedBy,
    notes
  };
  
  return this.save();
};

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;