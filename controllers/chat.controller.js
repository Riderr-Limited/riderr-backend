import ChatMessage from "../models/chat.model.js";
import VoiceCall from "../models/voiceCall.model.js";
import { validationResult } from "express-validator";
import crypto from "crypto";

/**
 * Get chat history for a delivery
 */
export const getChatHistory = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const messages = await ChatMessage.getChatHistory(
      deliveryId,
      parseInt(limit),
    );

    // Mark messages as read for current user
    await ChatMessage.markMessagesAsRead(deliveryId, req.user._id);

    res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get chat history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get chat history",
    });
  }
};

/**
 * Send a message in delivery chat
 */
export const sendMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { deliveryId } = req.params;
    const { message, messageType = "text", location, imageUrl } = req.body;
    const senderId = req.user._id;

    // Determine receiver based on sender role
    const delivery = req.delivery;
    const receiverId = req.isCustomer
      ? delivery.driverId.userId
      : delivery.customerId;

    const chatMessage = new ChatMessage({
      deliveryId,
      senderId,
      receiverId,
      message,
      messageType,
      location,
      imageUrl,
    });

    await chatMessage.save();

    // Populate sender info for response
    await chatMessage.populate("senderId", "name avatarUrl role");

    res.status(201).json({
      success: true,
      data: chatMessage,
      message: "Message sent successfully",
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message",
    });
  }
};

/**
 * Mark messages as read
 */
export const markMessagesAsRead = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const userId = req.user._id;

    const result = await ChatMessage.markMessagesAsRead(deliveryId, userId);

    res.status(200).json({
      success: true,
      message: "Messages marked as read",
      updatedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Mark messages as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark messages as read",
    });
  }
};

/**
 * Get unread message count for user
 */
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const Delivery = (await import("../models/delivery.models.js")).default;

    // Get deliveries where user is customer or driver
    const deliveries = await Delivery.find({
      $or: [{ customerId: userId }, { driverId: { $exists: true } }],
    }).select("_id");

    const deliveryIds = deliveries.map((d) => d._id);

    const unreadCount = await ChatMessage.countDocuments({
      deliveryId: { $in: deliveryIds },
      receiverId: userId,
      isRead: false,
    });

    res.status(200).json({
      success: true,
      data: { unreadCount },
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
    });
  }
};

/**
 * Initiate voice call from chat
 */
export const initiateVoiceCallFromChat = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const callerId = req.user._id;

    // Verify delivery access (reuse existing middleware logic)
    const delivery = req.delivery;
    const receiverId = req.isCustomer
      ? delivery.driverId.userId
      : delivery.customerId;

    // Check for existing active call
    const existingCall = await VoiceCall.findOne({
      deliveryId,
      status: { $in: ["initiated", "ringing", "answered"] },
    });

    if (existingCall) {
      return res.status(400).json({
        success: false,
        message: "Call already in progress",
      });
    }

    // Create call record
    const callId = `CALL-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const voiceCall = new VoiceCall({
      deliveryId,
      callId,
      caller: callerId,
      receiver: receiverId,
      status: "initiated",
    });

    await voiceCall.save();

    res.status(201).json({
      success: true,
      data: {
        callId,
        status: "initiated",
        receiver: receiverId,
      },
    });

    // Emit to receiver via Socket.IO
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${receiverId}`).emit("incoming_voice_call", {
        callId,
        deliveryId,
        caller: {
          id: callerId,
          name: req.user.name,
          avatarUrl: req.user.avatarUrl,
        },
      });
    }
  } catch (error) {
    console.error("Initiate voice call from chat error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate call",
    });
  }
};
