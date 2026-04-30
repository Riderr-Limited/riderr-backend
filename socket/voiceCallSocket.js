import VoiceCall from "../models/voiceCall.model.js";

export const setupVoiceCallSocket = (io) => {
  io.on("connection", (socket) => {
    socket.on("user:join_voice_room", (userId) => {
      socket.join(`user_${userId}`);
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
