import AdminChat from "../models/adminChat.model.js";
import User from "../models/user.models.js";
import mongoose from "mongoose";

/**
 * @desc  Get messages between current user and admin (user-facing)
 * @route GET /api/admin-chat/messages
 * @access Private (any authenticated user)
 */
export const getMessages = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 50, page = 1, before } = req.query;

    const query = { userId };
    // cursor-based pagination: fetch messages older than a given message id
    if (before && mongoose.Types.ObjectId.isValid(before)) {
      query._id = { $lt: new mongoose.Types.ObjectId(before) };
    }

    const messages = await AdminChat.find(query)
      .populate("senderId", "name email role avatarUrl")
      .sort({ createdAt: -1 }) // newest first so limit works correctly
      .limit(parseInt(limit))
      .then((msgs) => msgs.reverse()); // return in chronological order

    // Mark all unread admin messages as read
    await AdminChat.updateMany(
      { userId, isAdminMessage: true, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    // Emit read-receipt to admins via Socket.IO
    const io = req.app.get("io");
    if (io) {
      io.to("admins").emit("messages_read", {
        userId: userId.toString(),
        readAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Get messages for a specific user (admin-facing)
 * @route GET /api/admin-chat/users/:userId/messages
 * @access Private (Admin only)
 */
export const getUserMessages = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access only" });
    }

    const { userId } = req.params;
    const { limit = 50, before } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid userId" });
    }

    // Verify user exists
    const userExists = await User.findById(userId).select("name email role");
    if (!userExists) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const query = { userId };
    if (before && mongoose.Types.ObjectId.isValid(before)) {
      query._id = { $lt: new mongoose.Types.ObjectId(before) };
    }

    const messages = await AdminChat.find(query)
      .populate("senderId", "name email role avatarUrl")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .then((msgs) => msgs.reverse());

    // Mark all unread user messages as read (from admin's perspective)
    await AdminChat.updateMany(
      { userId, isAdminMessage: false, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    // Emit read-receipt to the user
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${userId}`).emit("admin_read_messages", {
        readAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      data: messages,
      user: userExists,
      pagination: {
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get user messages error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Send a message (user → admin OR admin → user)
 * @route POST /api/admin-chat/messages
 * @access Private (any authenticated user)
 */
export const sendMessage = async (req, res) => {
  try {
    const { message, userId: targetUserId, messageType = "text", imageUrl } = req.body;
    const senderId = req.user._id;
    const isAdmin = req.user.role === "admin";

    // Validate message
    if (!message || message.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Message content is required" });
    }

    // Determine the userId (conversation owner = the non-admin party)
    let userId;
    if (isAdmin) {
      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          message: "userId is required when admin sends a message",
        });
      }
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid userId" });
      }
      const targetExists = await User.findById(targetUserId).select("_id name role");
      if (!targetExists) {
        return res
          .status(404)
          .json({ success: false, message: "Target user not found" });
      }
      userId = targetUserId;
    } else {
      userId = senderId;
    }

    const chatMessage = await AdminChat.create({
      userId,
      senderId,
      message: message.trim(),
      messageType,
      imageUrl: imageUrl || null,
      isAdminMessage: isAdmin,
      isRead: false,
    });

    await chatMessage.populate("senderId", "name email role avatarUrl");

    // Real-time delivery via Socket.IO
    const io = req.app.get("io");
    if (io) {
      const payload = { data: chatMessage };

      if (isAdmin) {
        // Deliver to the target user
        io.to(`user_${userId}`).emit("new_admin_message", payload);
        // Also broadcast to other admin sockets so all admin tabs stay in sync
        io.to("admins").emit("admin_message_sent", {
          ...payload,
          targetUserId: userId,
        });
      } else {
        // Deliver to all connected admins
        io.to("admins").emit("new_user_message", {
          ...payload,
          fromUserId: userId,
        });
        // Echo back to the sender (other devices/tabs)
        io.to(`user_${userId}`).emit("message_echo", payload);
      }
    }

    return res.status(201).json({ success: true, data: chatMessage });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Get unread message count for current user (unread admin messages)
 * @route GET /api/admin-chat/unread-count
 * @access Private (any authenticated user)
 */
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const count = await AdminChat.countDocuments({
      userId,
      isAdminMessage: true,
      isRead: false,
    });

    return res
      .status(200)
      .json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Get all user conversations for the admin inbox
 *        Returns one entry per user with last message, timestamps, unread count,
 *        and full user profile info
 * @route GET /api/admin-chat/conversations
 * @access Private (Admin only)
 */
export const getUserChats = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access only" });
    }

    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Aggregate: one document per userId, carrying the latest message snapshot
    const conversations = await AdminChat.aggregate([
      {
        $sort: { createdAt: -1 }, // process newest first so $first picks latest
      },
      {
        $group: {
          _id: "$userId",
          lastMessage: { $first: "$message" },
          lastMessageTime: { $first: "$createdAt" },
          lastMessageType: { $first: "$messageType" },
          lastIsAdminMessage: { $first: "$isAdminMessage" },
          // Count messages the admin hasn't read yet (user messages that are unread)
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isAdminMessage", false] },
                    { $eq: ["$isRead", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalMessages: { $sum: 1 },
        },
      },
      { $sort: { lastMessageTime: -1 } },
    ]);

    // Extract userIds for lookup
    const userIds = conversations.map((c) => c._id);

    // Build search filter if provided
    const userMatchFilter = { _id: { $in: userIds } };
    if (search) {
      userMatchFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    // Fetch user details in one query
    const users = await User.find(userMatchFilter)
      .select("name email phone role avatarUrl isActive createdAt")
      .lean();

    const userMap = {};
    for (const u of users) {
      userMap[u._id.toString()] = u;
    }

    // Merge conversation data with user profiles
    let enriched = conversations
      .map((conv) => {
        const user = userMap[conv._id.toString()];
        if (!user) return null; // user deleted or filtered by search
        return {
          userId: conv._id,
          user,
          lastMessage: conv.lastMessage,
          lastMessageTime: conv.lastMessageTime,
          lastMessageType: conv.lastMessageType,
          lastIsAdminMessage: conv.lastIsAdminMessage,
          unreadCount: conv.unreadCount,
          totalMessages: conv.totalMessages,
        };
      })
      .filter(Boolean);

    // Apply pagination after filtering
    const total = enriched.length;
    enriched = enriched.slice(skip, skip + parseInt(limit));

    // Total unread count across all conversations
    const totalUnread = await AdminChat.countDocuments({
      isAdminMessage: false,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      data: enriched,
      totalUnread,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
        hasNextPage: parseInt(page) * parseInt(limit) < total,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Get user chats error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Delete a message (soft delete — marks as deleted)
 * @route DELETE /api/admin-chat/messages/:messageId
 * @access Private (Admin or message owner)
 */
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const requesterId = req.user._id;
    const isAdmin = req.user.role === "admin";

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid messageId" });
    }

    const msg = await AdminChat.findById(messageId);
    if (!msg) {
      return res
        .status(404)
        .json({ success: false, message: "Message not found" });
    }

    // Only admin or the original sender can delete
    if (!isAdmin && msg.senderId.toString() !== requesterId.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    msg.isDeleted = true;
    msg.deletedAt = new Date();
    msg.deletedBy = requesterId;
    await msg.save();

    // Notify participants via socket
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${msg.userId}`).emit("message_deleted", { messageId });
      io.to("admins").emit("message_deleted", {
        messageId,
        userId: msg.userId,
      });
    }

    return res
      .status(200)
      .json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    console.error("Delete message error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Mark all messages in a conversation as read (admin marks user messages read)
 * @route PUT /api/admin-chat/users/:userId/mark-read
 * @access Private (Admin only)
 */
export const markConversationRead = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access only" });
    }

    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid userId" });
    }

    const result = await AdminChat.updateMany(
      { userId, isAdminMessage: false, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`user_${userId}`).emit("admin_read_messages", {
        readAt: new Date(),
      });
    }

    return res.status(200).json({
      success: true,
      message: "Conversation marked as read",
      updatedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Mark conversation read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc  Get admin-level unread count (messages from users that admin hasn't read)
 * @route GET /api/admin-chat/admin-unread-count
 * @access Private (Admin only)
 */
export const getAdminUnreadCount = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Admin access only" });
    }

    const totalUnread = await AdminChat.countDocuments({
      isAdminMessage: false,
      isRead: false,
    });

    // Breakdown per user (for badge counts in sidebar)
    const perUser = await AdminChat.aggregate([
      { $match: { isAdminMessage: false, isRead: false } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
    ]);

    return res.status(200).json({
      success: true,
      data: { totalUnread, perUser },
    });
  } catch (error) {
    console.error("Get admin unread count error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};