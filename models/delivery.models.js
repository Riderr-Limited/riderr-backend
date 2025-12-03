import mongoose from "mongoose";
import { ObjectId } from "mongodb";

const DeliverySchema = new mongoose.Schema({
  _id: ObjectId,
  deliveryId: String,  
  customerId: ObjectId,
  businessId: ObjectId,
  riderId: ObjectId,
  packageDetails: {
    type: "small" | "food" | "documents" | "heavy",
    description: String,
    weight: Number, // in kg
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
    },
    notes: String,
    value: Number, // Declared value for insurance
  },
  locations: {
    pickup: {
      address: String,
      coordinates: { lat: Number, lng: Number },
      contact: {
        name: String,
        phone: String,
      },
      instructions: String,
    },
    dropoff: {
      address: String,
      coordinates: { lat: Number, lng: Number },
      contact: {
        name: String,
        phone: String,
      },
      instructions: String,
    },
  },
  pricing: {
    baseFare: Number,
    distanceFare: Number,
    weightSurcharge: Number,
    totalAmount: Number,
    platformCommission: Number,
    riderEarnings: Number,
    businessEarnings: Number,
  },
  status: {
    current:
      "pending" |
      "accepted" |
      "assigned" |
      "picked_up" |
      "in_transit" |
      "delivered" |
      "cancelled" |
      "failed",
    history: [
      {
        status: String,
        timestamp: Date,
        actor: String, // "system" | "customer" | "business" | "rider"
        location: { lat: Number, lng: Number },
      },
    ],
  },
  tracking: {
    route: [
      {
        lat: Number,
        lng: Number,
        timestamp: Date,
        speed: Number,
      },
    ],
    distance: Number, // in km
    estimatedTime: Number, // in minutes
    actualTime: Number, // in minutes
  },
  proofOfDelivery: {
    type: "photo" | "pin" | "signature",
    value: String, // URL for photo, PIN code, or signature data
    timestamp: Date,
  },
  payment: {
    method: "cash" | "card" | "transfer",
    status: "pending" | "completed" | "failed" | "refunded",
    transactionId: String,
    paidAt: Date,
  },
  ratings: {
    rider: {
      stars: Number,
      comment: String,
      timestamp: Date,
    },
    business: {
      stars: Number,
      comment: String,
      timestamp: Date,
    },
    customer: {
      stars: Number, // From rider/business perspective
      comment: String,
      timestamp: Date,
    },
  },
  timestamps: {
    created: Date,
    accepted: Date,
    assigned: Date,
    pickedUp: Date,
    delivered: Date,
    cancelled: Date,
  },
  metadata: {
    matchingAlgorithm: String, 
    cancellationReason: String,
    disputeId: ObjectId, 
    notes: String,
  },
});

const Delivery = mongoose.model("Delivery", DeliverySchema);
export default Delivery;
