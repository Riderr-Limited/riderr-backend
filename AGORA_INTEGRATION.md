# Agora Voice Call — Frontend Integration Guide
> Expo (React Native) — Customer & Driver apps

---

## 1. Install

```bash
npx expo install react-native-agora
```

> `react-native-agora` v4+ supports Expo New Architecture out of the box.

---

## 2. Permissions

Add to your `app.json` / `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-agora",
        {
          "microphonePermission": "Allow $(PRODUCT_NAME) to access your microphone for voice calls."
        }
      ]
    ]
  }
}
```

---

## 3. The Hook — `useVoiceCall.js`

Create this file once. Both customer and driver screens use it.

```js
// hooks/useVoiceCall.js
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
  IRtcEngine,
} from 'react-native-agora';

const AGORA_APP_ID = 'c8a3423aedfb4f6495fbd42220422429';
const API_BASE = 'https://your-api-domain.com/api/voice-call'; // change this

export function useVoiceCall({ socket, currentUser, token }) {
  const engineRef = useRef(null);
  const [callState, setCallState] = useState('idle');
  // idle | calling | ringing | active | ended | rejected | missed
  const [incomingCall, setIncomingCall] = useState(null);
  const [currentCall, setCurrentCall] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);

  // Init Agora engine once
  useEffect(() => {
    const engine = createAgoraRtcEngine();
    engine.initialize({ appId: AGORA_APP_ID });
    engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
    engine.enableAudio();
    engine.setDefaultAudioRouteToSpeakerphone(false); // earpiece by default

    engine.addListener('onUserOffline', () => {
      // Other party left the channel
      handleRemoteHangUp();
    });

    engine.addListener('onError', (err) => {
      console.error('Agora error:', err);
    });

    engineRef.current = engine;

    return () => {
      engine.leaveChannel();
      engine.release();
    };
  }, []);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    socket.emit('user:join_voice_room', currentUser._id);

    socket.on('incoming_voice_call', (data) => {
      // data = { callId, deliveryId, caller: { id, name, avatarUrl }, agora: { appId, channel, token, uid } }
      setIncomingCall(data);
      setCallState('ringing');
    });

    socket.on('call_answered', () => {
      setCallState('active');
    });

    socket.on('call_ended', () => {
      leaveAgoraChannel();
      setCallState('ended');
      setCurrentCall(null);
      setTimeout(() => setCallState('idle'), 3000);
    });

    socket.on('call_rejected', () => {
      leaveAgoraChannel();
      setCallState('rejected');
      setCurrentCall(null);
      setTimeout(() => setCallState('idle'), 2000);
    });

    return () => {
      socket.off('incoming_voice_call');
      socket.off('call_answered');
      socket.off('call_ended');
      socket.off('call_rejected');
    };
  }, [socket]);

  const leaveAgoraChannel = useCallback(() => {
    engineRef.current?.leaveChannel();
  }, []);

  const joinAgoraChannel = useCallback((agoraData) => {
    engineRef.current?.joinChannel(
      agoraData.token,
      agoraData.channel,
      agoraData.uid,
      { clientRoleType: ClientRoleType.ClientRoleBroadcaster }
    );
  }, []);

  const handleRemoteHangUp = useCallback(() => {
    leaveAgoraChannel();
    setCallState('ended');
    setCurrentCall(null);
    setTimeout(() => setCallState('idle'), 3000);
  }, []);

  // ─── CALLER: Start a call ───────────────────────────────────────────────────
  const startCall = useCallback(async (deliveryId) => {
    try {
      setCallState('calling');

      const res = await fetch(`${API_BASE}/deliveries/${deliveryId}/voice-call`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();

      if (!json.success) {
        setCallState('idle');
        return { error: json.message };
      }

      const { callId, agora } = json.data;
      setCurrentCall({ callId, deliveryId, agora });

      // Join Agora channel immediately as caller
      joinAgoraChannel(agora);

      return { callId };
    } catch (err) {
      setCallState('idle');
      return { error: 'Failed to start call' };
    }
  }, [token, joinAgoraChannel]);

  // ─── RECEIVER: Accept a call ────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      const res = await fetch(`${API_BASE}/voice-calls/${incomingCall.callId}/answer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();
      if (!json.success) return { error: json.message };

      setCurrentCall(incomingCall);
      setCallState('active');

      // Join Agora channel as receiver
      joinAgoraChannel(incomingCall.agora);
      setIncomingCall(null);

      return { success: true };
    } catch (err) {
      return { error: 'Failed to accept call' };
    }
  }, [incomingCall, token, joinAgoraChannel]);

  // ─── RECEIVER: Decline a call ───────────────────────────────────────────────
  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    socket.emit('call:reject', { callId: incomingCall.callId });
    setIncomingCall(null);
    setCallState('idle');
  }, [incomingCall, socket]);

  // ─── EITHER: End / hang up ──────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    const callId = currentCall?.callId || incomingCall?.callId;
    if (!callId) return;

    try {
      await fetch(`${API_BASE}/voice-calls/${callId}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_) {}

    leaveAgoraChannel();
    setCallState('idle');
    setCurrentCall(null);
    setIncomingCall(null);
  }, [currentCall, incomingCall, token, leaveAgoraChannel]);

  // ─── In-call controls ───────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    engineRef.current?.muteLocalAudioStream(next);
    setIsMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    const next = !isSpeaker;
    engineRef.current?.setEnableSpeakerphone(next);
    setIsSpeaker(next);
  }, [isSpeaker]);

  return {
    callState,      // 'idle' | 'calling' | 'ringing' | 'active' | 'ended' | 'rejected'
    incomingCall,   // { callId, deliveryId, caller: { id, name, avatarUrl }, agora }
    currentCall,    // { callId, deliveryId, agora }
    isMuted,
    isSpeaker,
    startCall,      // (deliveryId) => Promise
    acceptCall,     // () => Promise
    declineCall,    // () => void
    endCall,        // () => Promise
    toggleMute,     // () => void
    toggleSpeaker,  // () => void
  };
}
```

---

## 4. Usage in Customer Screen

```jsx
// screens/CustomerDeliveryScreen.jsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useVoiceCall } from '../hooks/useVoiceCall';

export default function CustomerDeliveryScreen({ deliveryId, socket, currentUser, token }) {
  const {
    callState,
    incomingCall,
    isMuted,
    isSpeaker,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  } = useVoiceCall({ socket, currentUser, token });

  // ── Incoming call screen (driver calling customer) ──
  if (callState === 'ringing' && incomingCall) {
    return (
      <View style={styles.callScreen}>
        <Text style={styles.callerName}>{incomingCall.caller.name}</Text>
        <Text style={styles.callStatus}>Incoming call...</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.declineBtn} onPress={declineCall}>
            <Text style={styles.btnText}>✕ Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.acceptBtn} onPress={acceptCall}>
            <Text style={styles.btnText}>✓ Accept</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Active call screen ──
  if (callState === 'active') {
    return (
      <View style={styles.callScreen}>
        <Text style={styles.callStatus}>Call Connected</Text>
        <View style={styles.row}>
          <TouchableOpacity onPress={toggleMute}>
            <Text>{isMuted ? '🔇 Unmute' : '🎤 Mute'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleSpeaker}>
            <Text>{isSpeaker ? '🔈 Earpiece' : '🔊 Speaker'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.endBtn} onPress={endCall}>
          <Text style={styles.btnText}>End Call</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Calling screen (waiting for driver to answer) ──
  if (callState === 'calling') {
    return (
      <View style={styles.callScreen}>
        <Text style={styles.callStatus}>Calling driver...</Text>
        <TouchableOpacity style={styles.endBtn} onPress={endCall}>
          <Text style={styles.btnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Default delivery screen with call button ──
  return (
    <View style={styles.container}>
      <Text>Delivery #{deliveryId}</Text>
      {callState === 'ended' && <Text style={styles.callStatus}>Call ended</Text>}
      {callState === 'rejected' && <Text style={styles.callStatus}>Call declined</Text>}
      <TouchableOpacity
        style={styles.callBtn}
        onPress={() => startCall(deliveryId)}
      >
        <Text style={styles.btnText}>📞 Call Driver</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  callScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  callerName: { fontSize: 28, color: '#fff', fontWeight: 'bold', marginBottom: 8 },
  callStatus: { fontSize: 16, color: '#aaa', marginBottom: 40 },
  row: { flexDirection: 'row', gap: 20, marginBottom: 30 },
  callBtn: { backgroundColor: '#25D366', padding: 16, borderRadius: 50, marginTop: 20 },
  acceptBtn: { backgroundColor: '#25D366', padding: 16, borderRadius: 50, minWidth: 120, alignItems: 'center' },
  declineBtn: { backgroundColor: '#e74c3c', padding: 16, borderRadius: 50, minWidth: 120, alignItems: 'center' },
  endBtn: { backgroundColor: '#e74c3c', padding: 16, borderRadius: 50, minWidth: 160, alignItems: 'center', marginTop: 20 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
```

---

## 5. Usage in Driver Screen

Exactly the same hook, just swap the button label:

```jsx
// screens/DriverDeliveryScreen.jsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useVoiceCall } from '../hooks/useVoiceCall';

export default function DriverDeliveryScreen({ deliveryId, socket, currentUser, token }) {
  const {
    callState, incomingCall, isMuted, isSpeaker,
    startCall, acceptCall, declineCall, endCall,
    toggleMute, toggleSpeaker,
  } = useVoiceCall({ socket, currentUser, token });

  if (callState === 'ringing' && incomingCall) {
    return (
      <View>
        <Text>📞 {incomingCall.caller.name} is calling...</Text>
        <TouchableOpacity onPress={declineCall}><Text>Decline</Text></TouchableOpacity>
        <TouchableOpacity onPress={acceptCall}><Text>Accept</Text></TouchableOpacity>
      </View>
    );
  }

  if (callState === 'active') {
    return (
      <View>
        <Text>Call Active</Text>
        <TouchableOpacity onPress={toggleMute}><Text>{isMuted ? 'Unmute' : 'Mute'}</Text></TouchableOpacity>
        <TouchableOpacity onPress={toggleSpeaker}><Text>{isSpeaker ? 'Earpiece' : 'Speaker'}</Text></TouchableOpacity>
        <TouchableOpacity onPress={endCall}><Text>Hang Up</Text></TouchableOpacity>
      </View>
    );
  }

  if (callState === 'calling') {
    return (
      <View>
        <Text>Calling customer...</Text>
        <TouchableOpacity onPress={endCall}><Text>Cancel</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <Text>Delivery #{deliveryId}</Text>
      <TouchableOpacity onPress={() => startCall(deliveryId)}>
        <Text>📞 Call Customer</Text>
      </TouchableOpacity>
    </View>
  );
}
```

---

## 6. How to Pass Socket + Token

In your app, after login, create the socket once and pass it down (via context, props, or a global store):

```js
// App.js or AuthContext
import io from 'socket.io-client';

const socket = io('https://your-api-domain.com', {
  transports: ['websocket'],
});

// Pass to screens:
<CustomerDeliveryScreen
  deliveryId={delivery._id}
  socket={socket}
  currentUser={user}
  token={authToken}
/>
```

---

## 7. What Each Part Does

| Part | What it does |
|------|-------------|
| `startCall(deliveryId)` | Calls the backend, gets Agora token, joins channel, notifies driver via socket |
| `acceptCall()` | Tells backend call is answered, joins same Agora channel — audio starts |
| `declineCall()` | Emits `call:reject` socket event, caller sees "Call declined" |
| `endCall()` | Calls backend end endpoint, leaves Agora channel, other party gets `call_ended` socket |
| `toggleMute()` | Mutes/unmutes your microphone via Agora engine |
| `toggleSpeaker()` | Switches between earpiece and speakerphone |
| `incomingCall.agora` | Contains `{ appId, channel, token, uid }` — passed directly to Agora join |

---

## 8. Call States Flow

```
idle
 │
 ├─ startCall() ──────────────────► calling
 │                                      │
 │                                      │ (other party accepts)
 │                                      ▼
 │                                   active ──► endCall() ──► idle
 │                                      │
 │                                      │ (other party hangs up)
 │                                      ▼
 │                                    ended ──► (auto back to idle after 3s)
 │
 └─ incoming_voice_call socket ──► ringing
                                      │
                          acceptCall()├──────────────► active
                          declineCall()└─────────────► idle
```

---

## 9. Backend Endpoints Used

| Call | Endpoint | When |
|------|----------|------|
| Start | `POST /api/voice-call/deliveries/:deliveryId/voice-call` | `startCall()` |
| Answer | `POST /api/voice-call/voice-calls/:callId/answer` | `acceptCall()` |
| End | `POST /api/voice-call/voice-calls/:callId/end` | `endCall()` |

All return `{ success: true, data: { ..., agora: { appId, channel, token, uid } } }`

---

## 10. Notes

- The Agora channel name is the `deliveryId` — both parties join the same channel automatically
- Tokens expire in 1 hour — more than enough for any delivery call
- Audio uses earpiece by default (like a phone call). `toggleSpeaker()` switches to loudspeaker
- You do NOT need to manage WebRTC, ICE candidates, or STUN/TURN servers — Agora handles all of that
- The old `VoiceCallManager.js` / WebRTC signaling is no longer needed for audio — socket is only used for call notifications (ring, reject, end)
