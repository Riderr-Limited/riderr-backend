import mongoose from "mongoose";
import crypto from "crypto";

const manualRecordSchema = new mongoose.Schema(
  {
    referenceId: { type: String, unique: true },

    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    driverId:  { type: mongoose.Schema.Types.ObjectId, ref: "Driver", index: true },

    // Snapshot of driver name in case driver is removed later
    driverName:  String,
    driverPhone: String,

    // Type of service
    serviceType: {
      type: String,
      enum: ["DELIVERY", "ERRAND", "PAY_ON_DELIVERY", "RIDE", "OTHER"],
      required: true,
    },

    // Custom label for OTHER type
    customServiceLabel: String,

    // Basic details
    description:    { type: String, required: true },
    pickupAddress:  String,
    dropoffAddress: String,

    // Customer info (optional — may be a walk-in)
    customerName:  String,
    customerPhone: String,

    // Financials
    amount:        { type: Number, default: 0, min: 0 },
    deliveryFee:   { type: Number, default: 0, min: 0 },
    totalAmount:   { type: Number, default: 0, min: 0 }, // computed pre-save

    // Payment
    paymentMethod: {
      type: String,
      enum: ["CASH", "TRANSFER", "POS", "CREDIT", "OTHER"],
      default: "CASH",
    },
    paymentStatus: {
      type: String,
      enum: ["PAID", "UNPAID", "PARTIAL"],
      default: "PAID",
    },
    amountPaid:    { type: Number, default: 0 },
    balance:       { type: Number, default: 0 }, // computed pre-save

    // Status
    status: {
      type: String,
      enum: ["COMPLETED", "PENDING", "CANCELLED", "FAILED"],
      default: "COMPLETED",
    },

    // Date the delivery actually happened (may differ from createdAt)
    deliveryDate: { type: Date, default: Date.now },

    // Notes
    notes: String,

    // Recorded by
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
manualRecordSchema.index({ companyId: 1, createdAt: -1 });
manualRecordSchema.index({ companyId: 1, driverId: 1 });
manualRecordSchema.index({ companyId: 1, serviceType: 1 });
manualRecordSchema.index({ companyId: 1, paymentStatus: 1 });

// Pre-save
manualRecordSchema.pre("save", function () {
  if (!this.referenceId) {
    this.referenceId = `MAN-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  }
  this.totalAmount = (this.amount || 0) + (this.deliveryFee || 0);
  this.balance = Math.max(0, this.totalAmount - (this.amountPaid || 0));
  if (this.balance === 0 && this.totalAmount > 0) this.paymentStatus = "PAID";
  else if (this.amountPaid > 0 && this.balance > 0) this.paymentStatus = "PARTIAL";
  else if (this.amountPaid === 0) this.paymentStatus = "UNPAID";
});

const ManualRecord = mongoose.model("ManualRecord", manualRecordSchema);
export default ManualRecord;
