import mongoose from "mongoose";

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
      ref: "Rider", // Changed from "Rider" to match our new model
      default: null,
      index: true,
    },

    // Customer and Recipient Info (Add these fields)
    customerName: {
      type: String,
      required: true
    },
    customerPhone: {
      type: String,
      required: true
    },
    recipientName: {
      type: String,
      required: true
    },
    recipientPhone: {
      type: String,
      required: true
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

    // Item Details (Update field name from 'type' to 'itemType')
    itemType: {
      type: String,
      enum: ["package", "document", "food", "electronics", "other"], // Updated enum values
      required: true,
    },
    itemDescription: String,
    itemWeight: Number,
    itemValue: Number,

    estimatedDistanceMeters: Number,
    estimatedDurationSec: Number,
    deliveryInstructions: String,

    // Add timestamps
    assignedAt: Date,
    pickedUpAt: Date,
    inTransitAt: Date,
    deliveredAt: Date,
    failedAt: Date,
    cancelledAt: Date,
    returnedAt: Date,

    status: {
      type: String,
      enum: [
        "created", // Add 'created' to match your controller
        "matched",
        "assigned",
        "accepted",
        "picked_up", // Update to match controller
        "in_transit",
        "delivered",
        "cancelled",
        "failed", // Add missing statuses
        "returned"
      ],
      default: "created", // Updated default
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

// Pre-save middleware to generate reference ID
DeliverySchema.pre('save', function(next) {
  if (this.isNew && !this.referenceId) {
    this.referenceId = `DEL-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
  next();
});

const Delivery = mongoose.model("Delivery", DeliverySchema);
export default Delivery;