import SupportTicket from "../models/supportTicket.model.js";
import { validationResult } from "express-validator";
import { sendNotification, NotificationTemplates } from "../utils/notification.js";
import User from "../models/user.models.js";

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

    // Notify user their ticket was created
    await sendNotification({
      userId,
      ...NotificationTemplates.SUPPORT_TICKET_CREATED(ticket.ticketId),
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
    const isAdmin = req.user.role === "admin";
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
    const isAdmin = req.user.role === "admin";

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
    const isAdmin = req.user.role === "admin";

    const ticket = await SupportTicket.findOne({ ticketId }).populate(
      "messages.senderId",
      "name email role"
    );
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    if (!isAdmin && ticket.user.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    return res.status(200).json({ success: true, data: ticket.messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const sendTicketMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    const userId = req.user._id;
    const isAdmin = req.user.role === "admin";

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const ticket = await SupportTicket.findOne({ ticketId });
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    if (!isAdmin && ticket.user.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const newMessage = {
      senderId: userId,
      senderRole: req.user.role,
      message: message.trim(),
      createdAt: new Date(),
    };
    ticket.messages.push(newMessage);
    await ticket.save();

    // Notify the other party: admin sent a reply -> notify ticket owner;
    // ticket owner sent a message -> notify every admin.
    if (isAdmin) {
      await sendNotification({
        userId: ticket.user,
        ...NotificationTemplates.SUPPORT_NEW_MESSAGE(ticket.ticketId, req.user.name),
      });
    } else {
      const admins = await User.find({ role: "admin", isActive: true, isDeleted: false }).select("_id");
      await Promise.all(
        admins.map((admin) =>
          sendNotification({
            userId: admin._id,
            ...NotificationTemplates.SUPPORT_NEW_MESSAGE(ticket.ticketId, req.user.name),
          })
        )
      );
    }

    return res.status(201).json({
      success: true,
      data: ticket.messages[ticket.messages.length - 1],
    });
  } catch (error) {
    console.error("Send ticket message error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;
    const isAdmin = req.user.role === "admin";

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

    // Notify the ticket owner of status change
    await sendNotification({
      userId: ticket.user._id,
      ...NotificationTemplates.SUPPORT_TICKET_UPDATED(ticket.ticketId, status),
    });

    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    console.error("Update ticket error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
