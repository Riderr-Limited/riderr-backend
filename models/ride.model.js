import mongoose from 'mongoose';

const RideSchema = new mongoose.Schema(
  {
    // Reference ID for tracking
    referenceId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },

    // Customer Information
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID is required'],
      index: true
    },

    customerName: {
      type: String,
      required: [true, 'Customer name is required']
    },

    customerPhone: {
      type: String,
      required: [true, 'Customer phone is required']
    },

    // Driver Information
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
      index: true
    },

    // Company Information
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true
    },

    // Pickup Location
    pickup: {
      address: {
        type: String,
        required: [true, 'Pickup address is required']
      },
      location: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point'
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
          required: [true, 'Pickup coordinates are required']
        }
      },
      landmark: String,
      instructions: String
    },

    // Dropoff Location
    dropoff: {
      address: {
        type: String,
        required: [true, 'Dropoff address is required']
      },
      location: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point'
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
          required: [true, 'Dropoff coordinates are required']
        }
      },
      landmark: String,
      instructions: String
    },

    // Ride Details
    vehicleType: {
      type: String,
      enum: ['bike', 'car', 'van', 'truck'],
      required: [true, 'Vehicle type is required'],
      index: true
    },

    // Distance & Duration
    estimatedDistance: {
      type: Number, // in meters
      required: true
    },

    actualDistance: {
      type: Number, // in meters
      default: null
    },

    estimatedDuration: {
      type: Number, // in seconds
      required: true
    },

    actualDuration: {
      type: Number, // in seconds
      default: null
    },

    // Pricing
    estimatedFare: {
      type: Number,
      required: [true, 'Estimated fare is required'],
      min: 0
    },

    actualFare: {
      type: Number,
      default: null,
      min: 0
    },

    baseFare: {
      type: Number,
      default: 0
    },

    distanceFare: {
      type: Number,
      default: 0
    },

    timeFare: {
      type: Number,
      default: 0
    },

    surgePricing: {
      applied: {
        type: Boolean,
        default: false
      },
      multiplier: {
        type: Number,
        default: 1.0,
        min: 1.0
      },
      reason: String
    },

    discount: {
      applied: {
        type: Boolean,
        default: false
      },
      amount: {
        type: Number,
        default: 0
      },
      code: String,
      reason: String
    },

    // Status
    status: {
      type: String,
      enum: [
        'pending',       // Customer created ride
        'searching',     // Looking for driver
        'assigned',      // Driver assigned
        'accepted',      // Driver accepted
        'arrived',       // Driver at pickup
        'picked_up',     // Customer in vehicle
        'ongoing',       // En route to destination
        'completed',     // Successfully completed
        'cancelled'      // Cancelled by customer/driver/system
      ],
      default: 'pending',
      index: true
    },

    // Payment
    payment: {
      method: {
        type: String,
        enum: ['cash', 'card', 'wallet', 'bank_transfer'],
        default: 'cash'
      },
      status: {
        type: String,
        enum: ['pending', 'processing', 'paid', 'failed', 'refunded'],
        default: 'pending'
      },
      transactionId: String,
      paidAt: Date,
      refundedAt: Date,
      refundReason: String
    },

    // Timestamps
    requestedAt: {
      type: Date,
      default: Date.now
    },

    assignedAt: Date,
    acceptedAt: Date,
    arrivedAt: Date,
    pickedUpAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,

    // Cancellation
    cancellation: {
      cancelledBy: {
        type: String,
        enum: ['customer', 'driver', 'admin', 'system']
      },
      reason: String,
      cancellationFee: {
        type: Number,
        default: 0
      }
    },

    // Rating & Feedback
    rating: {
      byCustomer: {
        score: {
          type: Number,
          min: 1,
          max: 5
        },
        feedback: String,
        ratedAt: Date
      },
      byDriver: {
        score: {
          type: Number,
          min: 1,
          max: 5
        },
        feedback: String,
        ratedAt: Date
      }
    },

    // Additional Details
    notes: String,
    
    specialRequests: [String],

    // Route tracking
    route: {
      polyline: String, // Encoded polyline for route
      waypoints: [
        {
          location: {
            type: {
              type: String,
              enum: ['Point']
            },
            coordinates: [Number]
          },
          timestamp: Date
        }
      ]
    },

    // Issues/Incidents
    incidents: [
      {
        type: {
          type: String,
          enum: ['accident', 'breakdown', 'delay', 'other']
        },
        description: String,
        reportedBy: {
          type: String,
          enum: ['customer', 'driver']
        },
        reportedAt: {
          type: Date,
          default: Date.now
        },
        resolved: {
          type: Boolean,
          default: false
        }
      }
    ],

    // Metadata
    metadata: {
      appVersion: String,
      platform: {
        type: String,
        enum: ['ios', 'android', 'web']
      },
      ipAddress: String,
      userAgent: String
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ========== INDEXES ==========
RideSchema.index({ 'pickup.location': '2dsphere' });
RideSchema.index({ 'dropoff.location': '2dsphere' });
RideSchema.index({ customerId: 1, status: 1 });
RideSchema.index({ driverId: 1, status: 1 });
RideSchema.index({ companyId: 1, status: 1 });
RideSchema.index({ referenceId: 1 }, { unique: true });
RideSchema.index({ status: 1, requestedAt: -1 });
RideSchema.index({ createdAt: -1 });

// ========== VIRTUAL FIELDS ==========
RideSchema.virtual('duration').get(function() {
  if (this.completedAt && this.pickedUpAt) {
    return Math.floor((this.completedAt - this.pickedUpAt) / 1000); // in seconds
  }
  return null;
});

RideSchema.virtual('totalWaitTime').get(function() {
  if (this.pickedUpAt && this.arrivedAt) {
    return Math.floor((this.pickedUpAt - this.arrivedAt) / 1000); // in seconds
  }
  return null;
});

RideSchema.virtual('isActive').get(function() {
  return ['assigned', 'accepted', 'arrived', 'picked_up', 'ongoing'].includes(this.status);
});

RideSchema.virtual('canBeCancelled').get(function() {
  return ['pending', 'searching', 'assigned', 'accepted', 'arrived'].includes(this.status);
});

RideSchema.virtual('finalFare').get(function() {
  if (this.actualFare !== null) {
    return this.actualFare;
  }
  
  let fare = this.estimatedFare;
  
  // Apply surge pricing
  if (this.surgePricing.applied) {
    fare = fare * this.surgePricing.multiplier;
  }
  
  // Apply discount
  if (this.discount.applied) {
    fare = fare - this.discount.amount;
  }
  
  return Math.max(fare, 0);
});

// ========== PRE-SAVE MIDDLEWARE ==========
RideSchema.pre('save', function(next) {
  // Generate reference ID if not exists
  if (this.isNew && !this.referenceId) {
    this.referenceId = `RIDE-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  // Calculate actual duration when completed
  if (this.status === 'completed' && this.pickedUpAt && this.completedAt) {
    this.actualDuration = Math.floor((this.completedAt - this.pickedUpAt) / 1000);
  }

  // Set payment status to paid when completed with cash
  if (this.status === 'completed' && this.payment.method === 'cash' && this.payment.status === 'pending') {
    this.payment.status = 'paid';
    this.payment.paidAt = new Date();
  }

  next();
});

// ========== INSTANCE METHODS ==========

// Assign driver to ride
RideSchema.methods.assignDriver = async function(driverId, companyId = null) {
  if (this.status !== 'pending' && this.status !== 'searching') {
    throw new Error('Ride cannot be assigned in current status');
  }

  this.driverId = driverId;
  this.companyId = companyId;
  this.status = 'assigned';
  this.assignedAt = new Date();
  
  await this.save();
  return this;
};

// Driver accepts ride
RideSchema.methods.acceptRide = async function() {
  if (this.status !== 'assigned') {
    throw new Error('Ride must be assigned before acceptance');
  }

  this.status = 'accepted';
  this.acceptedAt = new Date();
  
  await this.save();
  return this;
};

// Driver arrives at pickup
RideSchema.methods.arriveAtPickup = async function() {
  if (this.status !== 'accepted') {
    throw new Error('Ride must be accepted before arrival');
  }

  this.status = 'arrived';
  this.arrivedAt = new Date();
  
  await this.save();
  return this;
};

// Start ride (customer picked up)
RideSchema.methods.startRide = async function() {
  if (this.status !== 'arrived') {
    throw new Error('Driver must arrive before starting ride');
  }

  this.status = 'picked_up';
  this.pickedUpAt = new Date();
  
  // Transition to ongoing immediately
  this.status = 'ongoing';
  this.startedAt = new Date();
  
  await this.save();
  return this;
};

// Complete ride
RideSchema.methods.completeRide = async function(actualDistance = null, actualFare = null) {
  if (this.status !== 'ongoing') {
    throw new Error('Ride must be ongoing to complete');
  }

  this.status = 'completed';
  this.completedAt = new Date();
  
  if (actualDistance) {
    this.actualDistance = actualDistance;
  }
  
  if (actualFare) {
    this.actualFare = actualFare;
  } else {
    this.actualFare = this.finalFare;
  }
  
  await this.save();
  return this;
};

// Cancel ride
RideSchema.methods.cancelRide = async function(cancelledBy, reason = '', cancellationFee = 0) {
  if (!this.canBeCancelled) {
    throw new Error('Ride cannot be cancelled in current status');
  }

  this.status = 'cancelled';
  this.cancelledAt = new Date();
  this.cancellation = {
    cancelledBy,
    reason,
    cancellationFee
  };
  
  await this.save();
  return this;
};

// Add customer rating
RideSchema.methods.addCustomerRating = async function(score, feedback = '') {
  if (this.status !== 'completed') {
    throw new Error('Can only rate completed rides');
  }

  if (score < 1 || score > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  this.rating.byCustomer = {
    score,
    feedback,
    ratedAt: new Date()
  };
  
  await this.save();
  return this;
};

// Add driver rating
RideSchema.methods.addDriverRating = async function(score, feedback = '') {
  if (this.status !== 'completed') {
    throw new Error('Can only rate completed rides');
  }

  if (score < 1 || score > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  this.rating.byDriver = {
    score,
    feedback,
    ratedAt: new Date()
  };
  
  await this.save();
  return this;
};

// Get ride summary
RideSchema.methods.getSummary = function() {
  return {
    referenceId: this.referenceId,
    status: this.status,
    pickup: this.pickup.address,
    dropoff: this.dropoff.address,
    vehicleType: this.vehicleType,
    estimatedFare: this.estimatedFare,
    actualFare: this.actualFare,
    finalFare: this.finalFare,
    distance: this.actualDistance || this.estimatedDistance,
    duration: this.actualDuration || this.estimatedDuration,
    requestedAt: this.requestedAt,
    completedAt: this.completedAt
  };
};

// ========== STATIC METHODS ==========

// Find active rides for customer
RideSchema.statics.findActiveByCustomer = function(customerId) {
  return this.find({
    customerId,
    status: { $in: ['pending', 'searching', 'assigned', 'accepted', 'arrived', 'picked_up', 'ongoing'] }
  }).sort({ requestedAt: -1 });
};

// Find active rides for driver
RideSchema.statics.findActiveByDriver = function(driverId) {
  return this.find({
    driverId,
    status: { $in: ['assigned', 'accepted', 'arrived', 'picked_up', 'ongoing'] }
  }).sort({ assignedAt: -1 });
};

// Find pending rides (searching for drivers)
RideSchema.statics.findPending = function(filters = {}) {
  const query = {
    status: { $in: ['pending', 'searching'] },
    ...filters
  };
  
  return this.find(query)
    .populate('customerId', 'name phone')
    .sort({ requestedAt: 1 });
};

// Find nearby rides (for driver matching)
RideSchema.statics.findNearby = function(longitude, latitude, maxDistance = 5000, vehicleType = null) {
  const query = {
    status: { $in: ['pending', 'searching'] },
    'pickup.location': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    }
  };

  if (vehicleType) {
    query.vehicleType = vehicleType;
  }

  return this.find(query)
    .populate('customerId', 'name phone')
    .limit(10);
};

// Get ride statistics
RideSchema.statics.getStatistics = async function(filters = {}) {
  const stats = await this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        totalRides: { $sum: 1 },
        completedRides: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        cancelledRides: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
        totalRevenue: {
          $sum: { $ifNull: ['$actualFare', 0] }
        },
        averageFare: {
          $avg: { $ifNull: ['$actualFare', '$estimatedFare'] }
        },
        averageDistance: {
          $avg: { $ifNull: ['$actualDistance', '$estimatedDistance'] }
        },
        averageDuration: {
          $avg: { $ifNull: ['$actualDuration', '$estimatedDuration'] }
        }
      }
    }
  ]);

  return stats[0] || {
    totalRides: 0,
    completedRides: 0,
    cancelledRides: 0,
    totalRevenue: 0,
    averageFare: 0,
    averageDistance: 0,
    averageDuration: 0
  };
};

const Ride = mongoose.model('Ride', RideSchema);
export default Ride;