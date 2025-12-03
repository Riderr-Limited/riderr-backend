import mongoose from "mongoose";
import { ObjectId } from "mongodb";


const RiderSchema = new mongoose.Schema({
  _id: ObjectId,
  userId: ObjectId,  
  businessId: ObjectId,  
  personalInfo: {
    fullName: String,
    dateOfBirth: Date,
    gender: String,
  },
  vehicle: {
    type: "bike" | "car" | "truck",
    make: String,
    model: String,
    year: Number,
    plateNumber: String,
    color: String,
  },
  documents: {
    license: String,
    idCard: String,
    vehiclePapers: String,
    insurance: String,
  },
  status: {
    isOnline: Boolean,
    isAvailable: Boolean,
    lastOnline: Date,
    currentLocation: {
      lat: Number,
      lng: Number,
      updatedAt: Date,
    },
  },
  performance: {
    rating: {
      average: Number,
      count: Number,
    },
    stats: {
      totalDeliveries: Number,
      completedDeliveries: Number,
      cancellationRate: Number,
      averageDeliveryTime: Number, // in minutes
    },
  },
  earnings: {
    today: Number,
    thisWeek: Number,
    thisMonth: Number,
    total: Number,
    pendingPayout: Number,
  },
  preferences: {
    workingHours: {
      start: String, // "09:00"
      end: String, // "18:00"
    },
    maxDistance: Number, // in km
    preferredAreas: [String],
  },
});


const Rider = mongoose.model("Rider", RiderSchema);
export default Rider;