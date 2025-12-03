import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    userType: {
      type: String,
      enum: ["customer", "business", "rider", "admin"],
      required: true,
      default: "customer"
    },
    phone: {
      type: String,
      unique: true,
      required: [true, "Phone number is required"],
      validate: {
        validator: function(v) {
          // Basic phone validation - customize based on your needs
          return /^[+]?[\d\s\-()]+$/.test(v);
        },
        message: props => `${props.value} is not a valid phone number!`
      }
    },
    email: {
      type: String,
      sparse: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function(v) {
          if (!v) return true; // Allow empty email
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: props => `${props.value} is not a valid email address!`
      }
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"]
    },
    profilePhoto: {
      type: String,
      default: null
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    verificationCode: {
      type: String,
      select: false 
    },
    verificationCodeExpires: {
      type: Date,
      select: false
    },
    lastLogin: {
      type: Date,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    passwordHash: { 
      type: String,
      select: false
    },
    refreshToken: { 
      type: String,
      select: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true, // Mongoose will automatically handle createdAt and updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
UserSchema.index({ phone: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ userType: 1 });
UserSchema.index({ isVerified: 1 });
UserSchema.index({ createdAt: -1 });

// Middleware to update timestamps
UserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for user status
UserSchema.virtual('status').get(function() {
  if (!this.isActive) return 'inactive';
  if (!this.isVerified) return 'unverified';
  return 'active';
});

// Method to verify user
UserSchema.methods.verify = function() {
  this.isVerified = true;
  this.verificationCode = undefined;
  this.verificationCodeExpires = undefined;
  return this.save();
};

// Static method to find by phone
UserSchema.statics.findByPhone = function(phone) {
  return this.findOne({ phone });
};

// Static method to find by email
UserSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

const User = mongoose.model("User", UserSchema);
export default User;