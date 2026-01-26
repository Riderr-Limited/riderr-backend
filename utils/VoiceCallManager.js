/**
 * Cross-Platform Voice Call Manager
 * Works on Web (React) and Mobile (React Native)
 */

class VoiceCallManager {
  constructor(socket, userId) {
    this.socket = socket;
    this.userId = userId;
    this.peerConnection = null;
    this.localStream = null;
    this.currentCall = null;
    
    this.setupSocketListeners();
  }

  // Initialize WebRTC configuration
  getWebRTCConfig() {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  // Setup socket event listeners
  setupSocketListeners() {
    this.socket.on('incoming_voice_call', this.handleIncomingCall.bind(this));
    this.socket.on('call_answered', this.handleCallAnswered.bind(this));
    this.socket.on('call_ended', this.handleCallEnded.bind(this));
    this.socket.on('call_rejected', this.handleCallRejected.bind(this));
    this.socket.on('webrtc:offer', this.handleWebRTCOffer.bind(this));
    this.socket.on('webrtc:answer', this.handleWebRTCAnswer.bind(this));
    this.socket.on('webrtc:ice_candidate', this.handleICECandidate.bind(this));
    
    // Join user room for receiving calls
    this.socket.emit('user:join_voice_room', this.userId);
  }

  // Initiate voice call
  async initiateCall(deliveryId) {
    try {
      // Get user media
      this.localStream = await this.getUserMedia();
      
      // Create peer connection
      this.peerConnection = new RTCPeerConnection(this.getWebRTCConfig());
      this.setupPeerConnectionEvents();
      
      // Add local stream
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
      
      // Create and send offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      // Send offer via socket
      this.socket.emit('webrtc:offer', {
        callId: this.currentCall.callId,
        offer: offer
      });
      
      this.onCallStateChanged('calling');
      
    } catch (error) {
      console.error('Call initiation failed:', error);
      this.onCallError('Failed to start call');
    }
  }

  // Answer incoming call
  async answerCall(callId) {
    try {
      this.currentCall = { callId };
      
      // Answer via API
      const response = await fetch(`/api/voice/voice-calls/${callId}/answer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error('Failed to answer call');
      
      this.onCallStateChanged('answered');
      
    } catch (error) {
      console.error('Answer call failed:', error);
      this.onCallError('Failed to answer call');
    }
  }

  // End current call
  async endCall() {
    try {
      if (this.currentCall) {
        // End via API
        await fetch(`/api/voice/voice-calls/${this.currentCall.callId}/end`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.getToken()}`
          }
        });
      }
      
      this.cleanup();
      this.onCallStateChanged('ended');
      
    } catch (error) {
      console.error('End call failed:', error);
      this.cleanup();
    }
  }

  // Reject incoming call
  rejectCall(callId) {
    this.socket.emit('call:reject', { callId });
    this.onCallStateChanged('rejected');
  }

  // Get user media (cross-platform)
  async getUserMedia() {
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    };

    // Use appropriate getUserMedia based on platform
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      // Web
      return await navigator.mediaDevices.getUserMedia(constraints);
    } else if (typeof require !== 'undefined') {
      // React Native
      const { mediaDevices } = require('react-native-webrtc');
      return await mediaDevices.getUserMedia(constraints);
    }
    
    throw new Error('Media devices not available');
  }

  // Setup peer connection events
  setupPeerConnectionEvents() {
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc:ice_candidate', {
          callId: this.currentCall.callId,
          candidate: event.candidate,
          targetUserId: this.currentCall.otherUserId
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      this.onRemoteStreamReceived(event.streams[0]);
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'connected') {
        this.onCallStateChanged('connected');
      }
    };
  }

  // Handle incoming call
  handleIncomingCall(data) {
    this.currentCall = {
      callId: data.callId,
      deliveryId: data.deliveryId,
      caller: data.caller,
      otherUserId: data.caller.id
    };
    
    this.onIncomingCall(data);
  }

  // Handle WebRTC offer
  async handleWebRTCOffer(data) {
    try {
      this.localStream = await this.getUserMedia();
      
      this.peerConnection = new RTCPeerConnection(this.getWebRTCConfig());
      this.setupPeerConnectionEvents();
      
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
      
      await this.peerConnection.setRemoteDescription(data.offer);
      
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      this.socket.emit('webrtc:answer', {
        callId: data.callId,
        answer: answer
      });
      
    } catch (error) {
      console.error('Handle offer failed:', error);
    }
  }

  // Handle WebRTC answer
  async handleWebRTCAnswer(data) {
    try {
      await this.peerConnection.setRemoteDescription(data.answer);
    } catch (error) {
      console.error('Handle answer failed:', error);
    }
  }

  // Handle ICE candidate
  async handleICECandidate(data) {
    try {
      await this.peerConnection.addIceCandidate(data.candidate);
    } catch (error) {
      console.error('Handle ICE candidate failed:', error);
    }
  }

  // Handle call answered
  handleCallAnswered(data) {
    this.onCallStateChanged('answered');
  }

  // Handle call ended
  handleCallEnded(data) {
    this.cleanup();
    this.onCallStateChanged('ended');
  }

  // Handle call rejected
  handleCallRejected(data) {
    this.cleanup();
    this.onCallStateChanged('rejected');
  }

  // Cleanup resources
  cleanup() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    this.currentCall = null;
  }

  // Get auth token (implement based on your auth system)
  getToken() {
    // Return your JWT token
    return localStorage.getItem('token') || '';
  }

  // Override these methods in your implementation
  onIncomingCall(data) {
    console.log('Incoming call:', data);
  }

  onCallStateChanged(state) {
    console.log('Call state changed:', state);
  }

  onRemoteStreamReceived(stream) {
    console.log('Remote stream received:', stream);
  }

  onCallError(error) {
    console.error('Call error:', error);
  }
}

export default VoiceCallManager;