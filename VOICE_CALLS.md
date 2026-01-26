# Voice Call Implementation

## Overview
Cross-platform WebRTC voice calling system for customer-driver communication during deliveries.

## API Endpoints

### Initiate Call
```
POST /api/chat/:deliveryId/voice-call
POST /api/voice/deliveries/:deliveryId/voice-call
```

### Answer Call
```
POST /api/voice/voice-calls/:callId/answer
```

### End Call
```
POST /api/voice/voice-calls/:callId/end
```

### Get Call History
```
GET /api/voice/deliveries/:deliveryId/call-history
```

## Socket Events

### Client to Server
- `user:join_voice_room` - Join user's voice room
- `webrtc:offer` - Send WebRTC offer
- `webrtc:answer` - Send WebRTC answer
- `webrtc:ice_candidate` - Send ICE candidate
- `call:reject` - Reject incoming call

### Server to Client
- `incoming_voice_call` - Incoming call notification
- `call_answered` - Call was answered
- `call_ended` - Call was ended
- `call_rejected` - Call was rejected
- `webrtc:offer` - Receive WebRTC offer
- `webrtc:answer` - Receive WebRTC answer
- `webrtc:ice_candidate` - Receive ICE candidate

## Client Usage

### Web (React)
```javascript
import VoiceCallManager from './utils/VoiceCallManager';
import io from 'socket.io-client';

const socket = io('ws://localhost:5000');
const voiceManager = new VoiceCallManager(socket, userId);

// Override event handlers
voiceManager.onIncomingCall = (data) => {
  // Show incoming call UI
  showIncomingCallModal(data);
};

voiceManager.onCallStateChanged = (state) => {
  // Update UI based on call state
  updateCallUI(state);
};

// Initiate call
const startCall = async (deliveryId) => {
  const response = await fetch(`/api/chat/${deliveryId}/voice-call`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const { callId } = await response.json();
  voiceManager.currentCall = { callId, deliveryId };
  await voiceManager.initiateCall(deliveryId);
};
```

### Mobile (React Native)
```javascript
import VoiceCallManager from './utils/VoiceCallManager';
import io from 'socket.io-client';

const socket = io('ws://localhost:5000');
const voiceManager = new VoiceCallManager(socket, userId);

// Same API as web implementation
```

## Database Schema

### VoiceCall Model
```javascript
{
  deliveryId: ObjectId,
  callId: String (unique),
  caller: ObjectId,
  receiver: ObjectId,
  status: 'initiated' | 'ringing' | 'answered' | 'ended' | 'missed',
  duration: Number (seconds),
  initiatedAt: Date,
  answeredAt: Date,
  endedAt: Date
}
```

## Security Features
- JWT authentication required
- Delivery access verification
- User authorization checks
- Call session validation

## Cross-Platform Compatibility
- Web browsers (Chrome, Firefox, Safari, Edge)
- React Native (iOS/Android)
- Automatic WebRTC configuration
- STUN server support for NAT traversal

## Production Considerations
- Add TURN servers for mobile networks
- Implement call quality monitoring
- Add call recording (if required)
- Monitor WebRTC connection stats
- Handle network reconnection