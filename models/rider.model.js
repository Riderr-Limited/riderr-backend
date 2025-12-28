import mongoose from "mongoose";

const riderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    
    // Rider details
    licenseNumber: String,
    vehicleType: {
      type: String,
      enum: ["motorcycle", "car", "bicycle", "truck"],
      default: "motorcycle",
    },
    vehiclePlate: String,
    vehicleColor: String,
    vehicleModel: String,
    
    // Rider status
    isAvailable: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    
    // Current delivery info
    currentDeliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
      default: null,
    },
    
    // Location
    currentLocation: {
      lat: Number,
      lng: Number,
      address: String,
      updatedAt: Date,
    },
    
    // Stats
    totalDeliveries: {
      type: Number,
      default: 0,
    },
    totalDistance: {
      type: Number,
      default: 0,
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    
    // Documents
    licensePhoto: String,
    vehiclePhoto: String,
    insurancePhoto: String,
    
    // Settings
    notificationPreferences: {
      newDelivery: { type: Boolean, default: true },
      statusUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
    },
    
    meta: Object,
  },
  { timestamps: true }
);

// Create indexes
riderSchema.index({ companyId: 1, isAvailable: 1 });
riderSchema.index({ "currentLocation.lat": 1, "currentLocation.lng": 1 });

// Export as Rider model
const Rider = mongoose.model("Rider", riderSchema);
export default Rider;