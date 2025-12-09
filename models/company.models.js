import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: [true, "Company name is required"],
      trim: true
    },
    
    slug: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
    },
    
    address: String,
    city: { 
      type: String, 
      required: [true, "City is required"] 
    },
    
    lga: String,
    lat: Number,
    lng: Number,
    logoUrl: String,
    
    contactPhone: {
      type: String,
      required: [true, "Contact phone is required"]
    },
    
    contactEmail: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Please provide a valid email"
      }
    },
    
    // Add these fields for self-registration
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    
    registrationDate: {
      type: Date,
      default: Date.now
    },
    
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "rejected"],
      default: "pending",
      index: true
    },
    
    rejectionReason: {
      type: String,
      default: ""
    },
    
    settings: {
      autoAccept: { type: Boolean, default: false },
      notificationChannels: {
        type: [String],
        default: ["push"],
      },
    },
    
    onboardingDocs: [
      {
        name: String,
        url: String,
        verified: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

// Auto-generate slug before saving
CompanySchema.pre('save', function(next) {
  if (this.name && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
 
});

const Company = mongoose.model("Company", CompanySchema);
export default Company;