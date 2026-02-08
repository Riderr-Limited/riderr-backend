import jwt from "jsonwebtoken";
import ChatMessage from "../models/chatMessage.model.js";
import User from "../models/user.models.js";

export default function supportSocket(io) {
  const nsp = io.of("/support");

  nsp.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  nsp.on("connection", (socket) => {
    // Join chat room
    socket.on("join_chat", async ({ ticketId }, cb) => {
      try {
        const userId = socket.user.userId;
        const user = await User.findById(userId);
        if (!user) return cb && cb({ error: "User not found" });
        if (!ticketId) return cb && cb({ error: "Ticket ID required" });
        socket.join(ticketId);
        if (cb) cb({ success: true });
      } catch (err) {
        if (cb) cb({ error: "Join failed" });
      }
    });

    // System Admin joins any user's room
    socket.on("agent_join", async ({ ticketId }, cb) => {
      try {
        const user = await User.findById(socket.user.userId);
        if (!user || user.role !== "System Admin")
          return cb && cb({ error: "Unauthorized" });
        if (!ticketId) return cb && cb({ error: "Ticket ID required" });
        socket.join(ticketId);
        if (cb) cb({ success: true });
      } catch (err) {
        if (cb) cb({ error: "Agent join failed" });
      }
    });

    // Send message
    socket.on("send_message", async (msg, cb) => {
      try {
        const { senderId, text, timestamp, ticketId } = msg;
        if (!senderId || !text || !ticketId)
          return cb && cb({ error: "Invalid message" });
        const message = await ChatMessage.create({
          senderId,
          text,
          timestamp,
          ticketId,
        });
        nsp.to(ticketId).emit("receive_message", message);
        if (cb) cb({ success: true, message });
      } catch (err) {
        if (cb) cb({ error: "Send failed" });
      }
    });
  });
}
