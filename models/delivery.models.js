import mongoose from "mongoose";
import crypto from "crypto";

const deliverySchema = new mongoose.Schema({
  // Reference ID
  referenceId: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },

  // ✅ driver 
  driverDetails: {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: String,
    phone: String,
    avatarUrl: String,
    rating: { type: Number, default: 0 },
    vehicle: {
      type: { type: String },  
      make: String,
      model: String,
      plateNumber: String,
    },
    currentLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date
    }
  },
  companyDetails: {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    name: String,
    logo: String,
    contactPhone: String,
    address: String,
    email: String,
    rating: { type: Number, default: 0 }
  },  

  // Main relationships
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Driver",
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
  },

  // Customer details
  customerName: {
    type: String,
    required: true,
  },
  customerPhone: {
    type: String,
    required: true,
  },

  // Recipient details
  recipientName: {
    type: String,
    required: true,
  },
  recipientPhone: {
    type: String,
    required: true,
  },
  waitingForPayment: {
    type: Boolean,
    default: false,
  },
  // Pickup location
  pickup: {
    address: String,
    lat: Number,
    lng: Number,
    name: String,
    phone: String,
    instructions: String,
  },

  // Dropoff location
  dropoff: {
    address: String,
    lat: Number,
    lng: Number,
    name: String,
    phone: String,
    instructions: String,
  },

  // Item details
  itemDetails: {
    type: {
      type: String,
      default: "parcel",
    },
    description: String,
    weight: {
      type: Number,
      default: 1,
    },
    value: {
      type: Number,
      default: 0,
    },
  },

  // Fare details
  fare: {
    baseFare: Number,
    distanceFare: Number,
    totalFare: Number,
    currency: {
      type: String,
      default: "NGN",
    },
  },

  // Delivery estimates
  estimatedDistanceKm: Number,
  estimatedDurationMin: Number,

  // Payment information
  payment: {
    method: String,
    status: {
      type: String,
      default: "pending",
    },
  },

  // Status
  status: {
    type: String,
    enum: [
      "created",
      "assigned",
      "picked_up",
      "delivered",
      "cancelled",
      'completed',
      "failed",
    ],
    default: "created",
  },

  // ✅ NEW: Track driver rejections
  rejectedByDrivers: [
    {
      driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
        required: true
      },
      rejectedAt: {
        type: Date,
        default: Date.now
      },
      reason: {
        type: String,
        default: "No reason provided"
      }
    }
  ],

  // Timestamps
  assignedAt: Date,
  pickedUpAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,

  // Rating
  rating: {
    type: Number,
    min: 1,
    max: 5,
  },
  review: String,
  ratedAt: Date,

  // Tip
  tip: {
    amount: Number,
    addedAt: Date,
  },

  // Created and updated timestamps
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes for better query performance
deliverySchema.index({ customerId: 1, status: 1 });
deliverySchema.index({ driverId: 1, status: 1 });
deliverySchema.index({ companyId: 1, status: 1 });
deliverySchema.index({ status: 1 });
deliverySchema.index({ createdAt: -1 });
// ✅ NEW: Index for rejection filtering
deliverySchema.index({ 'rejectedByDrivers.driverId': 1 });

// Generate reference ID before saving
deliverySchema.pre("save", function (next) {
  if (!this.referenceId) {
    this.referenceId = `RID-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;
  }
  this.updatedAt = new Date();
 });

const Delivery = mongoose.model("Delivery", deliverySchema);

export default Delivery;