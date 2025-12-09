const mongoose = require("mongoose");

const DeliverySchema = new mongoose.Schema(
  {
    referenceId: {
      type: String,
      unique: true,
      index: true,
    },

    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },

    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      default: null,
      index: true,
    },

    pickup: {
      address: String,
      city: String,
      lga: String,
      lat: Number,
      lng: Number,
      contactName: String,
      contactPhone: String,
      notes: String,
    },

    dropoff: {
      address: String,
      city: String,
      lga: String,
      lat: Number,
      lng: Number,
      contactName: String,
      contactPhone: String,
      notes: String,
    },

    type: {
      type: String,
      enum: ["small", "food", "document", "heavy"],
      required: true,
    },

    weightKg: Number,

    price: Number,

    estimatedDistanceMeters: Number,
    estimatedDurationSec: Number,

    status: {
      type: String,
      enum: [
        "created",
        "matched",
        "assigned",
        "accepted",
        "picked",
        "in_transit",
        "delivered",
        "cancelled",
      ],
      default: "created",
      index: true,
    },

    payment: {
      method: { type: String, enum: ["cod", "card", "wallet"], default: "cod" },
      status: {
        type: String,
        enum: ["pending", "paid", "failed", "refunded"],
        default: "pending",
      },
      gatewayRef: String,
    },

    proof: {
      photoUrl: String,
      deliveredAt: Date,
      confirmationCode: String,
    },

    rating: {
      riderRating: Number,
      companyRating: Number,
    },

    meta: Object,
  },
  { timestamps: true }
);

DeliverySchema.index({ "pickup.lat": 1, "pickup.lng": 1 });
DeliverySchema.index({ "dropoff.lat": 1, "dropoff.lng": 1 });

module.exports = mongoose.model("Delivery", DeliverySchema);
