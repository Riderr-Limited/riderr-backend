import mongoose from 'mongoose';

const DriverSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      unique: true,
      index: true
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company ID is required"],
      index: true
    },

    

    
    // Vehicle Information - SIMPLIFIED
    vehicleType: {
      type: String,
      enum: ["bike", "car", "van", "truck"],
      required: [true, "Vehicle type is required"],
      index: true
    },

    vehicleMake: {
      type: String,
      trim: true,
      default: null // Optional - can be updated later
    },

    vehicleModel: {
      type: String,
      trim: true,
      default: null // Optional - can be updated later
    },

    vehicleYear: {
      type: Number,
      min: 1990,
      max: new Date().getFullYear() + 1,
      default: null // Optional - can be updated later
    },

    vehicleColor: {
      type: String,
      required: [true, "Vehicle color is required"],
      trim: true
    },

    plateNumber: {
      type: String,
      required: [true, "Plate number is required"],
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },

    // Availability & Status
    isAvailable: {
      type: Boolean,
      default: false,
      index: true
    },

    isOnline: {
      type: Boolean,
      default: false,
      index: true
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true
    },

    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },

    currentStatus: {
      type: String,
      enum: ["offline", "online", "busy", "on_trip"],
      default: "offline",
      index: true
    },

    // Location with GeoJSON
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
        index: '2dsphere'
      },
      address: String,
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    },

    // Deprecated location fields (for backward compatibility)
    lat: Number,
    lng: Number,

    // Ratings & Performance
    rating: {
      average: { 
        type: Number, 
        default: 5.0,
        min: 0,
        max: 5
      },
      totalRatings: { 
        type: Number, 
        default: 0 
      },
      breakdown: {
        5: { type: Number, default: 0 },
        4: { type: Number, default: 0 },
        3: { type: Number, default: 0 },
        2: { type: Number, default: 0 },
        1: { type: Number, default: 0 }
      }
    },

    // Statistics
    stats: {
      totalTrips: {
        type: Number,
        default: 0
      },
      completedTrips: {
        type: Number,
        default: 0
      },
      cancelledTrips: {
        type: Number,
        default: 0
      },
      totalEarnings: {
        type: Number,
        default: 0
      },
      todayEarnings: {
        type: Number,
        default: 0
      },
      weekEarnings: {
        type: Number,
        default: 0
      },
      monthEarnings: {
        type: Number,
        default: 0
      },
      acceptanceRate: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
      },
      averageResponseTime: {
        type: Number, // in seconds
        default: 0
      }
    },

    // Documents - All optional, can be uploaded later
    documents: [
      {
        type: {
          type: String,
          enum: [
            "driver_license",
            "vehicle_registration",
            "insurance",
            "road_worthiness",
            "profile_photo",
            "vehicle_photo",
            "background_check"
          ],
          required: true
        },
        url: {
          type: String,
          required: true
        },
        uploadedAt: {
          type: Date,
          default: Date.now
        },
        verified: {
          type: Boolean,
          default: false
        },
        verifiedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User"
        },
        verifiedAt: Date,
        expiryDate: Date,
        rejectionReason: String
      }
    ],

    // Banking Information - Optional
    bankDetails: {
      accountName: String,
      accountNumber: String,
      bankName: String,
      bankCode: String,
      verified: {
        type: Boolean,
        default: false
      }
    },

    // Emergency Contact - Optional
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String
    },

    // Operational Details - Optional
    workingHours: {
      start: String, // "08:00"
      end: String    // "20:00"
    },

    preferredAreas: [{
      type: String
    }],

    languages: [{
      type: String,
      enum: ['english', 'yoruba', 'igbo', 'hausa', 'pidgin']
    }],

    // Current Trip Reference
    currentTripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      default: null
    },

    // Session Management
    lastOnlineAt: {
      type: Date,
      default: Date.now
    },

    lastLocationUpdate: {
      type: Date,
      default: Date.now
    },

    // Approval & Verification
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    approvedAt: Date,

    rejectionReason: String,

    // Flags
    isSuspended: {
      type: Boolean,
      default: false
    },

    suspensionReason: String,

    suspendedAt: Date,

    suspendedUntil: Date
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ========== INDEXES ==========
DriverSchema.index({ location: '2dsphere' });
DriverSchema.index({ companyId: 1, isActive: 1, isOnline: 1 });
DriverSchema.index({ companyId: 1, approvalStatus: 1 });
DriverSchema.index({ userId: 1 }, { unique: true });
DriverSchema.index({ plateNumber: 1 }, { unique: true });
DriverSchema.index({ isOnline: 1, isAvailable: 1, vehicleType: 1 });
DriverSchema.index({ currentStatus: 1, location: '2dsphere' });

