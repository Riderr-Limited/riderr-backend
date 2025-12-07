import mongoose from "mongoose";

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    // Enum for userType to restrict values to predefined roles.
    userType: {
      type: String,
      enum: ["customer", "business", "rider", "admin"],
      required: true,
      default: "customer", // Default user type is 'customer'
    },

    // Phone number field with validation for format and uniqueness.
    phone: {
      type: String,
      unique: true,
      required: [true, "Phone number is required"],
      validate: {
        validator: function (v) {
          // Basic phone number validation (customizable)
          return /^[+]?[\d\s\-()]+$/.test(v);
        },
        message: (props) => `${props.value} is not a valid phone number!`,
      },
    },

    // Email validation with allowance for empty value (if optional).
    email: {
      type: String,
      sparse: true, // Allows null values for email
      lowercase: true, // Stores email in lowercase for uniformity
      trim: true, // Trims leading/trailing spaces
      validate: {
        validator: function (v) {
          if (!v) return true; // Allow empty email (optional)
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); // Basic email format validation
        },
        message: (props) => `${props.value} is not a valid email address!`,
      },
    },

    // Name field with validation for required and minimum length
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true, // Removes extra spaces
      minlength: [2, "Name must be at least 2 characters long"],
    },

    // Profile photo URL (optional field with default null)
    profilePhoto: {
      type: String,
      default: null, // Default is null, meaning no profile photo is provided
    },

    // Verification status and related fields
    isVerified: {
      type: Boolean,
      default: false, // Default to unverified
    },
    verificationCode: {
      type: String,
      select: false, // Hide this field by default in queries
    },
    verificationCodeExpires: {
      type: Date,
      select: false, // Hide this field by default
    },

    // Last login date (set to null if no login yet)
    lastLogin: {
      type: Date,
      default: null, // Default is null if user has not logged in
    },

    // Active status (default to true)
    isActive: {
      type: Boolean,
      default: true, // Default is active
    },

    // Password hash and refresh token (both hidden for security reasons)
    passwordHash: {
      type: String,
      select: false, // Hide this field in queries by default
    },
    refreshToken: {
      type: String,
      select: false, // Hide this field by default
    },

    // Timestamps (Mongoose handles these fields)
    createdAt: {
      type: Date,
      default: Date.now, // Automatically set the current time when the document is created
    },
    updatedAt: {
      type: Date,
      default: Date.now, // Automatically set the current time when the document is created
    },
  },
  {
    timestamps: true, // Mongoose automatically manages createdAt and updatedAt
    toJSON: { virtuals: true }, // Include virtual fields in the JSON output
    toObject: { virtuals: true }, // Include virtual fields in the Object output
  }
);

// **Indexes** for optimizing queries by phone, email, userType, and verification status
UserSchema.index({ phone: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ userType: 1 });
UserSchema.index({ isVerified: 1 });
UserSchema.index({ createdAt: -1 }); // Index on createdAt for better performance in queries sorted by creation date

// Middleware to update the `updatedAt` field before saving
UserSchema.pre("save", function (next) {
  this.updatedAt = Date.now(); // Set updatedAt to the current time before saving
  next(); // Proceed with the save operation
});

// **Virtual Property** for status based on `isVerified` and `isActive` values
UserSchema.virtual("status").get(function () {
  if (!this.isActive) return "inactive"; // If the user is not active, return 'inactive'
  if (!this.isVerified) return "unverified"; // If the user is not verified, return 'unverified'
  return "active"; // Default to 'active' if the user is both active and verified
});

// **Instance Method** to mark a user as verified
UserSchema.methods.verify = function () {
  this.isVerified = true; // Mark user as verified
  this.verificationCode = undefined; // Clear the verification code
  this.verificationCodeExpires = undefined; // Clear the expiration time
  return this.save(); // Save the updated user document
};

// **Static Method** to find a user by phone number
UserSchema.statics.findByPhone = function (phone) {
  return this.findOne({ phone });
};

// **Static Method** to find a user by email (email is stored in lowercase)
UserSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase() });
};

const User = mongoose.model("User", UserSchema);
export default User;
