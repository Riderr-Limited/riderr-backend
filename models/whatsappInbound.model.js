import mongoose from "mongoose";

/**
 * Meta retries webhook deliveries, so the same message can arrive more than
 * once. Each processed message ID is recorded here (and expires after 2 days)
 * so a retry is never handled twice, e.g. booking the same delivery twice.
 */
const whatsappInboundSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 48 },
});

export default mongoose.models.WhatsAppInbound ||
  mongoose.model("WhatsAppInbound", whatsappInboundSchema);
