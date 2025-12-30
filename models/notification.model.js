import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    // Recipient of the notification
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    // Notification details
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"]
    },

    message: {
      type: String,
      required: [true, "Notification message is required"],
      trim: true,
      maxlength: [500, "Message cannot exceed 500 characters"]
    },

    // Notification type for categorization
    type: {
      type: String,
      required: true,
      enum: [
        "system",        // System notifications
        "delivery",      // Delivery related
        "payment",       // Payment updates
        "security",      // Security alerts
        "promotion",     // Promotional offers
        "order",         // Order updates
        "support",       // Support messages
        "driver",        // Driver specific
        "company",       // Company admin specific
        "announcement"   // General announcements
      ],
      default: "system",
      index: true
    },

    // Sub-type for more specific categorization
    subType: {
      type: String,
      enum: [
        // Delivery related
        "delivery_request",
        "delivery_accepted",
        "delivery_picked_up",
        "delivery_in_transit",
        "delivery_completed",
        "delivery_cancelled",
        "delivery_failed",
        
        // Payment related
        "payment_success",
        "payment_failed",
        "payment_refunded",
        "payout_processed",
        
        // Security related
        "login_alert",
        "password_changed",
        "new_device",
        
        // Order related
        "order_confirmed",
        "order_shipped",
        "order_delivered",
        "order_cancelled",
        
        // Driver related
        "driver_approved",
        "driver_suspended",
        "new_assignment",
        "rating_received",
        
        // Company related
        "company_approved",
        "company_suspended",
        "driver_application",
        
        // General
        "welcome",
        "verification",
        "reminder",
        "alert"
      ],
      index: true
    },

    // Additional data for the notification
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    // Read status
    read: {
      type: Boolean,
      default: false,
      index: true
    },

    readAt: {
      type: Date,
      default: null
    },

    // Click status (if notification has action)
    clicked: {
      type: Boolean,
      default: false
    },

    clickedAt: {
      type: Date,
      default: null
    },

    // Priority levels
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true
    },

    // Delivery method flags
    deliveryMethods: {
      push: {
        sent: { type: Boolean, default: false },
        sentAt: { type: Date, default: null },
        error: { type: String, default: null }
      },
      email: {
        sent: { type: Boolean, default: false },
        sentAt: { type: Date, default: null },
        error: { type: String, default: null }
      },
      sms: {
        sent: { type: Boolean, default: false },
        sentAt: { type: Date, default: null },
        error: { type: String, default: null }
      }
    },

    // Expiry for time-sensitive notifications
    expiresAt: {
      type: Date,
      default: null,
      index: { 
        expireAfterSeconds: 0,
        sparse: true 
      }
    },

    // Link or action associated with notification
    actionUrl: {
      type: String,
      default: null
    },

    actionLabel: {
      type: String,
      default: null
    },

    // Grouping notifications
    groupId: {
      type: String,
      default: null,
      index: true
    },

    // For broadcast notifications
    isBroadcast: {
      type: Boolean,
      default: false
    },

    // Metadata
    metadata: {
      deviceId: String,
      platform: {
        type: String,
        enum: ['web', 'android', 'ios', null],
        default: null
      },
      ipAddress: String,
      userAgent: String,
      appVersion: String
    }
  },
  { 
    timestamps: true,
    toJSON: { 
      virtuals: true,
      transform: function(doc, ret) {
        // Calculate human-readable time
        ret.timeAgo = getTimeAgo(doc.createdAt);
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// ========== INDEXES ==========
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, priority: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ type: 1, subType: 1 });
NotificationSchema.index({ "deliveryMethods.push.sent": 1 });
NotificationSchema.index({ "deliveryMethods.email.sent": 1 });
NotificationSchema.index({ groupId: 1, userId: 1 });

// ========== VIRTUAL FIELDS ==========
NotificationSchema.virtual('isExpired').get(function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
});

NotificationSchema.virtual('isActionable').get(function() {
  return !!(this.actionUrl || this.actionLabel);
});

NotificationSchema.virtual('isHighPriority').get(function() {
  return ['high', 'urgent'].includes(this.priority);
});

// ========== STATIC METHODS ==========

/**
 * Get unread notifications count for a user
 */
