// models/delivery.models.js
import mongoose from 'mongoose';

const deliverySchema = new mongoose.Schema({
   referenceId: {
    type: String,
    unique: true,
    index: true
   },
  
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  deliveryPersonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  
  // Customer details
  customerName: {
    type: String,
    required: true
  },
  customerPhone: {
    type: String,
    required: true
  },
  
  // Recipient details
  recipientName: {
    type: String,
    required: true
  },
  recipientPhone: {
    type: String,
    required: true
  },
  
  // Pickup location
  pickup: {
    address: {
      type: String,
      required: true
    },
    lat: {
      type: Number,
      required: true
    },
    lng: {
      type: Number,
      required: true
    },
    name: String,
    instructions: String
  },
  
  // Dropoff location
  dropoff: {
    address: {
      type: String,
      required: true
    },
    lat: {
      type: Number,
      required: true
    },
    lng: {
      type: Number,
      required: true
    },
    name: String,
    instructions: String
  },
  
  // Item details
  itemType: {
    type: String,
    enum: ['package', 'document', 'food', 'electronics', 'other'],
    default: 'package'
  },
  itemDescription: String,
  itemWeight: {
    type: Number,
    default: 1
  },
  itemValue: {
    type: Number,
    default: 0
  },
  
  // Delivery estimates
  estimatedDistanceMeters: Number,
  estimatedDurationSec: Number,
  
  // Instructions
  deliveryInstructions: String,
  
  // Status
  status: {
    type: String,
    enum: [
      'created',
      'assigned',
      'picked_up',
      'in_transit',
      'delivered',
      'cancelled',
      'returned',
      'failed'
    ],
    default: 'created'
  },
  
  // Timestamps
  assignedAt: Date,
  pickedUpAt: Date,
  inTransitAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  returnedAt: Date,
  failedAt: Date,
  
  // Meta information
  meta: {
    platform: String,
    ipAddress: String,
    trackingLocation: {
      lat: Number,
      lng: Number,
      timestamp: Date
    },
    trackingHistory: [{
      lat: Number,
      lng: Number,
      timestamp: Date
    }]
  },
  
  // Payment information
  payment: {
    amount: Number,
    currency: {
      type: String,
      default: 'NGN'
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },
    method: String,
    transactionId: String
  },
  
  // Ratings and feedback
  rating: {
    score: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String,
    ratedAt: Date
  },
  
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

// Indexes for better query performance
deliverySchema.index({ customerId: 1, status: 1 });
deliverySchema.index({ deliveryPersonId: 1, status: 1 });
deliverySchema.index({ companyId: 1, status: 1 });
deliverySchema.index({ status: 1 });
deliverySchema.index({ createdAt: -1 });
deliverySchema.index({ referenceId: 1 }, { unique: true, sparse: true });

// Generate referenceId BEFORE validation
deliverySchema.pre('validate', async function(next) {
  // Only generate for new documents that don't have a referenceId
  if (this.isNew && !this.referenceId) {
    let unique = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!unique && attempts < maxAttempts) {
      // Format: DEL-YYYYMMDD-XXXXX
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      // Generate 5 character alphanumeric code
      const random = Math.random().toString(36).substring(2, 7).toUpperCase();
      
      this.referenceId = `DEL-${year}${month}${day}-${random}`;
      
      // Check if this reference ID already exists
      try {
        const existing = await this.constructor.findOne({ 
          referenceId: this.referenceId 
        });
        
        if (!existing) {
          unique = true;
        }
      } catch (error) {
        console.error('Error checking referenceId uniqueness:', error);
      }
      
      attempts++;
    }
    
    // Fallback with timestamp if we couldn't generate unique ID
    if (!unique) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 5).toUpperCase();
      this.referenceId = `DEL-${timestamp}-${random}`;
      console.warn('Used timestamp fallback for referenceId:', this.referenceId);
    }
  }
 
});

// Update timestamps before saving
deliverySchema.pre('save', function(next) {
  this.updatedAt = new Date();
 
});

// Virtual for formatted status
deliverySchema.virtual('statusText').get(function() {
  const statusMap = {
    'created': 'Created',
    'assigned': 'Assigned',
    'picked_up': 'Picked Up',
    'in_transit': 'In Transit',
    'delivered': 'Delivered',
    'cancelled': 'Cancelled',
    'returned': 'Returned',
    'failed': 'Failed'
  };
  return statusMap[this.status] || this.status;
});

// Virtual for estimated delivery time
deliverySchema.virtual('estimatedDeliveryTime').get(function() {
  if (!this.estimatedDurationSec) return null;
  const minutes = Math.ceil(this.estimatedDurationSec / 60);
  return `${minutes} min${minutes > 1 ? 's' : ''}`;
});

