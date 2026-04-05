# Voice Call Integration Guide
> For Customer & Driver apps — Delivery context

---

## How It Works (Overview)

```
CUSTOMER                        SERVER                          DRIVER
   |                               |                               |
   |-- POST /initiate-call ------->|                               |
   |<-- { callId, receiverId } ----|                               |
   |                               |-- socket: incoming_call ----->|
   |-- socket: webrtc:offer ------>|-- forward offer ------------->|
   |                               |<-- socket: webrtc:answer -----|
   |<-- forward answer ------------|                               |
   |<----------- ICE candidates exchange ------------------------->|
   |                               |                               |
   |         [ CALL CONNECTED - AUDIO FLOWING ]                    |
   |                               |                               |
   |-- POST /end-call ------------>|                               |
   |                               |-- socket: call_ended -------->|
```

---

## Step 1 — Setup (Both Apps, on Login)

Install for React Native:
```bash
npm install react-native-webrtc socket.io-client
```

Connect socket and initialize VoiceCallManager immediately after login:

```js
import io from 'socket.io-client';
import VoiceCallManager from './utils/VoiceCallManager';

// Do this once after login, store globally (context, redux, etc.)
const socket = io('https://your-api-domain.com', {
  auth: { token: userToken },        // optional but recommended
  transports: ['websocket'],
});

const voiceManager = new VoiceCallManager(socket, currentUser._id);

// Override the token getter
voiceManager.getToken = () => userToken;
```

> Both customer and driver must do this. The manager auto-joins the user's socket room on init.

---

## Step 2 — Making a Call (Caller Side)

Either customer or driver can initiate. Use the `deliveryId` from the active delivery.

```js
const startCall = async (deliveryId) => {
  try {
    // 1. Register the call on the server
    const res = await fetch(`https://your-api-domain.com/api/voice-call/deliveries/${deliveryId}/voice-call`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
    });

    const json = await res.json();

    if (!json.success) {
      // Handle: "Call already in progress" or "Access denied"
      alert(json.message);
      return;
    }

    const { callId, receiver } = json.data;

    // 2. Start WebRTC — pass callId and receiverId
    await voiceManager.initiateCall(deliveryId, callId, receiver);

    // UI: show "Calling..." screen

  } catch (err) {
    console.error('Failed to start call', err);
  }
};
```

---

## Step 3 — Receiving a Call (Receiver Side)

The receiver gets a socket event. Wire up the handler once after login:

```js
voiceManager.onIncomingCall = (data) => {
  // data = { callId, deliveryId, caller: { id, name, avatarUrl } }

  // Show incoming call UI — ringing screen
  showIncomingCallScreen({
    callId: data.callId,
    callerName: data.caller.name,
    callerAvatar: data.caller.avatarUrl,
    deliveryId: data.deliveryId,
  });
};
```

---

## Step 4 — Answering a Call (Receiver Side)

When the user taps "Accept":

```js
const acceptCall = async (callId) => {
  await voiceManager.answerCall(callId);
  // UI: switch to active call screen
};
```

When the user taps "Decline":

```js
const declineCall = (callId) => {
  voiceManager.rejectCall(callId);
  // UI: dismiss incoming call screen
};
```

---

## Step 5 — During the Call

When audio connection is established, you get the remote audio stream:

```js
voiceManager.onRemoteStreamReceived = (remoteStream) => {
  // React Native — attach to RTCView or MediaStream
  // Web — attach to an <audio> element

  // React Native example:
  setRemoteStream(remoteStream);   // store in state, use in <RTCView>

  // Web example:
  const audioEl = document.getElementById('remote-audio');
  audioEl.srcObject = remoteStream;
  audioEl.play();
};
```

Track call state changes for UI updates:

```js
voiceManager.onCallStateChanged = (state) => {
  // state values:
  // 'calling'   — outgoing call placed, waiting for answer
  // 'answered'  — other party answered
  // 'connected' — WebRTC audio connected
  // 'ended'     — call ended normally
  // 'rejected'  — receiver declined
  // 'missed'    — no answer / cancelled

  switch (state) {
    case 'calling':    showCallingScreen(); break;
    case 'connected':  showActiveCallScreen(); break;
    case 'ended':      showCallEndedScreen(); break;
    case 'rejected':   showCallDeclinedScreen(); break;
  }
};
```

---

## Step 6 — Ending a Call (Either Side)

```js
const hangUp = async () => {
  await voiceManager.endCall();
  // UI: go back to delivery screen
};
```

The other party automatically receives a `call_ended` socket event and their `onCallStateChanged('ended')` fires.

---

## Step 7 — Handle Errors

```js
voiceManager.onCallError = (errorMessage) => {
  // errorMessage is a string like 'Failed to start call'
  alert(errorMessage);
  // UI: reset to idle state
};
```

---

## All Socket Events Reference

### Events your app RECEIVES (server → client)

| Event | When | Payload |
|-------|------|---------|
| `incoming_voice_call` | Someone calls you | `{ callId, deliveryId, caller: { id, name, avatarUrl } }` |
| `call_answered` | Receiver accepted | `{ callId, answeredBy }` |
| `call_ended` | Other party hung up | `{ callId, endedBy, duration }` |
| `call_rejected` | Receiver declined | `{ callId }` |
| `webrtc:offer` | WebRTC offer from caller | `{ callId, offer, callerId }` |
| `webrtc:answer` | WebRTC answer from receiver | `{ callId, answer }` |
| `webrtc:ice_candidate` | ICE candidate exchange | `{ callId, candidate }` |

### Events your app SENDS (client → server)

| Event | When | Payload |
|-------|------|---------|
| `user:join_voice_room` | On login/init | `userId` (string) |
| `webrtc:offer` | After initiating call | `{ callId, offer }` |
| `webrtc:answer` | After receiving offer | `{ callId, answer }` |
| `webrtc:ice_candidate` | During connection setup | `{ callId, candidate, targetUserId }` |
| `call:reject` | User declines call | `{ callId }` |

> VoiceCallManager handles all of these automatically. You only need the hooks above.

---

## All REST API Endpoints

Base URL: `https://your-api-domain.com/api/voice-call`

