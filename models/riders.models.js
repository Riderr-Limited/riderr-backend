const mongoose = require("mongoose");

const RiderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    vehicleType: {
      type: String,
      enum: ["bike", "car", "van", "truck"],
      default: "bike",
    },

    plateNumber: String,

    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },

    currentStatus: {
      type: String,
      enum: ["offline", "idle", "assigned", "on_trip"],
      default: "idle",
    },

    location: {
      lat: Number,
      lng: Number,
    },

    rating: {
      avg: { type: Number, default: 5 },
      totalRatings: { type: Number, default: 0 },
    },

    documents: [
      {
        type: { type: String },
        url: String,
        verified: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

RiderSchema.index({ "location": "2dsphere" });

const Rider = mongoose.model("Rider", RiderSchema);
export default Rider;
