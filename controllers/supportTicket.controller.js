import SupportTicket from "../models/supportTicket.model.js";
import { validationResult } from "express-validator";

function generateTicketId() {
  return "TKT-" + Math.random().toString(36).substr(2, 5).toUpperCase();
}

export const createSupportTicket = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { issueType, title, description } = req.body;
    const userId = req.user && req.user._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const ticket = await SupportTicket.create({
      user: userId,
      issueType,
      title,
      description,
      ticketId: generateTicketId(),
    });

    return res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    console.error("Support ticket creation error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
