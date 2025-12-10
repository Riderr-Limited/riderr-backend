import mongoose from "mongoose";
import validator from "validator";
import crypto from "crypto";

const UserSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["customer", "company_admin", "rider", "admin"],
      required: [true, "Role is required"],
      index: true,
      validate: {
        validator: function(value) {
          return ["customer", "company_admin", "rider", "admin"].includes(value);
        },
        message: "Invalid role. Must be customer, company_admin, rider, or admin"
      }
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
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function(value) {
          // Allow null/empty for riders without email, but validate if provided
          if (!value) return true;
          return validator.isEmail(value);
        },
        message: "Please provide a valid email address"
      }
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      index: true,
      validate: {
        validator: function(value) {
          // International phone validation
          return /^\+?[\d\s\-\(\)]{10,}$/.test(value);
        },
        message: "Please provide a valid phone number"
      }
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false // Never include in queries unless explicitly requested
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
      validate: {
        validator: function(value) {
          // Riders and company_admins must have companyId
          if (["rider", "company_admin"].includes(this.role)) {
            return mongoose.Types.ObjectId.isValid(value);
          }
          return true; // Customers and admins can have null companyId
        },
        message: "Riders and company admins must belong to a company"
      }
    },

    avatarUrl: {
      type: String,
      default: null,
      validate: {
        validator: function(value) {
          if (!value) return true; // Allow null/empty
          return validator.isURL(value, {
            protocols: ['http', 'https'],
            require_protocol: true
          });
        },
        message: "Please provide a valid URL for avatar"
      }
    },

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

    refreshToken: {
      type: String,
      default: null,
      select: false
    },

    lastSeenAt: {
      type: Date,
      default: Date.now
    },

    // For tracking login attempts
    loginAttempts: {
      type: Number,
      default: 0,
      select: false
    },

    lockUntil: {
      type: Date,
      default: null,
      select: false
    },

    // Password reset fields
    passwordResetToken: {
      type: String,
      select: false
    },

    passwordResetExpires: {
      type: Date,
      select: false
    },

    emailVerificationToken: {
      type: String,
      select: false
    },

    emailVerificationExpires: {
      type: Date,
      select: false
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ========== INDEXES ==========
UserSchema.index({ role: 1, createdAt: -1 });
UserSchema.index({ isActive: 1, role: 1 });
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ companyId: 1, role: 1 });
UserSchema.index({ isVerified: 1, isActive: 1 });
UserSchema.index({ createdAt: 1 });
UserSchema.index({ "meta.customField": 1 }); // Index for custom meta fields

// ========== VIRTUAL FIELDS ==========
UserSchema.virtual('riderProfile', {
  ref: 'Rider',
  localField: '_id',
  foreignField: 'userId',
  justOne: true
});

UserSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

UserSchema.virtual('fullProfile').get(function() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    avatarUrl: this.avatarUrl,
    isVerified: this.isVerified,
    isActive: this.isActive,
    lastSeenAt: this.lastSeenAt,
    createdAt: this.createdAt
  };
});

UserSchema.virtual('isOnline').get(function() {
  if (!this.lastSeenAt) return false;
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  return this.lastSeenAt > fifteenMinutesAgo;
});

// ========== PRE-SAVE MIDDLEWARE ==========
UserSchema.pre('save', function(next) {
  // Trim strings
  if (this.name) this.name = this.name.trim();
  if (this.email) this.email = this.email.trim().toLowerCase();
  if (this.phone) this.phone = this.phone.trim();
  
  // Set defaults based on role
  if (this.isNew) {
    if (this.role === 'admin') {
      this.isVerified = true;
      this.isActive = true;
    } else if (this.role === 'company_admin') {
      this.isVerified = true;
    }
  }
 
});

UserSchema.pre('find', function() {
  // By default, only show active users
  if (this.getFilter().isActive === undefined) {
    this.where({ isActive: true });
  }
});

// ========== INSTANCE METHODS ==========
UserSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    const bcrypt = await import('bcrypt');
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Error comparing passwords');
  }
};

UserSchema.methods.generatePasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  
  return resetToken;
};

UserSchema.methods.generateEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
    
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  return verificationToken;
};

UserSchema.methods.incrementLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  // Otherwise, increment
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock the account if we've reached max attempts and it's not already locked
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 15 * 60 * 1000 }; // 15 minutes
  }
  
  return this.updateOne(updates);
};

UserSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

// ========== VIRTUAL PROPERTIES ==========
UserSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

UserSchema.virtual('requiresVerification').get(function() {
  return this.role === 'rider' && !this.isVerified;
});

// ========== STATIC METHODS ==========
UserSchema.statics.findByEmailOrPhone = function(identifier) {
  return this.findOne({
    $or: [
      { email: identifier },
      { phone: identifier }
    ]
  });
};

UserSchema.statics.findActiveUsers = function(role = null) {
  const query = { isActive: true };
  if (role) query.role = role;
  return this.find(query);
};

UserSchema.statics.getUserStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        verified: { 
          $sum: { $cond: [{ $eq: ['$isVerified', true] }, 1, 0] } 
        },
        active: { 
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } 
        }
      }
    },
    {
      $project: {
        role: '$_id',
        count: 1,
        verified: 1,
        active: 1,
        verificationRate: { 
          $cond: [
            { $eq: ['$count', 0] }, 
            0, 
            { $divide: ['$verified', '$count'] }
          ]
        }
      }
    },
    { $sort: { count: -1 } }
  ]);
  
  return stats;
};

UserSchema.statics.searchUsers = async function(searchTerm, options = {}) {
  const { limit = 10, page = 1, role = null, companyId = null } = options;
  const skip = (page - 1) * limit;
  
  const query = {
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { email: { $regex: searchTerm, $options: 'i' } },
      { phone: { $regex: searchTerm, $options: 'i' } }
    ]
  };
  
  if (role) query.role = role;
  if (companyId) query.companyId = companyId;
  
  const [users, total] = await Promise.all([
    this.find(query)
      .select('name email phone role avatarUrl isVerified isActive')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }),
    this.countDocuments(query)
  ]);
  
  return {
    users,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit)
  };
};

// ========== QUERY HELPERS ==========
UserSchema.query.byRole = function(role) {
  return this.where({ role });
};

UserSchema.query.byCompany = function(companyId) {
  return this.where({ companyId });
};

UserSchema.query.verified = function() {
  return this.where({ isVerified: true });
};

UserSchema.query.active = function() {
  return this.where({ isActive: true });
};

UserSchema.query.recent = function(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return this.where({ createdAt: { $gte: date } });
};

// ========== POST MIDDLEWARE ==========
UserSchema.post('save', function(doc, next) {
  // Log user creation/updates if needed
  console.log(`User ${doc._id} (${doc.role}) was saved`);
  next();
});

UserSchema.post('find', function(docs, next) {
  // You can modify the results here if needed
  next();
});

const User = mongoose.model("User", UserSchema);

export default User;