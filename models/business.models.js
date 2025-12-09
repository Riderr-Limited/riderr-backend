const mongoose = require("mongoose");

const CompanySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
    },

    address: String,
    city: { type: String, required: true },
    lga: String,

    lat: Number,
    lng: Number,

    logoUrl: String,

    contactPhone: String,
    contactEmail: String,

    status: {
      type: String,
      enum: ["pending", "active", "suspended"],
      default: "pending",
      index: true
    },

    settings: {
      autoAccept: { type: Boolean, default: false },
      notificationChannels: {
        type: [String],
        default: ["push"],
      },
    },

    onboardingDocs: [
      {
        name: String,
        url: String,
        verified: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

CompanySchema.index({ lat: 1, lng: 1 });

const Company = mongoose.model("Company", CompanySchema);
export default Company;
