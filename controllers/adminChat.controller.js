import AdminChat from "../models/adminChat.model.js";

export const getMessages = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 50 } = req.query;

    const messages = await AdminChat.find({ userId })
      .populate("senderId", "name email role")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .sort({ createdAt: 1 });

    await AdminChat.updateMany(
      { userId, isAdminMessage: true, isRead: false },
      { isRead: true }
    );

    return res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const senderId = req.user._id;
    const isAdmin = req.user.role === "System Admin";

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Message required" });
    }

    const userId = isAdmin ? req.body.userId : senderId;

    if (isAdmin && !req.body.userId) {
      return res.status(400).json({ success: false, message: "userId required for admin" });
    }

    const chatMessage = await AdminChat.create({
      userId,
      senderId,
      message: message.trim(),
      isAdminMessage: isAdmin,
    });

    await chatMessage.populate("senderId", "name email role");

    return res.status(201).json({ success: true, data: chatMessage });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const count = await AdminChat.countDocuments({
      userId,
      isAdminMessage: true,
      isRead: false,
    });

    return res.status(200).json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getUserChats = async (req, res) => {
  try {
    if (req.user.role !== "System Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const users = await AdminChat.aggregate([
      {
        $group: {
          _id: "$userId",
          lastMessage: { $last: "$message" },
          lastMessageTime: { $last: "$createdAt" },
          unreadCount: {
            $sum: { $cond: [{ $and: [{ $eq: ["$isAdminMessage", false] }, { $eq: ["$isRead", false] }] }, 1, 0] },
          },
        },
      },
      { $sort: { lastMessageTime: -1 } },
    ]);

    const populatedUsers = await AdminChat.populate(users, {
      path: "_id",
      select: "name email role",
    });

    return res.status(200).json({ success: true, data: populatedUsers });
  } catch (error) {
    console.error("Get user chats error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
