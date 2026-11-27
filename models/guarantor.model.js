// models/guarantor.model.js
// A person who vouches for an individual rider. Each individual rider needs
// KYC_REQUIRED_GUARANTORS (default 2) confirmed guarantors before admin review.
import mongoose from "mongoose";

const GuarantorSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
      index: true
    },

    // Details entered by the rider
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    relationship: {
      type: String,
      enum: ["family", "employer", "religious_leader", "community_leader", "friend", "colleague", "other"],
      required: true
    },
    address: { type: String, trim: true },
    occupation: { type: String, trim: true },

    // invited -> phone_verified -> confirmed | declined | failed | revoked
    status: {
      type: String,
      enum: ["invited", "phone_verified", "confirmed", "declined", "failed", "revoked"],
      default: "invited",
      index: true
    },

    // Only the SHA-256 of the link token is stored; the raw token is in the link.
    tokenHash: { type: String, required: true, unique: true, select: false },
    tokenExpiresAt: { type: Date, required: true },

    phoneVerifiedAt: Date,
    otpAttempts: { type: Number, default: 0 },

    // Guarantor's own NIN check
    nin: {
      encrypted: { type: String, select: false },
      hash: { type: String, select: false, index: true },
      last4: String,
      nameMatchScore: Number,
      providerRef: String
    },
    ninAttempts: { type: Number, default: 0 },

    consentAt: Date,
    consentIp: String,
    confirmedAt: Date,
    declinedAt: Date,
    failureReason: String
  },
  { timestamps: true }
);

GuarantorSchema.index({ driverId: 1, phone: 1 });

const Guarantor = mongoose.model("Guarantor", GuarantorSchema);
export default Guarantor;