// Virtual for formatted distance
deliverySchema.virtual('formattedDistance').get(function() {
  if (!this.estimatedDistanceMeters) return null;
  const km = (this.estimatedDistanceMeters / 1000).toFixed(1);
  return `${km} km`;
});

// Virtual for delivery summary
deliverySchema.virtual('summary').get(function() {
  return {
    referenceId: this.referenceId,
    from: this.pickup.name || this.pickup.address.split(',')[0],
    to: this.dropoff.name || this.dropoff.address.split(',')[0],
    status: this.status,
    statusText: this.statusText,
    itemType: this.itemType,
    createdAt: this.createdAt
  };
});

// Method to check if delivery can be cancelled
deliverySchema.methods.canBeCancelled = function() {
  return ['created', 'assigned'].includes(this.status);
};

// Method to check if delivery can be rated
deliverySchema.methods.canBeRated = function() {
  return this.status === 'delivered' && !this.rating?.score;
};

// Method to update status with validation
deliverySchema.methods.updateStatus = async function(newStatus, location = null) {
  const validTransitions = {
    'created': ['assigned', 'cancelled'],
    'assigned': ['picked_up', 'cancelled'],
    'picked_up': ['in_transit', 'returned'],
    'in_transit': ['delivered', 'failed', 'returned'],
    'delivered': [],
    'cancelled': [],
    'returned': [],
    'failed': []
  };

  if (!validTransitions[this.status]?.includes(newStatus)) {
    throw new Error(`Invalid status transition from ${this.status} to ${newStatus}`);
  }

  this.status = newStatus;
  
  // Update timestamps based on status
  const timestampMap = {
    'assigned': 'assignedAt',
    'picked_up': 'pickedUpAt',
    'in_transit': 'inTransitAt',
    'delivered': 'deliveredAt',
    'cancelled': 'cancelledAt',
    'returned': 'returnedAt',
    'failed': 'failedAt'
  };

  if (timestampMap[newStatus]) {
    this[timestampMap[newStatus]] = new Date();
  }

  // Update tracking location if provided
  if (location && location.lat && location.lng) {
    if (!this.meta) {
      this.meta = {};
    }
    
    this.meta.trackingLocation = {
      lat: parseFloat(location.lat),
      lng: parseFloat(location.lng),
      timestamp: new Date()
    };

    if (!this.meta.trackingHistory) {
      this.meta.trackingHistory = [];
    }
    
    this.meta.trackingHistory.push({
      lat: parseFloat(location.lat),
      lng: parseFloat(location.lng),
      timestamp: new Date()
    });
  }

  return this.save();
};

// Method to add rating
deliverySchema.methods.addRating = async function(score, feedback = '') {
  if (!this.canBeRated()) {
    throw new Error('This delivery cannot be rated');
  }

  if (score < 1 || score > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  this.rating = {
    score,
    feedback,
    ratedAt: new Date()
  };

  return this.save();
};

// Method to calculate actual distance traveled
deliverySchema.methods.calculateActualDistance = function() {
  if (!this.meta?.trackingHistory || this.meta.trackingHistory.length < 2) {
    return null;
  }

  let totalDistance = 0;
  const history = this.meta.trackingHistory;

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    
    const R = 6371;
    const dLat = (curr.lat - prev.lat) * Math.PI / 180;
    const dLng = (curr.lng - prev.lng) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(prev.lat * Math.PI / 180) * Math.cos(curr.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    totalDistance += distance;
  }

  return totalDistance;
};

// Method to get delivery duration
deliverySchema.methods.getDeliveryDuration = function() {
  if (!this.deliveredAt || !this.pickedUpAt) {
    return null;
  }

  const durationMs = this.deliveredAt - this.pickedUpAt;
  const durationMin = Math.floor(durationMs / 60000);
  
  return {
    milliseconds: durationMs,
    minutes: durationMin,
    formatted: `${durationMin} min${durationMin !== 1 ? 's' : ''}`
  };
};

// Static method to get delivery statistics
deliverySchema.statics.getStatistics = async function(filters = {}) {
  const query = { ...filters };
  
  const stats = await this.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalValue: { $sum: '$itemValue' }
      }
    }
  ]);

  const total = await this.countDocuments(query);
  
  return {
    total,
    byStatus: stats.reduce((acc, stat) => {
      acc[stat._id] = {
        count: stat.count,
        totalValue: stat.totalValue
      };
      return acc;
    }, {})
  };
};

// Enable virtuals in JSON
deliverySchema.set('toJSON', { virtuals: true });
deliverySchema.set('toObject', { virtuals: true });

const Delivery = mongoose.model('Delivery', deliverySchema);
export default Delivery;