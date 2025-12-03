import mongoose from "mongoose";
import { ObjectId } from "mongodb";

const BusinessSchema = new mongoose.Schema({
  _id: ObjectId,
  userId: ObjectId, // Reference to Users
  name: String,
  businessType: "restaurant" | "retail" | "logistics" | "other",
  registrationNumber: String,
  taxId: String,
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    coordinates: { lat: Number, lng: Number },
  },
  contact: {
    phone: String,
    email: String,
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
    autoAccept: Boolean,
    radius: Number, // in km
    commissionRate: Number,
  },
  status: "pending" | "active" | "suspended" | "rejected",
  rating: {
    average: Number,
    count: Number,
    breakdown: [Number], // [1-star, 2-star, etc.]
  },
  stats: {
    totalDeliveries: Number,
    completedDeliveries: Number,
    totalRevenue: Number,
    activeSince: Date,
  },
});

const Business = mongoose.model("Business", BusinessSchema);
export default Business;