// ========== VIRTUAL FIELDS ==========
DriverSchema.virtual('isDocumentsComplete').get(function() {
  const requiredDocs = [
    'driver_license', 
    'vehicle_registration', 
    'insurance', 
    'profile_photo',
    'vehicle_photo'
  ];
  
  const uploadedDocs = this.documents.map(d => d.type);
  return requiredDocs.every(doc => uploadedDocs.includes(doc));
});

DriverSchema.virtual('isDocumentsVerified').get(function() {
  if (this.documents.length === 0) return false;
  return this.documents.every(d => d.verified === true);
});

DriverSchema.virtual('canAcceptRides').get(function() {
  return (
    this.isActive &&
    this.isOnline &&
    this.isAvailable &&
    this.isVerified &&
    this.approvalStatus === 'approved' &&
    !this.isSuspended &&
    this.currentStatus !== 'on_trip'
  );
});

DriverSchema.virtual('completionRate').get(function() {
  if (this.stats.totalTrips === 0) return 0;
  return ((this.stats.completedTrips / this.stats.totalTrips) * 100).toFixed(2);
});

// ========== PRE-SAVE MIDDLEWARE ==========
DriverSchema.pre('save', function(next) {
  // Update location from lat/lng if provided
  if (this.isModified('lat') || this.isModified('lng')) {
    if (this.lng && this.lat) {
      this.location.coordinates = [this.lng, this.lat];
      this.location.lastUpdated = new Date();
    }
  }

  // Update last location update time
  if (this.isModified('location.coordinates')) {
    this.lastLocationUpdate = new Date();
  }

  // Set status based on availability
  if (this.isModified('isOnline') || this.isModified('isAvailable')) {
    if (!this.isOnline) {
      this.currentStatus = 'offline';
      this.isAvailable = false;
    } else if (this.isOnline && !this.currentTripId) {
      this.currentStatus = 'online';
    }
  }

  // Update last online timestamp
  if (this.isModified('isOnline') && this.isOnline) {
    this.lastOnlineAt = new Date();
  }

  // Normalize strings
  if (this.licenseNumber) {
    this.licenseNumber = this.licenseNumber.toUpperCase().trim();
  }
  if (this.plateNumber) {
    this.plateNumber = this.plateNumber.toUpperCase().trim();
  }

 });

// ========== INSTANCE METHODS ==========

// Update driver location
DriverSchema.methods.updateLocation = async function(latitude, longitude, address) {
  this.location.coordinates = [longitude, latitude];
  this.location.lastUpdated = new Date();
  this.lastLocationUpdate = new Date();
  
  if (address) {
    this.location.address = address;
  }
  
  // Also update deprecated fields for backward compatibility
  this.lat = latitude;
  this.lng = longitude;
  
  await this.save();
  return this.location;
};

// Toggle online status
DriverSchema.methods.goOnline = async function() {
  if (!this.canAcceptRides) {
    throw new Error('Driver cannot go online. Check verification and approval status.');
  }
  
  this.isOnline = true;
  this.isAvailable = true;
  this.currentStatus = 'online';
  this.lastOnlineAt = new Date();
  await this.save();
};

DriverSchema.methods.goOffline = async function() {
  if (this.currentTripId) {
    throw new Error('Cannot go offline while on a trip');
  }
  
  this.isOnline = false;
  this.isAvailable = false;
  this.currentStatus = 'offline';
  await this.save();
};

