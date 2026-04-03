import mongoose from "mongoose";

const adminChatSchema = new mongoose.Schema(
  {
    // The non-admin party — the "owner" of this conversation thread
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Who actually typed and sent this message
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    messageType: {
      type: String,
      enum: ["text", "image", "file", "system"],
      default: "text",
    },

    imageUrl: {
      type: String,
      default: null,
    },

    // true  → sent by admin TO the user
    // false → sent by user TO admin
    isAdminMessage: {
      type: Boolean,
      required: true,
      index: true,
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

    // Soft-delete support
    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
  }
);

// Compound indexes for the most common query patterns
adminChatSchema.index({ userId: 1, createdAt: -1 });
adminChatSchema.index({ userId: 1, isAdminMessage: 1, isRead: 1 });
adminChatSchema.index({ isAdminMessage: 1, isRead: 1 }); // for admin global unread count

// Hide soft-deleted messages from all queries by default
adminChatSchema.pre(/^find/, function () {
  if (!this.getOptions().includeDeleted) {
    this.where({ isDeleted: { $ne: true } });
  }
});

const AdminChat = mongoose.model("AdminChat", adminChatSchema);
export default AdminChat;