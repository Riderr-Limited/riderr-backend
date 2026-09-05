import mongoose from "mongoose";
import crypto from "crypto";

const podSchema = new mongoose.Schema(
  {
    referenceId: { type: String, unique: true },

    // Service type identifier
    serviceType: { type: String, default: "PAY_ON_DELIVERY", immutable: true },

    // Actors
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    companyId:  { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    driverId:   { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },

    // Snapshot details (denormalised for audit)
    customerName:  { type: String, required: true },
    customerPhone: { type: String, required: true },
    merchantName:  String,
    merchantPhone: String,

    // Product
    product: {
      name:        { type: String, required: true },
      description: String,
      quantity:    { type: Number, default: 1 },
      imageUrl:    String,
    },

    // Locations
    pickup: {
      address:      String,
      lat:          Number,
      lng:          Number,
      instructions: String,
    },
    dropoff: {
      address:      { type: String, required: true },
      lat:          Number,
      lng:          Number,
      recipientName:  String,
      recipientPhone: String,
      instructions: String,
    },

    // Financials
    productAmount:  { type: Number, required: true, min: 0 },
    deliveryFee:    { type: Number, default: 0, min: 0 },
    handlingFee:    { type: Number, default: 0, min: 0 },
    amountToCollect: { type: Number }, // computed pre-save

    // Payment
    paymentMethod: {
      type: String,
      enum: ["CASH_ON_DELIVERY", "PREPAID", "OTHER"],
      default: "CASH_ON_DELIVERY",
    },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "COLLECTED", "FAILED", "REFUNDED", "SETTLED"],
      default: "UNPAID",
    },
    paymentReference: String,
    paymentCollectedAt: Date,

    // POD-specific status
    status: {
      type: String,
      enum: [
        "POD_REQUESTED",
        "CONFIRMED",
        "READY_FOR_DELIVERY",
        "OUT_FOR_DELIVERY",
        "AWAITING_CUSTOMER",
        "DELIVERED_PAID",
        "REJECTED_RETURN",
        "SETTLED",
        "CANCELLED",
      ],
      default: "POD_REQUESTED",
      index: true,
    },

    // Inspection / return rules set by merchant
    inspectionAllowed: { type: Boolean, default: true },
    returnWindowHours: { type: Number, default: 24 },
    returnConditions:  String,

    // Rejection / return
    rejectionReason: String,
    rejectedAt:      Date,
    returnStatus:    { type: String, enum: ["NONE", "PENDING", "RETURNED"], default: "NONE" },

    // Settlement
    settlementAmount: Number,
    settledAt:        Date,

    // Audit trail
    auditLog: [
      {
        action:    String,
        actor:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        actorRole: String,
        timestamp: { type: Date, default: Date.now },
        note:      String,
      },
    ],

    // Timestamps
    confirmedAt:        Date,
    readyAt:            Date,
    outForDeliveryAt:   Date,
    awaitingCustomerAt: Date,
    deliveredAt:        Date,
    cancelledAt:        Date,
    cancelledBy:        { userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, role: String, reason: String },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
podSchema.index({ customerId: 1, status: 1 });
podSchema.index({ companyId: 1, status: 1 });
podSchema.index({ driverId: 1, status: 1 });
podSchema.index({ merchantId: 1, status: 1 });
podSchema.index({ createdAt: -1 });

// Pre-save
podSchema.pre("save", function () {
  if (!this.referenceId) {
    this.referenceId = `POD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  }
  // Always recompute amountToCollect
  this.amountToCollect = (this.productAmount || 0) + (this.deliveryFee || 0) + (this.handlingFee || 0);
});

const POD = mongoose.model("POD", podSchema);
export default POD;
