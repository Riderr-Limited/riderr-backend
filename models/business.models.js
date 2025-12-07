import mongoose from "mongoose";
// Corrected import for ObjectId. Instead of importing from 'mongodb',
// we import from mongoose.Schema.Types for better compatibility with Mongoose.
const { ObjectId } = mongoose.Schema.Types;

const BusinessSchema = new mongoose.Schema(
  {
    _id: ObjectId, // Using ObjectId as primary key. Mongoose will auto-generate it.
    userId: {
      type: ObjectId,
      ref: "User", // It's better to specify the reference to the User model for MongoDB join operations.
    },
    name: { type: String, required: true }, // Added 'required' to ensure the business name is provided.

    // Enum allows validation for businessType to ensure only valid types are entered.
    businessType: {
      type: String,
      enum: ["restaurant", "retail", "logistics", "other"],
    },

    registrationNumber: { type: String, required: true }, // Required field for registration number
    taxId: { type: String, required: true }, // Required field for tax ID

    address: {
      street: String,
      city: String,
      state: String,
      country: String,

      // Instead of just storing lat and lng, use GeoJSON format for location-based queries.
      coordinates: {
        type: { type: String, enum: ["Point"], required: true },
        coordinates: { type: [Number], required: true }, // GeoJSON Point format requires 'coordinates' as an array of numbers.
      },
    },

    contact: {
      phone: String,
      email: { type: String, required: true }, // Email should be required to ensure businesses can be contacted.
      contactPerson: String,
    },

    documents: {
      registrationCert: String,
      idCard: String,
      utilityBill: String,
    },

    bankDetails: {
      bankName: String,
      accountNumber: String,
      accountName: String,
    },

    settings: {
      autoAccept: Boolean, // Auto accept flag for business orders
      radius: {
        type: Number,
        default: 10, // Set default value of 10 km for the radius
      },
      commissionRate: {
        type: Number,
        min: 0,
        max: 1, // Commission rate should be between 0 and 1 (e.g., 0.1 for 10%)
      },
    },

    // Enum used to restrict status to valid options, preventing invalid values.
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "rejected"],
    },

    rating: {
      average: { type: Number, default: 0 }, // Default value to 0 for average rating.
      count: { type: Number, default: 0 }, // Default value to 0 for number of reviews.

      // Previously it was just an array; now it's initialized with 5 numbers to represent ratings breakdown.
      breakdown: {
        type: [Number],
        default: [0, 0, 0, 0, 0], // Represents 1-star to 5-star ratings.
      },
    },

    stats: {
      totalDeliveries: { type: Number, default: 0 }, // Default to 0 as total deliveries initially.
      completedDeliveries: { type: Number, default: 0 }, // Default to 0 for completed deliveries.
      totalRevenue: { type: Number, default: 0 }, // Default to 0 for total revenue.

      // Added default value of current date to activeSince to track when business was created.
      activeSince: { type: Date, default: Date.now }, // Default to current date as the business's start date.
    },
  },
  {
    timestamps: true, // Automatically adds 'createdAt' and 'updatedAt' fields to track document creation and updates.
  }
);

const Business = mongoose.model("Business", BusinessSchema);
export default Business;
