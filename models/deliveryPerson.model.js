// models/deliveryPerson.model.js
import mongoose from 'mongoose';

const deliveryPersonSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  licenseNumber: {
    type: String,
    required: true
  },
  vehicleType: {
    type: String,
    enum: ['bike', 'car', 'van', 'truck'],
    required: true
  },
  vehiclePlate: {
    type: String,
    required: true
  },
  vehicleColor: String,
  vehicleModel: String,
  vehicleYear: Number,
  vehicleMake: String,
  
  // Location tracking
  currentLocation: {
    lat: Number,
    lng: Number,
    address: String,
    updatedAt: Date
  },
  
  // Status
  isAvailable: {
    type: Boolean,
    default: true
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  
  // Service types this person can perform
  services: {
    deliveries: {
      type: Boolean,
      default: true
    },
    rides: {
      type: Boolean,
      default: false
    }
  },
  
  // Current assignments
  currentDeliveryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Delivery'
  },
  currentRideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride'
  },
  
  // Stats
  totalDeliveries: {
    type: Number,
    default: 0
  },
  totalRides: {
    type: Number,
    default: 0
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    default: 0
  },
  ratingCount: {
    type: Number,
    default: 0
  },
  
  // Documents
  licensePhoto: String,
  vehiclePhoto: String,
  insurancePhoto: String,
  
  // Additional documents for rides
  roadworthinessCert: String,
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
deliveryPersonSchema.index({ userId: 1 }, { unique: true });
deliveryPersonSchema.index({ 'currentLocation.lat': 1, 'currentLocation.lng': 1 });
deliveryPersonSchema.index({ isOnline: 1, isAvailable: 1 });

// Pre-save middleware
deliveryPersonSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Helper function to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Instance methods
deliveryPersonSchema.methods.updateLocation = async function(lat, lng, address = '') {
  this.currentLocation = {
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    address,
    updatedAt: new Date()
  };
  return this.save();
};

deliveryPersonSchema.methods.goOnline = async function() {
  if (!this.isVerified) {
    throw new Error('You must be verified to go online');
  }
  
  // Check required documents
  const requiredDocs = ['licensePhoto', 'vehiclePhoto', 'insurancePhoto'];
  const missingDocs = requiredDocs.filter(doc => !this[doc]);
  
  if (missingDocs.length > 0) {
    throw new Error(`Please upload all required documents: ${missingDocs.join(', ')}`);
  }
  
  this.isOnline = true;
  return this.save();
};

deliveryPersonSchema.methods.goOffline = async function() {
  this.isOnline = false;
  this.isAvailable = false;
  return this.save();
};

deliveryPersonSchema.methods.isAvailableForDelivery = function() {
  return this.isAvailable && 
         this.isOnline && 
         this.isVerified && 
         !this.currentDeliveryId && 
         this.services.deliveries;
};

deliveryPersonSchema.methods.isAvailableForRide = function(vehicleType = null) {
  return this.isAvailable && 
         this.isOnline && 
         this.isVerified && 
         !this.currentRideId && 
         this.services.rides &&
         (!vehicleType || this.vehicleType === vehicleType);
};

// Static methods
deliveryPersonSchema.statics.findNearby = async function(longitude, latitude, maxDistance = 10000, serviceType = null, vehicleType = null) {
  const query = {
    isOnline: true,
    isVerified: true,
    'currentLocation.lat': { $exists: true, $ne: null },
    'currentLocation.lng': { $exists: true, $ne: null }
  };

  if (serviceType === 'delivery') {
    query.isAvailable = true;
    query.currentDeliveryId = null;
    query['services.deliveries'] = true;
  } else if (serviceType === 'ride') {
    query.isAvailable = true;
    query.currentRideId = null;
    query['services.rides'] = true;
  } else {
    query.isAvailable = true;
    query.$or = [
      { currentDeliveryId: null, 'services.deliveries': true },
      { currentRideId: null, 'services.rides': true }
    ];
  }

  if (vehicleType) {
    query.vehicleType = vehicleType;
  }

  const allPersons = await this.find(query)
    .populate('userId', 'name phone avatarUrl')
    .populate('companyId', 'name logo');

  // Filter by distance
  const nearbyPersons = allPersons.filter(person => {
    if (!person.currentLocation?.lat || !person.currentLocation?.lng) {
      return false;
    }

    const distance = calculateDistance(
      latitude,
      longitude,
      person.currentLocation.lat,
      person.currentLocation.lng
    );

    person._doc.distance = distance;
    return distance <= maxDistance / 1000; // Convert meters to km
  });

  // Sort by distance
  nearbyPersons.sort((a, b) => a._doc.distance - b._doc.distance);
  
  return nearbyPersons;
};

const DeliveryPerson = mongoose.model('DeliveryPerson', deliveryPersonSchema);
export default DeliveryPerson;