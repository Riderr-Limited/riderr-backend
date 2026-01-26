import VoiceCall from "../models/voiceCall.model.js";

export const setupVoiceCallSocket = (io) => {
  io.on("connection", (socket) => {
    
    // User joins their room for receiving calls
    socket.on("user:join_voice_room", (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} joined voice room`);
    });

    // WebRTC Signaling - Offer
    socket.on("webrtc:offer", async (data) => {
      try {
        const { callId, offer } = data;
        
        const call = await VoiceCall.findOne({ callId });
        if (!call) return;

        // Update call status to ringing
        call.status = "ringing";
        await call.save();

        // Forward offer to receiver
        socket.to(`user_${call.receiver}`).emit("webrtc:offer", {
          callId,
          offer,
          callerId: call.caller,
        });
      } catch (error) {
        console.error("WebRTC offer error:", error);
      }
    });

    // WebRTC Signaling - Answer
    socket.on("webrtc:answer", async (data) => {
      try {
        const { callId, answer } = data;
        
        const call = await VoiceCall.findOne({ callId });
        if (!call) return;

        // Forward answer to caller
        socket.to(`user_${call.caller}`).emit("webrtc:answer", {
          callId,
          answer,
        });
      } catch (error) {
        console.error("WebRTC answer error:", error);
      }
    });

    // WebRTC Signaling - ICE Candidate
    socket.on("webrtc:ice_candidate", async (data) => {
      try {
        const { callId, candidate, targetUserId } = data;
        
        // Forward ICE candidate to target user
        socket.to(`user_${targetUserId}`).emit("webrtc:ice_candidate", {
          callId,
          candidate,
        });
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
    });

    // Call rejection
    socket.on("call:reject", async (data) => {
      try {
        const { callId } = data;
        
        const call = await VoiceCall.findOne({ callId });
        if (!call) return;

        // Update call status
        call.status = "missed";
        call.endedAt = new Date();
        await call.save();

        // Notify caller
        socket.to(`user_${call.caller}`).emit("call_rejected", {
          callId,
        });
      } catch (error) {
        console.error("Call reject error:", error);
      }
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log("Voice call socket disconnected:", socket.id);
    });
  });
};