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
          // Nigerian phone format: +234... or 0...
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

    // Company relationship (for company_admin and driver)
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true
    },

    // Driver-specific fields
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
      index: true
    },

    avatarUrl: {
      type: String,
      default: null
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

    // Email verification (KEEP ONLY EMAIL VERIFICATION)
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

// REMOVE: isPhoneVerified virtual
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
    
    // Hash password if modified
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
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

// Generate verification code
UserSchema.methods.generateVerificationCode = function() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
};

// Set email verification token
UserSchema.methods.setEmailVerificationToken = async function() {
  const token = this.generateVerificationCode();
  this.emailVerificationToken = token;
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  await this.save();
  return token;
};

// Verify email code
UserSchema.methods.verifyEmailCode = async function(token) {
  if (!this.emailVerificationToken || !this.emailVerificationExpires) {
    return { success: false, message: 'No verification token found' };
  }
  
  if (Date.now() > this.emailVerificationExpires) {
    return { success: false, message: 'Verification token expired' };
  }
  
  if (this.emailVerificationToken !== token) {
    this.verificationAttempts += 1;
    await this.save();
    return { success: false, message: 'Invalid verification token' };
  }
  
  this.emailVerifiedAt = new Date();
  this.emailVerificationToken = null;
  this.emailVerificationExpires = null;
  this.verificationAttempts = 0;
  this.isVerified = true; // User is verified after email verification
  await this.save();
  
  return { success: true, message: 'Email verified successfully' };
};

// Add device token
UserSchema.methods.addDeviceToken = async function(token, platform) {
  this.deviceTokens = this.deviceTokens.filter(dt => dt.token !== token);
  this.deviceTokens.push({ token, platform, addedAt: new Date() });
  
  if (this.deviceTokens.length > 3) {
    this.deviceTokens = this.deviceTokens.slice(-3);
  }
  
  await this.save();
};

// Get safe user object
UserSchema.methods.toSafeObject = function() {
  return {
    id: this._id,
    role: this.role,
    name: this.name,
    email: this.email,
    phone: this.phone,
    avatarUrl: this.avatarUrl,
    isVerified: this.isVerified,
    isActive: this.isActive,
    companyId: this.companyId,
    driverId: this.driverId,
    isEmailVerified: this.isEmailVerified,
    preferences: this.preferences,
    createdAt: this.createdAt
  };
};

// ========== STATIC METHODS ==========
UserSchema.statics.findActive = function(role) {
  const query = { isActive: true, isDeleted: false };
  if (role) query.role = role;
  return this.find(query);
};

UserSchema.statics.findByEmailOrPhone = function(identifier) {
  return this.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { phone: identifier.replace(/[\s\-\(\)]/g, '') }
    ],
    isDeleted: false
  }).select('+password +refreshToken');
};

UserSchema.statics.findByCompany = function(companyId, role) {
  const query = { companyId, isDeleted: false };
  if (role) query.role = role;
  return this.find(query);
};

const User = mongoose.model("User", UserSchema);

export default User;