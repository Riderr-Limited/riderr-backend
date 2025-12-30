import mongoose from "mongoose";
import validator from "validator";
import bcrypt from "bcrypt";

const UserSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["customer", "company_admin", "driver", "admin"],
      required: [true, "Role is required"],
      index: true
    },

    name: { 
      type: String, 
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"]
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: validator.isEmail,
        message: "Please provide a valid email address"
      },
      index: true
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
      index: true,
      validate: {
        validator: function(value) {
          return /^(\+234|0)[7-9][0-1]\d{8}$/.test(value.replace(/[\s\-\(\)]/g, ''));
        },
        message: "Please provide a valid Nigerian phone number"
      }
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false
    },

    // ✅ ADD BOTH FIELDS FOR COMPATIBILITY
    avatarUrl: {
      type: String,
      default: null
    },

    profileImage: { // ✅ Add this field
      type: String,
      default: null
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true
    },

    // Account status
    isVerified: {
      type: Boolean,
      default: false,
      index: true
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },

    // Authentication
    refreshToken: {
      type: String,
      default: null,
      select: false
    },

    resetPasswordToken: {
      type: String,
      default: null,
      select: false
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false
    },

    lastLoginAt: {
      type: Date,
      default: null
    },

    lastSeenAt: {
      type: Date,
      default: Date.now
    },

    loginAttempts: {
      type: Number,
      default: 0
    },

    lockUntil: {
      type: Date,
      default: null
    },

    // Email verification
    emailVerificationToken: {
      type: String,
      default: null,
      select: false
    },

    emailVerificationExpires: {
      type: Date,
      default: null
    },

    emailVerifiedAt: {
      type: Date,
      default: null
    },

    verificationAttempts: {
      type: Number,
      default: 0
    },

    // Device tokens for push notifications
    deviceTokens: [
      {
        token: String,
        platform: {
          type: String,
          enum: ['ios', 'android', 'web']
        },
        addedAt: {
          type: Date,
          default: Date.now
        }
      }
    ],

    // User preferences
    preferences: {
      language: {
        type: String,
        default: 'en',
        enum: ['en', 'yo', 'ig', 'ha']
      },
      notifications: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        push: { type: Boolean, default: true }
      }
    },

    // Additional metadata
    metadata: {
      signupSource: {
        type: String,
        enum: ['web', 'android', 'ios'],
        default: 'web'
      },
      referralCode: String,
      referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }
  },
  { 
    timestamps: true,
    toJSON: { 
      virtuals: true,
      transform: function(doc, ret) {
        delete ret.password;
        delete ret.refreshToken;
        delete ret.emailVerificationToken;
        delete ret.resetPasswordToken;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// ========== INDEXES ==========
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ role: 1, isActive: 1, isDeleted: 1 });
UserSchema.index({ isVerified: 1, isActive: 1 });
UserSchema.index({ companyId: 1, role: 1 });
UserSchema.index({ driverId: 1 });
UserSchema.index({ 'metadata.referralCode': 1 }, { sparse: true });

// ========== VIRTUAL FIELDS ==========
UserSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

UserSchema.virtual('isEmailVerified').get(function() {
  return !!this.emailVerifiedAt;
});

UserSchema.virtual('fullName').get(function() {
  return this.name;
});

 // ========== PRE-SAVE MIDDLEWARE ==========
UserSchema.pre('save', async function(next) {
  try {
    // Trim and normalize strings
    if (this.name) this.name = this.name.trim();
    if (this.email) this.email = this.email.trim().toLowerCase();
    if (this.phone) {
      this.phone = this.phone.trim().replace(/[\s\-\(\)]/g, '');
    }
    
    // ✅ Sync avatarUrl and profileImage for backward compatibility
    if (this.avatarUrl && !this.profileImage) {
      this.profileImage = this.avatarUrl;
    }
    if (this.profileImage && !this.avatarUrl) {
      this.avatarUrl = this.profileImage;
    }
    
    // Set defaults based on role
    if (this.isNew) {
      if (this.role === 'admin') {
        this.isVerified = true;
        this.isActive = true;
        this.emailVerifiedAt = new Date();
      }
      
      // Generate referral code for customers
      if (this.role === 'customer' && !this.metadata.referralCode) {
        this.metadata.referralCode = this._id.toString().slice(-8).toUpperCase();
      }
    }
    
    // Validate companyId for company_admin and driver roles
    if (this.role === 'company_admin' || this.role === 'driver') {
      if (!this.companyId) {
        throw new Error(`${this.role} must have a companyId`);
      }
    }
    
   } catch (error) {
    console.log(error);
   }
});

// ========== INSTANCE METHODS ==========

// Compare password
UserSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    if (!this.password) {
      const user = await mongoose.model('User').findById(this._id).select('+password');
      return await bcrypt.compare(candidatePassword, user.password);
    }
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error('Password comparison error:', error);
    throw error;
  }
};

// Get safe user object
UserSchema.methods.toSafeObject = function() {
  return {
    id: this._id,
    role: this.role,
    name: this.name,
    email: this.email,
    phone: this.phone,
    avatarUrl: this.avatarUrl || this.profileImage, // ✅ Return whichever is available
    profileImage: this.profileImage || this.avatarUrl, // ✅ Return both
    isVerified: this.isVerified,
    isActive: this.isActive,
    companyId: this.companyId,
    driverId: this.driverId,
    isEmailVerified: this.isEmailVerified,
    preferences: this.preferences,
    createdAt: this.createdAt
  };
};

const User = mongoose.model("User", UserSchema);

export default User;