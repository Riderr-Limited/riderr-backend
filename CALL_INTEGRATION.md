# Voice Call Integration — Expo (Customer ↔ Driver)

> Uses **Agora RTC** for audio + **Socket.IO** for call signaling (ring, answer, reject, end).
> The `VoiceCallManager.js` / WebRTC approach is **deprecated** — use this doc only.
---

## 1. Install & Configure

```bash
npx expo install react-native-agora
```

Add to `app.json`:
```json
{
  "expo": {
    "plugins": [
      ["react-native-agora", {
        "microphonePermission": "Allow $(PRODUCT_NAME) to access your microphone for calls."
      }]
    ]
  }
}
```

---

## 2. Environment

The backend needs these set:
```
AGORA_APP_ID=xxxxxxxxxxxxxxxxxxxx
AGORA_APP_CERTIFICATE=xxxxxxxxxxxxxxxxxxxx
```

Your Expo app only needs the `AGORA_APP_ID` — it comes back in every API response so you don't need to hardcode it.

---

## 3. The Hook — `useVoiceCall.js`

Create this once. Both customer and driver screens use the exact same hook.

```js
// hooks/useVoiceCall.js
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
} from 'react-native-agora';

const BASE_URL = 'https://your-api-domain.com/api/voice-call';

export function useVoiceCall({ socket, userId, authToken }) {
  const engine = useRef(null);
  const [callState, setCallState] = useState('idle');
  // idle | calling | ringing | active | ended | rejected
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);

  // ── Init Agora engine once ──────────────────────────────────────────────────
  useEffect(() => {
    const rtc = createAgoraRtcEngine();
    rtc.initialize({ appId: null }); // appId comes from server response
    rtc.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
    rtc.enableAudio();
    rtc.setDefaultAudioRouteToSpeakerphone(false); // earpiece by default

    rtc.addListener('onUserOffline', () => {
      // Remote party left the Agora channel
      _leave(rtc);
      setCallState('ended');
      setActiveCall(null);
      setTimeout(() => setCallState('idle'), 3000);
    });

    engine.current = rtc;
    return () => { rtc.leaveChannel(); rtc.release(); };
  }, []);

  // ── Socket listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // Tell server which room to send your incoming calls to
    socket.emit('user:join_voice_room', userId);

    socket.on('incoming_voice_call', (data) => {
      // data = { callId, deliveryId, rideId, caller: { id, name, avatarUrl }, agora: { appId, channel, token, uid } }
      setIncomingCall(data);
      setCallState('ringing');
    });

    socket.on('call_answered', () => setCallState('active'));

    socket.on('call_ended', () => {
      engine.current?.leaveChannel();
      setCallState('ended');
      setActiveCall(null);
      setIncomingCall(null);
      setTimeout(() => setCallState('idle'), 3000);
    });

    socket.on('call_rejected', () => {
      engine.current?.leaveChannel();
      setCallState('rejected');
      setActiveCall(null);
      setTimeout(() => setCallState('idle'), 2000);
    });

    return () => {
      socket.off('incoming_voice_call');
      socket.off('call_answered');
      socket.off('call_ended');
      socket.off('call_rejected');
    };
  }, [socket, userId]);

  const _join = useCallback((agora) => {
    // Re-initialize with the real appId from server
    engine.current?.initialize({ appId: agora.appId });
    engine.current?.joinChannel(agora.token, agora.channel, agora.uid, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    });
  }, []);

  const _leave = useCallback((rtc) => {
    (rtc || engine.current)?.leaveChannel();
  }, []);

  // ── CALLER: start a call ────────────────────────────────────────────────────
  const startCall = useCallback(async ({ deliveryId, rideId }) => {
    try {
      setCallState('calling');

      const url = deliveryId
        ? `${BASE_URL}/deliveries/${deliveryId}/voice-call`
        : `${BASE_URL}/rides/${rideId}/voice-call`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();

      if (!json.success) {
        setCallState('idle');
        return { error: json.message };
      }

      const { callId, agora } = json.data;
      setActiveCall({ callId, agora });
      _join(agora); // join Agora channel immediately as caller

      return { callId };
    } catch {
      setCallState('idle');
      return { error: 'Failed to start call' };
    }
  }, [authToken, _join]);

  // ── RECEIVER: accept incoming call ──────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      const res = await fetch(`${BASE_URL}/voice-calls/${incomingCall.callId}/answer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (!json.success) return { error: json.message };

      setActiveCall(incomingCall);
      setCallState('active');
      _join(incomingCall.agora); // join same Agora channel as receiver
      setIncomingCall(null);

      return { success: true };
    } catch {
      return { error: 'Failed to accept call' };
    }
  }, [incomingCall, authToken, _join]);

  // ── RECEIVER: decline incoming call ─────────────────────────────────────────
  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    socket.emit('call:reject', { callId: incomingCall.callId });
    setIncomingCall(null);
    setCallState('idle');
  }, [incomingCall, socket]);

  // ── EITHER: hang up ─────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    const callId = activeCall?.callId || incomingCall?.callId;
    if (!callId) return;

    try {
      await fetch(`${BASE_URL}/voice-calls/${callId}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch { /* best effort */ }

    _leave();
    setCallState('idle');
    setActiveCall(null);
    setIncomingCall(null);
  }, [activeCall, incomingCall, authToken, _leave]);

  // ── In-call controls ─────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    engine.current?.muteLocalAudioStream(next);
    setIsMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    const next = !isSpeaker;
    engine.current?.setEnableSpeakerphone(next);
    setIsSpeaker(next);
  }, [isSpeaker]);

  return {
    callState,    // 'idle' | 'calling' | 'ringing' | 'active' | 'ended' | 'rejected'
    incomingCall, // { callId, caller: { id, name, avatarUrl }, agora, deliveryId?, rideId? }
    activeCall,   // { callId, agora }
    isMuted,
    isSpeaker,
    startCall,    // ({ deliveryId?, rideId? }) => Promise<{ callId } | { error }>
    acceptCall,   // () => Promise
    declineCall,  // () => void
    endCall,      // () => Promise
    toggleMute,
    toggleSpeaker,
  };
}
```

---

## 4. Incoming Call Screen (the critical part)

This is what shows when the other party calls you. Render it **above your navigation** so it appears on any screen.

```jsx
// components/IncomingCallOverlay.jsx
import React from 'react';
import { Modal, View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';

export default function IncomingCallOverlay({ incomingCall, onAccept, onDecline }) {
  if (!incomingCall) return null;

  return (
    <Modal transparent animationType="slide" visible>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {incomingCall.caller.avatarUrl ? (
            <Image source={{ uri: incomingCall.caller.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {incomingCall.caller.name?.[0]?.toUpperCase()}
              </Text>
            </View>
          )}

          <Text style={styles.name}>{incomingCall.caller.name}</Text>
          <Text style={styles.subtitle}>Incoming voice call...</Text>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.declineBtn} onPress={onDecline}>
              <Text style={styles.btnIcon}>✕</Text>
              <Text style={styles.btnLabel}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptBtn} onPress={onAccept}>
              <Text style={styles.btnIcon}>✓</Text>
              <Text style={styles.btnLabel}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '80%',
  },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 16 },
  avatarPlaceholder: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#3a3a5c', justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  avatarInitial: { fontSize: 32, color: '#fff', fontWeight: 'bold' },
  name: { fontSize: 24, color: '#fff', fontWeight: 'bold', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 32 },
  actions: { flexDirection: 'row', gap: 24 },
  declineBtn: {
    backgroundColor: '#e74c3c', width: 70, height: 70,
    borderRadius: 35, alignItems: 'center', justifyContent: 'center',
  },
  acceptBtn: {
    backgroundColor: '#25D366', width: 70, height: 70,
    borderRadius: 35, alignItems: 'center', justifyContent: 'center',
  },
  btnIcon: { fontSize: 24, color: '#fff' },
  btnLabel: { fontSize: 11, color: '#fff', marginTop: 2 },
});
```

---

## 5. Active Call Screen

```jsx
// components/ActiveCallScreen.jsx
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ActiveCallScreen({ visible, isMuted, isSpeaker, onMute, onSpeaker, onEnd }) {
  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.status}>🟢 Call Connected</Text>

          <View style={styles.controls}>
            <TouchableOpacity style={styles.controlBtn} onPress={onMute}>
              <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
              <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlBtn} onPress={onSpeaker}>
              <Text style={styles.controlIcon}>{isSpeaker ? '🔈' : '🔊'}</Text>
              <Text style={styles.controlLabel}>{isSpeaker ? 'Earpiece' : 'Speaker'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.endBtn} onPress={onEnd}>
            <Text style={styles.endBtnText}>End Call</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center',
  },
  card: {
    backgroundColor: '#1a1a2e', borderRadius: 24,
    padding: 32, alignItems: 'center', width: '80%',
  },
  status: { fontSize: 18, color: '#fff', marginBottom: 32 },
  controls: { flexDirection: 'row', gap: 32, marginBottom: 32 },
  controlBtn: { alignItems: 'center' },
  controlIcon: { fontSize: 28 },
  controlLabel: { color: '#aaa', fontSize: 12, marginTop: 4 },
  endBtn: {
    backgroundColor: '#e74c3c', paddingVertical: 14,
    paddingHorizontal: 48, borderRadius: 50,
  },
  endBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
```

---

## 6. Wire It All Together in Your Screen

```jsx
// screens/DeliveryTrackingScreen.jsx  (same pattern for ride screen)
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useVoiceCall } from '../hooks/useVoiceCall';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import ActiveCallScreen from '../components/ActiveCallScreen';

export default function DeliveryTrackingScreen({ delivery, socket, userId, authToken }) {
  const {
    callState, incomingCall, isMuted, isSpeaker,
    startCall, acceptCall, declineCall, endCall,
    toggleMute, toggleSpeaker,
  } = useVoiceCall({ socket, userId, authToken });

  return (
    <View style={{ flex: 1, padding: 20 }}>

      {/* Your normal delivery UI */}
      <Text>Delivery #{delivery._id}</Text>

      {/* Call button — customer calls driver, or driver calls customer */}
      {callState === 'idle' && (
        <TouchableOpacity onPress={() => startCall({ deliveryId: delivery._id })}>
          <Text>📞 Call {userId === delivery.customerId ? 'Driver' : 'Customer'}</Text>
        </TouchableOpacity>
      )}

      {callState === 'calling' && (
        <View>
          <Text>Calling...</Text>
          <TouchableOpacity onPress={endCall}><Text>Cancel</Text></TouchableOpacity>
        </View>
      )}

      {(callState === 'ended') && <Text>Call ended</Text>}
      {(callState === 'rejected') && <Text>Call declined</Text>}

      {/* Incoming call — renders as a modal over everything */}
      <IncomingCallOverlay
        incomingCall={callState === 'ringing' ? incomingCall : null}
        onAccept={acceptCall}
        onDecline={declineCall}
      />

      {/* Active call controls */}
      <ActiveCallScreen
        visible={callState === 'active'}
        isMuted={isMuted}
        isSpeaker={isSpeaker}
        onMute={toggleMute}
        onSpeaker={toggleSpeaker}
        onEnd={endCall}
      />

    </View>
  );
}
```

---

## 7. Socket Setup (do this once after login)

```js
// context/SocketContext.js  or  App.js
import { io } from 'socket.io-client';

const socket = io('https://your-api-domain.com', {
  transports: ['websocket'],
  auth: { token: authToken }, // optional but recommended
});

// Pass socket + userId + authToken as props or via context to your screens
```

---

## 8. Full Call Flow

```
CALLER (customer or driver)          SERVER                  RECEIVER (other party)
        |                               |                               |
        |-- POST /deliveries/:id/voice-call -->                         |
        |<-- { callId, agora: { appId,  |                               |
        |      channel, token, uid } }  |                               |
        |                               |-- socket: incoming_voice_call -->
        |  joins Agora channel          |                    { callId, caller, agora }
        |                               |                               |
        |                               |          user taps Accept     |
        |                               |<-- POST /voice-calls/:id/answer --
        |<-- socket: call_answered -----|                               |
        |                               |                    joins Agora channel
        |                               |                               |
        |         🔊 AUDIO CONNECTED (Agora handles it)                 |
        |                               |                               |
        |-- POST /voice-calls/:id/end ->|                               |
        |                               |-- socket: call_ended -------->|
        |  leaves Agora channel         |                    leaves Agora channel
```

---

## 9. API Endpoints Reference

Base: `https://your-api-domain.com/api/voice-call`
All require: `Authorization: Bearer <token>`

| Method | Endpoint | Who | Description |
|--------|----------|-----|-------------|
| `POST` | `/deliveries/:deliveryId/voice-call` | Caller | Start call for a delivery |
| `POST` | `/rides/:rideId/voice-call` | Caller | Start call for a ride |
| `POST` | `/voice-calls/:callId/answer` | Receiver | Accept the call |
| `POST` | `/voice-calls/:callId/end` | Either | Hang up |
| `GET`  | `/deliveries/:deliveryId/call-history` | Either | Past calls list |

### Start call response
```json
{
  "success": true,
  "data": {
    "callId": "CALL-1234567890-ab12cd34",
    "status": "initiated",
    "receiver": "<userId>",
    "agora": {
      "appId": "c8a3423a...",
      "channel": "<deliveryId or rideId>",
      "token": "<agora_rtc_token>",
      "uid": 12345
    }
  }
}
```

### `incoming_voice_call` socket payload (receiver gets this)
```json
{
  "callId": "CALL-1234567890-ab12cd34",
  "deliveryId": "<id>",
  "caller": { "id": "<userId>", "name": "John", "avatarUrl": "https://..." },
  "agora": {
    "appId": "c8a3423a...",
    "channel": "<deliveryId>",
    "token": "<agora_rtc_token_for_receiver>",
    "uid": 67890
  }
}
```

> The caller and receiver get **different Agora tokens and UIDs** — the server generates both. Use the one from your respective source (API response for caller, socket event for receiver).

---

## 10. Socket Events Cheatsheet

| Event | Direction | When |
|-------|-----------|------|
| `user:join_voice_room` | Client → Server | On app start / login |
| `incoming_voice_call` | Server → Client | Someone calls you |
| `call:reject` | Client → Server | You decline a call |
| `call_answered` | Server → Client | Your call was accepted |
| `call_rejected` | Server → Client | Your call was declined |
| `call_ended` | Server → Client | Other party hung up |

---

## 11. Important Notes

- `user:join_voice_room` must be emitted **after login** and **after socket reconnects** — the hook handles this automatically.
- Both parties join the **same Agora channel** (the deliveryId/rideId). Agora routes the audio between them.
- Only **one active call per delivery/ride** is allowed — server returns `400` if a call is already in progress.
- Agora tokens expire in **1 hour** — sufficient for any delivery call.
- Audio uses **earpiece by default** (like a normal phone call). `toggleSpeaker()` switches to loudspeaker.
- You do **not** need to manage WebRTC, ICE candidates, or STUN/TURN servers — Agora handles all of that.
- The `VoiceCallManager.js` in `utils/` is the old WebRTC approach — **do not use it** for new integration.
