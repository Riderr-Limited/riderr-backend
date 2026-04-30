import VoiceCall from "../models/voiceCall.model.js";

export const setupVoiceCallSocket = (io) => {
  io.on("connection", (socket) => {
    // Auto-join user room from handshake auth so the room is always available
    const userId =
      socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userId) {
      socket.join(`user_${userId}`);
    }

    // Keep manual join as fallback
    socket.on("user:join_voice_room", (uid) => {
      socket.join(`user_${uid}`);
    });

    socket.on("call:reject", async ({ callId }) => {
      try {
        const call = await VoiceCall.findOne({ callId });
        if (!call) return;

        call.status = "missed";
        call.endedAt = new Date();
        await call.save();

        socket.to(`user_${call.caller}`).emit("call_rejected", { callId });
      } catch (error) {
        console.error("Call reject error:", error);
      }
    });
  });
};