All endpoints require: `Authorization: Bearer <token>`

| Method | Endpoint | Who calls it | Description |
|--------|----------|-------------|-------------|
| `POST` | `/deliveries/:deliveryId/voice-call` | Caller | Start a call |
| `POST` | `/voice-calls/:callId/answer` | Receiver | Accept a call |
| `POST` | `/voice-calls/:callId/end` | Either | End/hang up |
| `GET` | `/deliveries/:deliveryId/call-history` | Either | Past calls list |

### POST `/deliveries/:deliveryId/voice-call`
Response:
```json
{
  "success": true,
  "data": {
    "callId": "CALL-1234567890-ab12cd34",
    "status": "initiated",
    "receiver": "64f1a2b3c4d5e6f7a8b9c0d1"
  }
}
```

### POST `/voice-calls/:callId/answer`
Response:
```json
{
  "success": true,
  "data": {
    "callId": "CALL-1234567890-ab12cd34",
    "status": "answered"
  }
}
```

### POST `/voice-calls/:callId/end`
Response:
```json
{
  "success": true,
  "data": {
    "callId": "CALL-1234567890-ab12cd34",
    "status": "ended",
    "duration": 142
  }
}
```
`duration` is in seconds. If call was never answered, `status` is `"missed"` and `duration` is `0`.

### GET `/deliveries/:deliveryId/call-history`
Response:
```json
{
  "success": true,
  "data": [
    {
      "callId": "CALL-1234567890-ab12cd34",
      "status": "ended",
      "duration": 142,
      "caller": { "_id": "...", "name": "John", "avatarUrl": "..." },
      "receiver": { "_id": "...", "name": "Driver A", "avatarUrl": "..." },
      "initiatedAt": "2024-01-15T10:30:00.000Z",
      "answeredAt": "2024-01-15T10:30:08.000Z",
      "endedAt": "2024-01-15T10:32:30.000Z"
    }
  ]
}
```

