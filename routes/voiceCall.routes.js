import express from "express";
import {
  initiateVoiceCall,
  answerVoiceCall,
  endVoiceCall,
  getCallHistory,
} from "../controllers/voiceCall.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.post("/deliveries/:deliveryId/voice-call", initiateVoiceCall);
router.post("/rides/:rideId/voice-call", initiateVoiceCall);
router.post("/voice-calls/:callId/answer", answerVoiceCall);
router.post("/voice-calls/:callId/end", endVoiceCall);
router.get("/deliveries/:deliveryId/call-history", getCallHistory);

export default router;
