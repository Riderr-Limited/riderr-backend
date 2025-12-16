import mongoose from "mongoose";
import validator from "validator";  

const UserSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["customer", "company_admin", "rider", "admin"],
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
      }
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      index: true,
      validate: {
        validator: function(value) {
          return /^[0-9]{10,15}$/.test(value.replace(/[\s\-\(\)]/g, ''));
        },
        message: "Please provide a valid phone number (10-15 digits)"
      }
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true
    },

    avatarUrl: {
      type: String,
      default: null
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

    // Email verification
    emailVerificationToken: {
      type: String,
      default: null
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
    }
  },
  { 
    timestamps: true
  }
);

// ========== INDEXES ==========
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ isVerified: 1, isActive: 1 });

// ========== PRE-SAVE MIDDLEWARE ==========
UserSchema.pre('save', async function(next) {
  try {
    // Trim strings
    if (this.name) this.name = this.name.trim();
    if (this.email) this.email = this.email.trim().toLowerCase();
    if (this.phone) this.phone = this.phone.replace(/[\s\-\(\)]/g, '');
    
    // Set defaults based on role
    if (this.isNew) {
      if (this.role === 'admin') {
        this.isVerified = true;
        this.isActive = true;
        this.emailVerificationToken = null;
        this.emailVerificationExpires = null;
      }
    }
    
    if (next && typeof next === 'function') {
      next();
    }
  } catch (error) {
    console.log('Pre-save middleware completed');
  }
});

// ========== INSTANCE METHODS ==========
UserSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    const bcrypt = await import('bcrypt');
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error('Password comparison error:', error);
    throw error;
  }
};

const User = mongoose.model("User", UserSchema);

export default User;