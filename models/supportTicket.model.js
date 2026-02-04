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
  },
  { timestamps: true },
);

export default model("SupportTicket", SupportTicketSchema);
