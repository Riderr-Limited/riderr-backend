import express from "express";
import {
  initiateVoiceCall,
  answerVoiceCall,
  endVoiceCall,
  getCallHistory,
  sendSignalingMessage,
  getSignalingMessages,
} from "../controllers/voiceCall.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Voice call routes
router.post("/deliveries/:deliveryId/voice-call", initiateVoiceCall);
router.post("/voice-calls/:callId/answer", answerVoiceCall);
router.post("/voice-calls/:callId/end", endVoiceCall);
router.get("/deliveries/:deliveryId/call-history", getCallHistory);

// WebRTC signaling routes
router.post("/signaling/:callId", sendSignalingMessage);
router.get("/signaling/:callId", getSignalingMessages);

export default router;