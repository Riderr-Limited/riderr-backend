import mongoose from "mongoose";

/**
 * One document per WhatsApp number that has messaged the business number.
 * Holds the link to the Riderr user plus the bot's conversation state.
 */
const whatsappSessionSchema = new mongoose.Schema(
  {
    // WhatsApp ID as Meta sends it: digits only, with country code (e.g. 2348031234567)
    phone: { type: String, required: true, unique: true },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    profileName: { type: String, default: null },

    // Current step of the conversation ("idle" when no flow is in progress)
    state: { type: String, default: "idle" },

    // Scratch data for the current flow (booking details, pending choices...)
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // User can reply STOP to stop receiving delivery updates on WhatsApp
    optIn: { type: Boolean, default: true },

    // Free-form messages can only be sent within 24h of the user's last message
    lastInboundAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

export default mongoose.models.WhatsAppSession ||
  mongoose.model("WhatsAppSession", whatsappSessionSchema);
