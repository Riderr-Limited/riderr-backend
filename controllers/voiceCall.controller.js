import VoiceCall from "../models/voiceCall.model.js";
import Delivery from "../models/delivery.models.js";
import User from "../models/user.models.js";
import crypto from "crypto";

/**
 * Initiate voice call
 */
export const initiateVoiceCall = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const callerId = req.user._id;

    // Get delivery and verify access
    const delivery = await Delivery.findById(deliveryId)
      .populate("driverId", "userId")
      .select("customerId driverId status");

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Verify user is part of this delivery
    const isCustomer = delivery.customerId.toString() === callerId.toString();
    const isDriver = delivery.driverId?.userId?.toString() === callerId.toString();

    if (!isCustomer && !isDriver) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Determine receiver
    const receiverId = isCustomer 
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

    // Get caller info for notification
    const caller = await User.findById(callerId).select("name avatarUrl");

    res.status(201).json({
      success: true,
      data: {
        callId,
        status: "initiated",
        receiver: receiverId,
      },
    });

    // Emit to receiver via Socket.IO (handled in socket file)
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${receiverId}`).emit("incoming_voice_call", {
        callId,
        deliveryId,
        caller: {
          id: callerId,
          name: caller.name,
          avatarUrl: caller.avatarUrl,
        },
      });
    }
  } catch (error) {
    console.error("Initiate voice call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initiate call",
    });
  }
};

/**
 * Answer voice call
 */
export const answerVoiceCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user._id;

    const call = await VoiceCall.findOne({
      callId,
      receiver: userId,
      status: { $in: ["initiated", "ringing"] },
    });

    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found or cannot be answered",
      });
    }

    // Update call status
    call.status = "answered";
    call.answeredAt = new Date();
    await call.save();

    res.json({
      success: true,
      data: {
        callId,
        status: "answered",
      },
    });

    // Notify caller via Socket.IO
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${call.caller}`).emit("call_answered", {
        callId,
        answeredBy: userId,
      });
    }
  } catch (error) {
    console.error("Answer voice call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to answer call",
    });
  }
};

/**
 * End voice call
 */
export const endVoiceCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user._id;

    const call = await VoiceCall.findOne({
      callId,
      $or: [{ caller: userId }, { receiver: userId }],
      status: { $in: ["initiated", "ringing", "answered"] },
    });

    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found",
      });
    }

    // Calculate duration if call was answered
    const endTime = new Date();
    const duration = call.answeredAt 
      ? Math.floor((endTime - call.answeredAt) / 1000)
      : 0;

    // Update call record
    call.status = call.answeredAt ? "ended" : "missed";
    call.endedAt = endTime;
    call.duration = duration;
    await call.save();

    res.json({
      success: true,
      data: {
        callId,
        status: call.status,
        duration,
      },
    });

    // Notify other party via Socket.IO
    const otherUserId = call.caller.toString() === userId.toString() 
      ? call.receiver 
      : call.caller;

    const io = req.app.get("io");
    if (io) {
      io.to(`user_${otherUserId}`).emit("call_ended", {
        callId,
        endedBy: userId,
        duration,
      });
    }
  } catch (error) {
    console.error("End voice call error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to end call",
    });
  }
};

/**
 * Get call history for delivery
 */
export const getCallHistory = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const userId = req.user._id;

    // Verify access to delivery
    const delivery = await Delivery.findById(deliveryId)
      .populate("driverId", "userId")
      .select("customerId driverId");

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const isCustomer = delivery.customerId.toString() === userId.toString();
    const isDriver = delivery.driverId?.userId?.toString() === userId.toString();

    if (!isCustomer && !isDriver) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get call history
    const calls = await VoiceCall.find({ deliveryId })
      .populate("caller", "name avatarUrl")
      .populate("receiver", "name avatarUrl")
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      data: calls,
    });
  } catch (error) {
    console.error("Get call history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get call history",
    });
  }
};