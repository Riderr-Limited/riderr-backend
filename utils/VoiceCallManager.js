/**
 * Agora Voice Call Manager
 * Requires: agora-rtc-sdk-ng (web) or react-native-agora (mobile)
 */

class VoiceCallManager {
  constructor(socket, userId, { onIncomingCall, onCallStateChanged, onCallError } = {}) {
    this.socket = socket;
    this.userId = userId;
    this.agoraClient = null;
    this.localAudioTrack = null;
    this.currentCall = null;

    this.onIncomingCall = onIncomingCall || (() => {});
    this.onCallStateChanged = onCallStateChanged || (() => {});
    this.onCallError = onCallError || (() => {});

    this._setupSocket();
  }

  _setupSocket() {
    this.socket.emit("user:join_voice_room", this.userId);
    this.socket.on("incoming_voice_call", (data) => {
      this.currentCall = { callId: data.callId, agora: data.agora };
      this.onIncomingCall(data);
    });
    this.socket.on("call_answered", ({ callId }) => this.onCallStateChanged("answered", callId));
    this.socket.on("call_ended", ({ callId, duration }) => {
      this._cleanup();
      this.onCallStateChanged("ended", callId, { duration });
    });
    this.socket.on("call_rejected", ({ callId }) => {
      this._cleanup();
      this.onCallStateChanged("rejected", callId);
    });
  }

  // Call this after POST /api/voice-call/deliveries/:id/voice-call or rides/:id/voice-call
  async joinAgoraChannel({ appId, channel, token, uid }) {
    // Dynamically import Agora SDK (web: agora-rtc-sdk-ng)
    const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;

    this.agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    this.agoraClient.on("user-published", async (user, mediaType) => {
      await this.agoraClient.subscribe(user, mediaType);
      if (mediaType === "audio") user.audioTrack.play();
    });

    await this.agoraClient.join(appId, channel, token, uid);
    this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await this.agoraClient.publish(this.localAudioTrack);

    this.onCallStateChanged("connected", channel);
  }

  // Answer an incoming call
  async answerCall(callId, agoraCredentials) {
    try {
      const res = await fetch(`/api/voice-call/voice-calls/${callId}/answer`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this._getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to answer call");

      await this.joinAgoraChannel(agoraCredentials);
      this.onCallStateChanged("answered", callId);
    } catch (err) {
      this.onCallError(err.message);
    }
  }

  // End the current call
  async endCall(callId) {
    try {
      await fetch(`/api/voice-call/voice-calls/${callId}/end`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this._getToken()}` },
      });
    } catch (err) {
      console.error("End call error:", err);
    } finally {
      this._cleanup();
      this.onCallStateChanged("ended", callId);
    }
  }

  // Reject an incoming call
  rejectCall(callId) {
    this.socket.emit("call:reject", { callId });
    this.onCallStateChanged("rejected", callId);
  }

  async _cleanup() {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack.close();
      this.localAudioTrack = null;
    }
    if (this.agoraClient) {
      await this.agoraClient.leave();
      this.agoraClient = null;
    }
    this.currentCall = null;
  }

  _getToken() {
    return localStorage.getItem("token") || "";
  }
}

export default VoiceCallManager;
