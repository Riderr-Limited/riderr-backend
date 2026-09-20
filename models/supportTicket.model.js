import mongoose from "mongoose";

const { Schema, model } = mongoose;

const issueTypes = [
  "payment issues",
  "delivery problems",
  "app technical issues",
  "account problems",
  "safety concerns",
  "other",
];

const statusTypes = ["open", "in-progress", "resolved"];

const SupportTicketSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    issueType: { type: String, enum: issueTypes, required: true },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, minlength: 20 },
    status: { type: String, enum: statusTypes, default: "open" },
    ticketId: { type: String, unique: true, required: true },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    internalNotes: { type: String, default: "" },

    // Kept for backward compatibility with the admin dashboard's single
    // "response" field; new replies should go through `messages` below.
    response: { type: String, default: null },
    respondedAt: { type: Date, default: null },
    respondedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // The actual back-and-forth thread between the ticket owner and admin.
    messages: [
      {
        senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        senderRole: { type: String, default: "customer" },
        message: { type: String, required: true, maxlength: 2000 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export default model("SupportTicket", SupportTicketSchema);
