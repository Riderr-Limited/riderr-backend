import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: [true, "Company name is required"],
      trim: true,
      minlength: [3, "Company name must be at least 3 characters"],
      maxlength: [100, "Company name cannot exceed 100 characters"]
    },
    
    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    
    // Business Details
    businessLicense: {
      type: String,
      required: [true, "Business license number is required"],
      unique: true
    },
    
    taxId: {
      type: String,
      required: [true, "Tax ID is required"]
    },
    
    address: {
      type: String,
      required: [true, "Address is required"]
    },
    
    city: { 
      type: String, 
      required: [true, "City is required"],
      index: true
    },
    
    state: {
      type: String,
      required: [true, "State is required"]
    },
    
    lga: {
      type: String,
      required: [true, "LGA is required"]
    },
    
    // Location coordinates for geospatial queries
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
      }
    },
    
    // Deprecated fields (keep for backward compatibility)
    lat: Number,
    lng: Number,
    
    logoUrl: String,
    
    // Contact Information
contactPhone: {
  type: String,
  required: [true, "Contact phone is required"],
  validate: {
    validator: function(v) {
      // Accept exactly: 08012345678 (11 digits) or +2348012345678 (14 digits)
      return /^(?:\+234\d{10}|0\d{10})$/.test(v);
    },
    message: "Please provide a valid Nigerian phone number (e.g., 08012345678 or +2348012345678)"
  }
},
    
    contactEmail: {
      type: String,
      required: [true, "Contact email is required"],
      lowercase: true,
      trim: true,
      unique: true,
      validate: {
        validator: function(v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Please provide a valid email"
      }
    },
    
    // Authentication - Company admin credentials
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false // Don't return password by default in queries
    },
    
    // Registration Details
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    registrationDate: {
      type: Date,
      default: Date.now
    },
    
    // Approval Status
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "rejected"],
      default: "pending",
      index: true
    },
    
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User" // Admin who approved
    },
    
    approvedAt: {
      type: Date
    },
    
    rejectionReason: {
      type: String,
      default: ""
    },
    
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    rejectedAt: {
      type: Date
    },
    
    // Settings
    settings: {
      autoAccept: { 
        type: Boolean, 
        default: false 
      },
      commissionRate: {
        type: Number,
        default: 15, // 15% commission
        min: 0,
        max: 100
      },
      notificationChannels: {
        type: [String],
        enum: ["push", "email", "sms"],
        default: ["push"]
      },
      operatingHours: {
        start: { type: String, default: "00:00" },
        end: { type: String, default: "23:59" }
      }
    },
    
    // Onboarding Documents
    onboardingDocs: [
      {
        name: {
          type: String,
          required: true,
          enum: [
            "business_license", 
            "tax_certificate", 
            "cac_document",
            "owner_id",
            "insurance_certificate"
          ]
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
        verifiedAt: {
          type: Date
        }
      }
    ],
    
    // Statistics
    stats: {
      totalDrivers: {
        type: Number,
        default: 0
      },
      activeDrivers: {
        type: Number,
        default: 0
      },
      totalRides: {
        type: Number,
        default: 0
      },
      completedRides: {
        type: Number,
        default: 0
      },
      totalEarnings: {
        type: Number,
        default: 0
      }
    },
    
    // Banking Information
    bankDetails: {
      accountName: String,
      accountNumber: String,
      bankName: String,
      verified: {
        type: Boolean,
        default: false
      }
    },
    
    // Account status
    isActive: {
      type: Boolean,
      default: true
    },
    
    isDeleted: {
      type: Boolean,
      default: false
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
CompanySchema.index({ location: '2dsphere' }); // For geospatial queries
CompanySchema.index({ status: 1, isActive: 1 });
CompanySchema.index({ city: 1, status: 1 });
CompanySchema.index({ contactEmail: 1 });
CompanySchema.index({ businessLicense: 1 });

// Virtual for driver count
CompanySchema.virtual('driverCount', {
  ref: 'Driver',
  localField: '_id',
  foreignField: 'companyId',
  count: true
});

// Pre-save middleware
CompanySchema.pre('save', async function() {
  // Auto-generate slug if not exists
  if (this.isModified('name') || !this.slug) {
    let baseSlug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    
    // Ensure unique slug
    let slug = baseSlug;
    let counter = 1;
    
    while (await mongoose.models.Company.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    this.slug = slug;
  }
  
  // Update location from lat/lng if provided
  if (this.isModified('lat') || this.isModified('lng')) {
    if (this.lng && this.lat) {
      this.location = {
        type: 'Point',
        coordinates: [this.lng, this.lat]
      };
    }
  }
  
  
  
});

// Instance methods

// Check if company is approved
CompanySchema.methods.isApproved = function() {
  return this.status === 'active';
};

// Check if company can operate
CompanySchema.methods.canOperate = function() {
  return this.status === 'active' && this.isActive && !this.isDeleted;
};

// Get company info without sensitive data
CompanySchema.methods.toPublicJSON = function() {
  return {
    id: this._id,
    name: this.name,
    slug: this.slug,
    city: this.city,
    state: this.state,
    lga: this.lga,
    logoUrl: this.logoUrl,
    contactPhone: this.contactPhone,
    contactEmail: this.contactEmail,
    status: this.status,
    stats: this.stats,
    createdAt: this.createdAt
  };
};

// Static methods

// Find active companies
CompanySchema.statics.findActive = function() {
  return this.find({ 
    status: 'active', 
    isActive: true, 
    isDeleted: false 
  });
};

// Find companies pending approval
CompanySchema.statics.findPending = function() {
  return this.find({ 
    status: 'pending', 
    isDeleted: false 
  }).sort({ registrationDate: -1 });
};

// Find companies by city
CompanySchema.statics.findByCity = function(city) {
  return this.find({ 
    city: new RegExp(city, 'i'),
    status: 'active',
    isActive: true,
    isDeleted: false
  });
};

const Company = mongoose.model("Company", CompanySchema);
export default Company;