// ─── PATCH for admin.controller.js ────────────────────────────────────────────
//
// Replace the top-level ChatMessage import:
//   import ChatMessage from "../models/chat.model.js";          ← WRONG
// with:
//   import ChatMessage from "../models/chatMessage.model.js";   ← CORRECT
//
// This single change fixes getDeliveryById and getSystemStats which both
// reference ChatMessage.  All other admin controller logic stays the same.
//
// Also replace getDeliveryById with the version below so it returns
// richer call data and consistent field names.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @desc    Get delivery details  (drop-in replacement for admin controller)
 * @route   GET /api/admin/deliveries/:deliveryId
 * @access  Private (Admin)
 */
export const getDeliveryById = async (req, res) => {
  try {
    const { deliveryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid delivery ID" });
    }

    const delivery = await Delivery.findById(deliveryId)
      .populate("customerId", "name email phone avatarUrl")
      .populate({
        path: "driverId",
        populate: {
          path: "userId",
          select: "name phone avatarUrl",
        },
      })
      .populate("companyId", "name logo contactPhone");

    if (!delivery) {
      return res
        .status(404)
        .json({ success: false, message: "Delivery not found" });
    }

    // Fetch all related data in parallel
    const [payment, chatMessages, voiceCalls] = await Promise.all([
      // Payment for this delivery
      Payment.findOne({ deliveryId: delivery._id }).lean(),

      // Full chat history with sender/receiver info
      ChatMessage.find({ deliveryId: delivery._id })
        .populate("senderId", "name avatarUrl role")
        .populate("receiverId", "name avatarUrl role")
        .sort({ createdAt: 1 })
        .lean(),

      // All voice calls with duration and status
      VoiceCall.find({ deliveryId: delivery._id })
        .populate("caller", "name avatarUrl")
        .populate("receiver", "name avatarUrl")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // Compute chat summary
    const chatSummary = {
      totalMessages: chatMessages.length,
      unreadByCustomer: chatMessages.filter(
        (m) =>
          m.receiverId?._id?.toString() ===
            delivery.customerId?._id?.toString() && !m.isRead
      ).length,
      unreadByDriver: chatMessages.filter(
        (m) =>
          m.receiverId?._id?.toString() !==
            delivery.customerId?._id?.toString() && !m.isRead
      ).length,
    };

    // Compute call summary
    const callSummary = {
      totalCalls: voiceCalls.length,
      answeredCalls: voiceCalls.filter((c) => c.status === "answered").length,
      missedCalls: voiceCalls.filter((c) => c.status === "missed").length,
      totalDurationSeconds: voiceCalls.reduce(
        (sum, c) => sum + (c.duration || 0),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      data: {
        delivery,
        payment,
        chatMessages,
        chatSummary,
        voiceCalls,
        callSummary,
      },
    });
  } catch (error) {
    console.error("Get delivery by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get delivery details",
    });
  }
};