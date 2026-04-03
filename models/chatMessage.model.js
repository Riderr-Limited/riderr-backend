import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
      required: true,
      index: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    message: {
      type: String,
      trim: true,
      maxlength: 5000,
    },

    messageType: {
      type: String,
      enum: ["text", "image", "location", "system"],
      default: "text",
    },

    imageUrl: {
      type: String,
      default: null,
    },

    // For messageType === "location"
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
    },

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    // Soft-delete
    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common access patterns
chatMessageSchema.index({ deliveryId: 1, createdAt: -1 });
chatMessageSchema.index({ receiverId: 1, isRead: 1 });
chatMessageSchema.index({ deliveryId: 1, receiverId: 1, isRead: 1 });

// Exclude soft-deleted by default
chatMessageSchema.pre(/^find/, function () {
  if (!this.getOptions().includeDeleted) {
    this.where({ isDeleted: { $ne: true } });
  }
});

// Static helpers (backward-compatible with original controller expectations)
chatMessageSchema.statics.getChatHistory = function (deliveryId, limit = 50) {
  return this.find({ deliveryId })
    .populate("senderId", "name avatarUrl role")
    .populate("receiverId", "name avatarUrl role")
    .sort({ createdAt: -1 })
    .limit(limit)
    .then((msgs) => msgs.reverse());
};

chatMessageSchema.statics.markMessagesAsRead = function (deliveryId, userId) {
  return this.updateMany(
    { deliveryId, receiverId: userId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
};

const ChatMessage = mongoose.models.ChatMessage || mongoose.model("ChatMessage", chatMessageSchema);
export default ChatMessage;