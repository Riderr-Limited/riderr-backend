import SupportTicket from "../models/supportTicket.model.js";
import ChatMessage from "../models/chatMessage.model.js";
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

export const getTickets = async (req, res) => {
  try {
    const userId = req.user._id;
    const isAdmin = req.user.role === "System Admin";
    const { status } = req.query;

    const query = isAdmin ? {} : { user: userId };
    if (status) query.status = status;

    const tickets = await SupportTicket.find(query)
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: tickets });
  } catch (error) {
    console.error("Get tickets error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;
    const isAdmin = req.user.role === "System Admin";

    const ticket = await SupportTicket.findOne({ ticketId }).populate(
      "user",
      "name email"
    );

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    if (!isAdmin && ticket.user._id.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    console.error("Get ticket error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTicketMessages = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user._id;
    const isAdmin = req.user.role === "System Admin";

    const ticket = await SupportTicket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    if (!isAdmin && ticket.user.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const messages = await ChatMessage.find({ ticketId })
      .populate("senderId", "name email")
      .sort({ timestamp: 1 });

    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;
    const isAdmin = req.user.role === "System Admin";

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    if (!status || !["open", "in-progress", "resolved"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const ticket = await SupportTicket.findOneAndUpdate(
      { ticketId },
      { status },
      { new: true }
    ).populate("user", "name email");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    console.error("Update ticket error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
