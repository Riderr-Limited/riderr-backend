import mongoose from "mongoose";

const voiceCallSchema = new mongoose.Schema({
  deliveryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Delivery",
    required: true,
    index: true,
  },
  callId: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  status: {
    type: String,
    enum: ["initiated", "ringing", "answered", "ended", "missed"],
    default: "initiated",
    index: true,
  },
  // Call duration in seconds
  duration: {
    type: Number,
    default: 0,
  },
  initiatedAt: {
    type: Date,
    default: Date.now,
  },
  answeredAt: Date,
  endedAt: Date,
}, {
  timestamps: true,
});

// Index for efficient queries
voiceCallSchema.index({ deliveryId: 1, status: 1 });
voiceCallSchema.index({ caller: 1, createdAt: -1 });
voiceCallSchema.index({ receiver: 1, createdAt: -1 });

const VoiceCall = mongoose.model("VoiceCall", voiceCallSchema);
export default VoiceCall;