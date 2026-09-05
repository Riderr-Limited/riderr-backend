import mongoose from "mongoose";
import crypto from "crypto";

const errandSchema = new mongoose.Schema(
  {
    referenceId: { type: String, unique: true },

    serviceType: { type: String, default: "ERRAND", immutable: true },

    // Actors
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyId:  { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    driverId:   { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },

    // Snapshot
    customerName:  { type: String, required: true },
    customerPhone: { type: String, required: true },

    // Errand definition
    errandType: {
      type: String,
      enum: ["PICKUP_DELIVERY", "PURCHASE", "DOCUMENT_COLLECTION", "STOCK_MOVEMENT", "CUSTOM"],
      required: true,
    },
    description:     { type: String, required: true },
    specialInstructions: String,
    preferredTime:   Date,

    // Locations
    pickupLocation: {
      address:      { type: String, required: true },
      lat:          Number,
      lng:          Number,
      instructions: String,
    },
    destination: {
      address: String,
      lat:     Number,
      lng:     Number,
    },

    // Financials
    estimatedItemCost: { type: Number, default: 0 },
    spendingLimit:     { type: Number, default: 0 },
    customerAdvance:   { type: Number, default: 0 }, // cash given to rider
    actualSpend:       { type: Number, default: 0 },
    balanceReturned:   { type: Number, default: 0 },
    serviceFee:        { type: Number, default: 0 },

    // Payment
    paymentMethod: {
      type: String,
      enum: ["CASH", "CARD", "WALLET"],
      default: "CASH",
    },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PAID", "REFUNDED"],
      default: "UNPAID",
    },

    // Proof / receipts
    receiptUrl:      String,
    completionProof: String, // photo URL

    // Status
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "SEARCHING_RIDER",
        "RIDER_ASSIGNED",
        "ACCEPTED",
        "IN_PROGRESS",
        "AT_PICKUP",
        "AWAITING_CONFIRMATION",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ],
      default: "REQUESTED",
      index: true,
    },

    // Cancellation
    cancelledBy:  { userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, role: String, reason: String },
    cancelledAt:  Date,
    failureReason: String,

    // Dispute
    disputeRaised:  { type: Boolean, default: false },
    disputeDetails: String,

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
    assignedAt:   Date,
    acceptedAt:   Date,
    startedAt:    Date,
    completedAt:  Date,
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
errandSchema.index({ customerId: 1, status: 1 });
errandSchema.index({ driverId: 1, status: 1 });
errandSchema.index({ companyId: 1, status: 1 });
errandSchema.index({ createdAt: -1 });

// Pre-save
errandSchema.pre("save", function () {
  if (!this.referenceId) {
    this.referenceId = `ERR-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  }
});

const Errand = mongoose.model("Errand", errandSchema);
export default Errand;
