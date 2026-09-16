import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";

/**
 * Partner = an external platform (ecommerce store, marketplace, etc.)
 * that consumes Riderr's delivery service through the Partner API
 * instead of through the normal customer app/website.
 */
const PartnerSchema = new mongoose.Schema(
  {
    businessName: {
      type: String,
      required: [true, "Business name is required"],
      trim: true,
    },

    contactName: {
      type: String,
      required: [true, "Contact name is required"],
      trim: true,
    },

    contactEmail: {
      type: String,
      required: [true, "Contact email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    contactPhone: {
      type: String,
      required: [true, "Contact phone is required"],
      trim: true,
    },

    // Public identifier sent as the X-API-Key header
    apiKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Only the bcrypt hash of the secret is stored; the plaintext secret
    // is shown once at creation time, like Stripe/Paystack secret keys.
    apiSecretHash: {
      type: String,
      required: true,
      select: false,
    },

    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },

    // If set, orders from this partner must use one of these delivery
    // companies. Empty array = any active company is allowed.
    allowedCompanyIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
      },
    ],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },

    requestCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

PartnerSchema.methods.canOperate = function () {
  return this.status === "active";
};

PartnerSchema.methods.verifySecret = function (plainSecret) {
  return bcrypt.compare(plainSecret, this.apiSecretHash);
};

PartnerSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    businessName: this.businessName,
    contactName: this.contactName,
    contactEmail: this.contactEmail,
    contactPhone: this.contactPhone,
    apiKey: this.apiKey,
    status: this.status,
    allowedCompanyIds: this.allowedCompanyIds,
    lastUsedAt: this.lastUsedAt,
    requestCount: this.requestCount,
    createdAt: this.createdAt,
  };
};

// Generates a fresh apiKey/apiSecret pair. The secret is returned in
// plaintext ONLY from this call so it can be shown to the admin once.
PartnerSchema.statics.generateCredentials = async function () {
  const apiKey = `pk_${crypto.randomBytes(16).toString("hex")}`;
  const apiSecret = `sk_${crypto.randomBytes(32).toString("hex")}`;
  const apiSecretHash = await bcrypt.hash(apiSecret, 10);
  return { apiKey, apiSecret, apiSecretHash };
};

const Partner = mongoose.model("Partner", PartnerSchema);
export default Partner;
