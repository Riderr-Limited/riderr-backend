import mongoose from "mongoose";

const { Schema } = mongoose;

const ChatMessageSchema = new Schema(
  {
    ticketId: { type: String, required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

 const ChatMessage = mongoose.models.ChatMessage || mongoose.model("ChatMessage", ChatMessageSchema);

export default ChatMessage;