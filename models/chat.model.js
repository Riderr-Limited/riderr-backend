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
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
      maxlength: [500, "Message cannot exceed 500 characters"],
    },
    messageType: {
      type: String,
      enum: ["text", "image", "location"],
      default: "text",
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
    // For location sharing
    location: {
      lat: Number,
      lng: Number,
      address: String,
    },
    // For image messages
    imageUrl: String,
  },
  {
    timestamps: true,
  },
);

// Compound indexes for efficient queries
chatMessageSchema.index({ deliveryId: 1, createdAt: -1 });
chatMessageSchema.index({ senderId: 1, receiverId: 1, deliveryId: 1 });
chatMessageSchema.index({ deliveryId: 1, isRead: 1 });

// Instance methods
chatMessageSchema.methods.markAsRead = function () {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Static methods
chatMessageSchema.statics.getChatHistory = function (deliveryId, limit = 50) {
  return this.find({ deliveryId })
    .populate("senderId", "name avatarUrl role")
    .populate("receiverId", "name avatarUrl role")
    .sort({ createdAt: -1 })
    .limit(limit)
    .sort({ createdAt: 1 }); // Re-sort for chronological order
};

chatMessageSchema.statics.markMessagesAsRead = function (deliveryId, userId) {
  return this.updateMany(
    { deliveryId, receiverId: userId, isRead: false },
    { isRead: true, readAt: new Date() },
  );
};

const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

export default ChatMessage;
