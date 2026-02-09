import jwt from "jsonwebtoken";
import AdminChat from "../models/adminChat.model.js";
import User from "../models/user.models.js";

export default function adminChatSocket(io) {
  const nsp = io.of("/admin-chat");

  nsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  nsp.on("connection", (socket) => {
    const userId = socket.user.userId;
    socket.join(`user_${userId}`);

    socket.on("send_message", async (data, cb) => {
      try {
        const { message, userId: targetUserId } = data;
        const senderId = socket.user.userId;
        const user = await User.findById(senderId);

        if (!user) return cb && cb({ error: "User not found" });
        if (!message) return cb && cb({ error: "Message required" });

        const isAdmin = user.role === "System Admin";
        const chatUserId = isAdmin ? targetUserId : senderId;

        if (isAdmin && !targetUserId) {
          return cb && cb({ error: "userId required for admin" });
        }

        const chatMessage = await AdminChat.create({
          userId: chatUserId,
          senderId,
          message,
          isAdminMessage: isAdmin,
        });

        await chatMessage.populate("senderId", "name email role");

        nsp.to(`user_${chatUserId}`).emit("receive_message", chatMessage);
        if (isAdmin) {
          nsp.to(`user_${senderId}`).emit("receive_message", chatMessage);
        }

        if (cb) cb({ success: true, data: chatMessage });
      } catch (err) {
        console.error("Send message error:", err);
        if (cb) cb({ error: "Send failed" });
      }
    });

    socket.on("mark_read", async (data, cb) => {
      try {
        const userId = socket.user.userId;
        await AdminChat.updateMany(
          { userId, isAdminMessage: true, isRead: false },
          { isRead: true }
        );
        if (cb) cb({ success: true });
      } catch (err) {
        if (cb) cb({ error: "Failed to mark as read" });
      }
    });
  });
}