NotificationSchema.statics.getUnreadCount = async function(userId) {
  try {
    return await this.countDocuments({ 
      userId, 
      read: false 
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    return 0;
  }
};

/**
 * Mark all notifications as read for a user
 */
NotificationSchema.statics.markAllAsRead = async function(userId) {
  try {
    const result = await this.updateMany(
      { userId, read: false },
      { 
        $set: { 
          read: true, 
          readAt: new Date() 
        } 
      }
    );
    
    return {
      success: true,
      modifiedCount: result.modifiedCount
    };
  } catch (error) {
    console.error('Mark all as read error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get notifications for user with pagination
 */
NotificationSchema.statics.getUserNotifications = async function(userId, options = {}) {
  try {
    const {
      page = 1,
      limit = 20,
      read = null,
      type = null,
      priority = null,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const query = { userId };
    
    // Apply filters
    if (read !== null) query.read = read;
    if (type) query.type = type;
    if (priority) query.priority = priority;

    const skip = (page - 1) * limit;
    
    const [notifications, total] = await Promise.all([
      this.find(query)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.countDocuments(query)
    ]);

    // Add timeAgo to each notification
    notifications.forEach(notification => {
      notification.timeAgo = getTimeAgo(notification.createdAt);
    });

    return {
      success: true,
      data: {
        notifications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    };
  } catch (error) {
    console.error('Get user notifications error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create system notification
 */
NotificationSchema.statics.createSystemNotification = async function(userId, title, message, data = {}) {
  try {
    const notification = new this({
      userId,
      title,
      message,
      type: 'system',
      subType: data.subType || 'system',
      data,
      priority: data.priority || 'medium'
    });

    await notification.save();
    return { success: true, notification };
  } catch (error) {
    console.error('Create system notification error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Create delivery notification
 */
NotificationSchema.statics.createDeliveryNotification = async function(userId, deliveryId, status, additionalData = {}) {
  try {
    const statusMessages = {
      'delivery_request': { 
        title: 'New Delivery Request', 
        message: 'You have a new delivery request',
        priority: 'high'
      },
      'delivery_accepted': { 
        title: 'Delivery Accepted', 
        message: 'Your delivery has been accepted by a driver',
        priority: 'medium'
      },
      'delivery_picked_up': { 
        title: 'Package Picked Up', 
        message: 'Your package has been picked up',
        priority: 'medium'
      },
      'delivery_in_transit': { 
        title: 'Delivery In Progress', 
        message: 'Your delivery is on the way',
        priority: 'medium'
      },
      'delivery_completed': { 
        title: 'Delivery Completed', 
        message: 'Your delivery has been completed successfully',
        priority: 'medium'
      },
      'delivery_cancelled': { 
        title: 'Delivery Cancelled', 
        message: 'Your delivery has been cancelled',
        priority: 'high'
      }
    };

    const messageConfig = statusMessages[status] || { 
      title: 'Delivery Update', 
      message: `Delivery status: ${status}`,
      priority: 'medium'
    };

    const notification = new this({
      userId,
      title: messageConfig.title,
      message: messageConfig.message,
      type: 'delivery',
      subType: status,
      data: {
        deliveryId,
        status,
        ...additionalData
      },
      priority: messageConfig.priority,
      actionUrl: `/deliveries/${deliveryId}`,
      actionLabel: 'View Delivery'
    });

    await notification.save();
    return { success: true, notification };
  } catch (error) {
    console.error('Create delivery notification error:', error);
    return { success: false, error: error.message };
  }
};

// ========== INSTANCE METHODS ==========

/**
 * Mark notification as read
 */
NotificationSchema.methods.markAsRead = async function() {
  try {
    this.read = true;
    this.readAt = new Date();
    await this.save();
    return { success: true };
  } catch (error) {
    console.error('Mark as read error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark notification as clicked
 */
NotificationSchema.methods.markAsClicked = async function() {
  try {
    this.clicked = true;
    this.clickedAt = new Date();
    await this.save();
    return { success: true };
  } catch (error) {
    console.error('Mark as clicked error:', error);
    return { success: false, error: error.message };
  }
};

// ========== HELPER FUNCTIONS ==========

/**
 * Get human-readable time difference
 */
function getTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) return 'Just now';
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  
  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) return `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`;
  
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  
  const diffInYears = Math.floor(diffInDays / 365);
  return `${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`;
}

// ========== PRE-SAVE MIDDLEWARE ==========
NotificationSchema.pre('save', function(next) {
  // Set default expiresAt for time-sensitive notifications
  if (!this.expiresAt && this.isHighPriority) {
    this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days for high priority
  }
  
  // Truncate long messages
  if (this.message && this.message.length > 500) {
    this.message = this.message.substring(0, 497) + '...';
  }
  
  next();
});

const Notification = mongoose.model("Notification", NotificationSchema);

export default Notification;