---

## Call Status Values

| Status | Meaning |
|--------|---------|
| `initiated` | Call created, notification sent to receiver |
| `ringing` | WebRTC offer sent, receiver's phone is ringing |
| `answered` | Receiver accepted |
| `ended` | Call completed normally |
| `missed` | Caller hung up before answer, or receiver declined |

---

## React Native — Full Minimal Example

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import io from 'socket.io-client';
import VoiceCallManager from './utils/VoiceCallManager';

const API = 'https://your-api-domain.com';

export default function DeliveryScreen({ deliveryId, currentUser, token }) {
  const voiceManager = useRef(null);
  const [callState, setCallState] = useState('idle'); // idle | calling | ringing | active | ended
  const [incomingCall, setIncomingCall] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  useEffect(() => {
    const socket = io(API, { transports: ['websocket'] });

    voiceManager.current = new VoiceCallManager(socket, currentUser._id);
    voiceManager.current.getToken = () => token;

    voiceManager.current.onIncomingCall = (data) => {
      setIncomingCall(data);
      setCallState('ringing');
    };

    voiceManager.current.onCallStateChanged = (state) => {
      setCallState(state === 'connected' ? 'active' : state);
      if (state === 'ended' || state === 'rejected') {
        setIncomingCall(null);
        setRemoteStream(null);
      }
    };

    voiceManager.current.onRemoteStreamReceived = (stream) => {
      setRemoteStream(stream);
    };

    voiceManager.current.onCallError = (msg) => {
      alert(msg);
      setCallState('idle');
    };

    return () => socket.disconnect();
  }, []);

  const handleStartCall = async () => {
    setCallState('calling');
    const res = await fetch(`${API}/api/voice-call/deliveries/${deliveryId}/voice-call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.success) { alert(json.message); setCallState('idle'); return; }
    const { callId, receiver } = json.data;
    await voiceManager.current.initiateCall(deliveryId, callId, receiver);
  };

  const handleAccept = async () => {
    await voiceManager.current.answerCall(incomingCall.callId);
    setCallState('active');
  };

  const handleDecline = () => {
    voiceManager.current.rejectCall(incomingCall.callId);
    setIncomingCall(null);
    setCallState('idle');
  };

  const handleHangUp = async () => {
    await voiceManager.current.endCall();
    setCallState('idle');
  };

  if (callState === 'ringing' && incomingCall) {
    return (
      <View>
        <Text>Incoming call from {incomingCall.caller.name}</Text>
        <TouchableOpacity onPress={handleAccept}><Text>Accept</Text></TouchableOpacity>
        <TouchableOpacity onPress={handleDecline}><Text>Decline</Text></TouchableOpacity>
      </View>
    );
  }

  if (callState === 'active') {
    return (
      <View>
        <Text>Call Active</Text>
        {remoteStream && <RTCView streamURL={remoteStream.toURL()} />}
        <TouchableOpacity onPress={handleHangUp}><Text>Hang Up</Text></TouchableOpacity>
      </View>
    );
  }

  if (callState === 'calling') {
    return (
      <View>
        <Text>Calling...</Text>
        <TouchableOpacity onPress={handleHangUp}><Text>Cancel</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <Text>Delivery #{deliveryId}</Text>
      <TouchableOpacity onPress={handleStartCall}><Text>📞 Call</Text></TouchableOpacity>
    </View>
  );
}
```

---

## Important Notes

- Both customer and driver must have an active socket connection for calls to work
- `user:join_voice_room` is emitted automatically by `VoiceCallManager` on init — no manual call needed
- Only one active call per delivery is allowed at a time — server returns `400` if a call is already in progress
- If the caller hangs up before the receiver answers, status becomes `missed`
- Microphone permission must be requested before calling — handle `getUserMedia` errors in `onCallError`
- For production, add TURN servers to `getWebRTCConfig()` for users on mobile networks (STUN alone fails on many carriers)
