import mongoose from "mongoose";

const deliverySchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      index: true
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true
    },

    // Customer Information
    customerName: {
      type: String,
      required: true,
      trim: true
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true
    },

    // Recipient Information
    recipientName: {
      type: String,
      required: true,
      trim: true
    },
    recipientPhone: {
      type: String,
      required: true,
      trim: true
    },

    // Pickup Location with Name
    pickup: {
      address: {
        type: String,
        required: true
      },
      name: {
        type: String, // Display name like "Home", "Office", "Starbucks", etc.
        trim: true
      },
      lat: {
        type: Number,
        required: true
      },
      lng: {
        type: Number,
        required: true
      },
      landmark: {
        type: String,
        trim: true
      },
      instructions: {
        type: String,
        trim: true
      }
    },

    // Dropoff Location with Name
    dropoff: {
      address: {
        type: String,
        required: true
      },
      name: {
        type: String, // Display name like "Home", "Office", "Client Location", etc.
        trim: true
      },
      lat: {
        type: Number,
        required: true
      },
      lng: {
        type: Number,
        required: true
      },
      landmark: {
        type: String,
        trim: true
      },
      instructions: {
        type: String,
        trim: true
      }
    },

    // Item Information
    itemType: {
      type: String,
      required: true,
      enum: ['document', 'package', 'food', 'electronics', 'clothing', 'other']
    },
    itemDescription: {
      type: String,
      trim: true
    },
    itemWeight: {
      type: Number, // in kg
      default: 1
    },
    itemValue: {
      type: Number, // in naira
      default: 0
    },

    // Delivery Details
    estimatedDistanceMeters: {
      type: Number,
      default: 0
    },
    estimatedDurationSec: {
      type: Number,
      default: 0
    },
    actualDistanceMeters: {
      type: Number
    },
    actualDurationSec: {
      type: Number
    },

    // Status and Timestamps
    status: {
      type: String,
      enum: [
        'created',      // Initial state
        'assigned',     // Rider assigned
        'picked_up',    // Package picked up
        'in_transit',   // En route to destination
        'delivered',    // Successfully delivered
        'returned',     // Returned to sender
        'failed',       // Delivery failed
        'cancelled'     // Cancelled
      ],
      default: 'created',
      index: true
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    assignedAt: Date,
    pickedUpAt: Date,
    inTransitAt: Date,
    deliveredAt: Date,
    returnedAt: Date,
    failedAt: Date,
    cancelledAt: Date,

    // Payment
    deliveryFee: {
      type: Number,
      default: 0
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded'],
      default: 'pending'
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'wallet', 'transfer'],
      default: 'cash'
    },

    // Instructions and Notes
    deliveryInstructions: {
      type: String,
      trim: true
    },
    riderNotes: {
      type: String,
      trim: true
    },
    cancellationReason: {
      type: String,
      trim: true
    },
    failureReason: {
      type: String,
      trim: true
    },

    // Proof of Delivery
    proofOfDelivery: {
      signature: String,
      photo: String,
      recipientName: String,
      deliveredAt: Date
    },

    // Rating
    rating: {
      score: {
        type: Number,
        min: 1,
        max: 5
      },
      feedback: String,
      ratedAt: Date
    },

    // Metadata
    meta: {
      platform: String,
      ipAddress: String,
      trackingLocation: {
        lat: Number,
        lng: Number,
        timestamp: Date
      },
      trackingHistory: [{
        lat: Number,
        lng: Number,
        timestamp: Date
      }]
    }
  },
  {
    timestamps: true
  }
);

// Indexes for better query performance
deliverySchema.index({ customerId: 1, createdAt: -1 });
deliverySchema.index({ riderId: 1, status: 1 });
deliverySchema.index({ companyId: 1, status: 1 });
deliverySchema.index({ status: 1, createdAt: -1 });
deliverySchema.index({ 'pickup.lat': 1, 'pickup.lng': 1 });

// Virtual for display summary
deliverySchema.virtual('summary').get(function() {
  return {
    from: this.pickup.name || this.pickup.address.split(',')[0],
    to: this.dropoff.name || this.dropoff.address.split(',')[0],
    status: this.status,
    itemType: this.itemType
  };
});

// Ensure virtuals are included in JSON
deliverySchema.set('toJSON', { virtuals: true });
deliverySchema.set('toObject', { virtuals: true });

const Delivery = mongoose.model("Delivery", deliverySchema);

export default Delivery;