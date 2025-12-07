import mongoose from "mongoose";
// Corrected the import of ObjectId. It's better to use mongoose.Schema.Types for ObjectId.
const { ObjectId } = mongoose.Schema.Types;

const RiderSchema = new mongoose.Schema(
  {
    _id: ObjectId, // Using ObjectId as the primary key. Mongoose will auto-generate it.

    // Reference to the User and Business collections.
    userId: { type: ObjectId, ref: "User", required: true }, // Made 'userId' required for better data integrity.
    businessId: { type: ObjectId, ref: "Business", required: true }, // Added 'required' flag to ensure 'businessId' is always present.

    personalInfo: {
      fullName: { type: String, required: true }, // Full name is required to ensure proper identification.
      dateOfBirth: { type: Date, required: true }, // Date of birth is required for age validation.
      gender: { type: String, required: true }, // Gender is required to ensure completeness of personal information.
    },

    vehicle: {
      type: {
        type: String,
        enum: ["bike", "car", "truck"],
        required: true,
      }, // Vehicle type is mandatory with restricted values (bike, car, truck).
      make: { type: String, required: true }, // Vehicle make is required.
      model: { type: String, required: true }, // Vehicle model is required.
      year: { type: Number, required: true }, // Year is required for vehicle age validation.
      plateNumber: { type: String, required: true }, // Plate number is required to uniquely identify the vehicle.
      color: { type: String, required: true }, // Vehicle color is required.
    },

    documents: {
      license: { type: String, required: true }, // License is mandatory to verify rider's legality.
      idCard: { type: String, required: true }, // ID card is required for identity verification.
      vehiclePapers: { type: String, required: true }, // Vehicle papers are required to verify vehicle ownership.
      insurance: { type: String, required: true }, // Insurance details are mandatory to ensure rider and vehicle safety.
    },

    status: {
      isOnline: { type: Boolean, required: true }, // Track if the rider is online or not.
      isAvailable: { type: Boolean, required: true }, // Availability status is required to manage delivery assignment.
      lastOnline: { type: Date, required: true }, // Last online time is crucial for monitoring activity.
      currentLocation: {
        lat: { type: Number, required: true }, // Latitude is required for geolocation.
        lng: { type: Number, required: true }, // Longitude is required for geolocation.
        updatedAt: { type: Date, required: true }, // Timestamp of when the location was last updated.
      },
    },

    performance: {
      rating: {
        average: { type: Number, required: true }, // Average rating is required to track rider's performance.
        count: { type: Number, required: true }, // Rating count is required to know how many ratings the rider has received.
      },
      stats: {
        totalDeliveries: { type: Number, required: true }, // Total deliveries is required for performance tracking.
        completedDeliveries: { type: Number, required: true }, // Completed deliveries are required for performance evaluation.
        cancellationRate: { type: Number, required: true }, // Cancellation rate is required to assess reliability.
        averageDeliveryTime: {
          type: Number,
          required: true,
          min: 0,
        }, // Average delivery time (in minutes) is required to track delivery efficiency.
      },
    },

    earnings: {
      today: { type: Number, required: true }, // Earnings for today are required to track daily performance.
      thisWeek: { type: Number, required: true }, // Weekly earnings are required for performance and payout calculation.
      thisMonth: { type: Number, required: true }, // Monthly earnings are required for monthly reporting and payouts.
      total: { type: Number, required: true }, // Total earnings are required to track long-term performance.
      pendingPayout: { type: Number, required: true }, // Pending payouts are required to track payouts in progress.
    },

    preferences: {
      workingHours: {
        start: { type: String, required: true }, // Start time of working hours is mandatory for shift scheduling.
        end: { type: String, required: true }, // End time of working hours is mandatory for shift scheduling.
      },
      maxDistance: { type: Number, required: true }, // Max distance (in km) the rider is willing to travel is required for assignment.
      preferredAreas: {
        type: [String],
        required: true,
      }, // Preferred areas (e.g., cities, zones) are required for routing and delivery assignment.
    },
  },
  { timestamps: true } // Automatically adds 'createdAt' and 'updatedAt' fields to track rider record changes.
);

const Rider = mongoose.model("Rider", RiderSchema);
export default Rider;