// Update rating
DriverSchema.methods.addRating = async function(ratingValue) {
  if (ratingValue < 1 || ratingValue > 5) {
    throw new Error('Rating must be between 1 and 5');
  }
  
  // Update breakdown
  this.rating.breakdown[ratingValue] += 1;
  
  // Update total ratings
  this.rating.totalRatings += 1;
  
  // Calculate new average
  const totalPoints = 
    (this.rating.breakdown[5] * 5) +
    (this.rating.breakdown[4] * 4) +
    (this.rating.breakdown[3] * 3) +
    (this.rating.breakdown[2] * 2) +
    (this.rating.breakdown[1] * 1);
  
  this.rating.average = (totalPoints / this.rating.totalRatings).toFixed(2);
  
  await this.save();
  return this.rating;
};

// Update earnings
DriverSchema.methods.addEarnings = async function(amount) {
  this.stats.totalEarnings += amount;
  this.stats.todayEarnings += amount;
  this.stats.weekEarnings += amount;
  this.stats.monthEarnings += amount;
  await this.save();
};

// Reset daily earnings (call this daily via cron job)
DriverSchema.methods.resetDailyEarnings = async function() {
  this.stats.todayEarnings = 0;
  await this.save();
};

// Assign trip
DriverSchema.methods.assignTrip = async function(tripId) {
  this.currentTripId = tripId;
  this.currentStatus = 'busy';
  this.isAvailable = false;
  await this.save();
};

// Complete trip
DriverSchema.methods.completeTrip = async function() {
  this.currentTripId = null;
  this.currentStatus = 'online';
  this.isAvailable = true;
  this.stats.completedTrips += 1;
  this.stats.totalTrips += 1;
  await this.save();
};

// Cancel trip
DriverSchema.methods.cancelTrip = async function() {
  this.currentTripId = null;
  this.currentStatus = 'online';
  this.isAvailable = true;
  this.stats.cancelledTrips += 1;
  this.stats.totalTrips += 1;
  await this.save();
};

// Get safe driver info for customers
DriverSchema.methods.toPublicJSON = function() {
  return {
    id: this._id,
    name: this.userId?.name,
    phone: this.userId?.phone,
    vehicleType: this.vehicleType,
    vehicleMake: this.vehicleMake,
    vehicleModel: this.vehicleModel,
    vehicleColor: this.vehicleColor,
    plateNumber: this.plateNumber,
    rating: {
      average: this.rating.average,
      total: this.rating.totalRatings
    },
    profilePhoto: this.documents.find(d => d.type === 'profile_photo')?.url,
    vehiclePhoto: this.documents.find(d => d.type === 'vehicle_photo')?.url
  };
};

// ========== STATIC METHODS ==========

// Find available drivers near location
DriverSchema.statics.findNearby = function(longitude, latitude, maxDistance = 5000, vehicleType = null) {
  const query = {
    isOnline: true,
    isAvailable: true,
    isActive: true,
    isVerified: true,
    approvalStatus: 'approved',
    isSuspended: false,
    currentStatus: { $in: ['online', 'busy'] },
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance // in meters
      }
    }
  };

  if (vehicleType) {
    query.vehicleType = vehicleType;
  }

  return this.find(query)
    .populate('userId', 'name phone')
    .limit(20);
};

// Find drivers by company
DriverSchema.statics.findByCompany = function(companyId, filters = {}) {
  return this.find({ companyId, ...filters })
    .populate('userId', 'name email phone')
    .sort({ createdAt: -1 });
};

// Find pending approval drivers
DriverSchema.statics.findPendingApproval = function(companyId = null) {
  const query = { approvalStatus: 'pending' };
  if (companyId) query.companyId = companyId;
  
  return this.find(query)
    .populate('userId', 'name email phone')
    .populate('companyId', 'name')
    .sort({ createdAt: 1 });
};

// Get online drivers count
DriverSchema.statics.getOnlineCount = async function(companyId = null) {
  const query = { isOnline: true, isActive: true };
  if (companyId) query.companyId = companyId;
  
  return this.countDocuments(query);
};

const Driver = mongoose.model("Driver", DriverSchema);
export default Driver;