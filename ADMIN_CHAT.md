# ADMIN CHAT API DOCUMENTATION

## Overview
Standalone live chat system between users (customers/drivers) and admin support.
No ticket required - direct messaging.

---

## REST API Endpoints

**Base URL:** `/api/admin-chat`

### 1. Get My Messages
**Endpoint:** `GET /api/admin-chat/messages?limit=50`  
**Auth:** Required  
**Description:** Get chat history between user and admin

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65a1b2c3d4e5f6g7h8i9j0k1",
      "userId": "65a1b2c3d4e5f6g7h8i9j0k2",
      "senderId": {
        "_id": "65a1b2c3d4e5f6g7h8i9j0k2",
        "name": "John Doe",
        "email": "john@example.com",
        "role": "customer"
      },
      "message": "Hello, I need help",
      "isAdminMessage": false,
      "isRead": true,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "_id": "65a1b2c3d4e5f6g7h8i9j0k3",
      "userId": "65a1b2c3d4e5f6g7h8i9j0k2",
      "senderId": {
        "_id": "65a1b2c3d4e5f6g7h8i9j0k4",
        "name": "Admin Support",
        "email": "admin@riderr.ng",
        "role": "System Admin"
      },
      "message": "Hi! How can I help you?",
      "isAdminMessage": true,
      "isRead": true,
      "createdAt": "2024-01-15T10:31:00.000Z",
      "updatedAt": "2024-01-15T10:31:00.000Z"
    }
  ]
}
```

---

### 2. Send Message
**Endpoint:** `POST /api/admin-chat/messages`  
**Auth:** Required

**User Request:**
```json
{
  "message": "I need help with my payment"
}
```

**Admin Request:**
```json
{
  "userId": "65a1b2c3d4e5f6g7h8i9j0k2",
  "message": "I'll help you with that"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "_id": "65a1b2c3d4e5f6g7h8i9j0k5",
    "userId": "65a1b2c3d4e5f6g7h8i9j0k2",
    "senderId": {
      "_id": "65a1b2c3d4e5f6g7h8i9j0k2",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "customer"
    },
    "message": "I need help with my payment",
    "isAdminMessage": false,
    "isRead": false,
    "createdAt": "2024-01-15T10:32:00.000Z",
    "updatedAt": "2024-01-15T10:32:00.000Z"
  }
}
```

---

### 3. Get Unread Count
**Endpoint:** `GET /api/admin-chat/unread`  
**Auth:** Required  
**Description:** Get count of unread messages from admin

**Response (200):**
```json
{
  "success": true,
  "data": {
    "unreadCount": 3
  }
}
```

---

### 4. Get User Chats (Admin Only)
**Endpoint:** `GET /api/admin-chat/users`  
**Auth:** Required (System Admin)  
**Description:** Get list of all users with active chats

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": {
        "_id": "65a1b2c3d4e5f6g7h8i9j0k2",
        "name": "John Doe",
        "email": "john@example.com",
        "role": "customer"
      },
      "lastMessage": "I need help with my payment",
      "lastMessageTime": "2024-01-15T10:32:00.000Z",
      "unreadCount": 2
    }
  ]
}
```

---

## Socket.IO (Real-time Chat)

**Namespace:** `/admin-chat`

### Connection
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:5000/admin-chat', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});

socket.on('connect', () => {
  console.log('Connected to admin chat');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});
```

---

### Events to Emit

#### 1. Send Message (User)
```javascript
socket.emit('send_message', {
  message: 'Hello, I need help'
}, (response) => {
  if (response.success) {
    console.log('Message sent:', response.data);
  } else {
    console.error('Error:', response.error);
  }
});
```

**Callback Response:**
```json
{
  "success": true,
  "data": {
    "_id": "65a1b2c3d4e5f6g7h8i9j0k5",
    "userId": "65a1b2c3d4e5f6g7h8i9j0k2",
    "senderId": {
      "_id": "65a1b2c3d4e5f6g7h8i9j0k2",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "customer"
    },
    "message": "Hello, I need help",
    "isAdminMessage": false,
    "isRead": false,
    "createdAt": "2024-01-15T10:32:00.000Z"
  }
}
```

#### 2. Send Message (Admin)
```javascript
socket.emit('send_message', {
  userId: '65a1b2c3d4e5f6g7h8i9j0k2',  // Target user ID
  message: 'Hi! How can I help you?'
}, (response) => {
  if (response.success) {
    console.log('Reply sent:', response.data);
  }
});
```

#### 3. Mark as Read
```javascript
socket.emit('mark_read', {}, (response) => {
  if (response.success) {
    console.log('Messages marked as read');
  }
});
```

---

### Events to Listen

#### Receive Message
```javascript
socket.on('receive_message', (message) => {
  console.log('New message:', message);
  // Update UI with new message
});
```

**Message Object:**
```json
{
  "_id": "65a1b2c3d4e5f6g7h8i9j0k5",
  "userId": "65a1b2c3d4e5f6g7h8i9j0k2",
  "senderId": {
    "_id": "65a1b2c3d4e5f6g7h8i9j0k4",
    "name": "Admin Support",
    "email": "admin@riderr.ng",
    "role": "System Admin"
  },
  "message": "Hi! How can I help you?",
  "isAdminMessage": true,
  "isRead": false,
  "createdAt": "2024-01-15T10:33:00.000Z"
}
```

---

## Frontend Integration Flow

### User Flow:
```javascript
// 1. Connect to socket
const socket = io('http://localhost:5000/admin-chat', {
  auth: { token: userToken }
});

// 2. Load message history
fetch('/api/admin-chat/messages', {
  headers: { Authorization: `Bearer ${userToken}` }
})
.then(res => res.json())
.then(data => displayMessages(data.data));

// 3. Listen for new messages
socket.on('receive_message', (message) => {
  addMessageToUI(message);
});

// 4. Send message
function sendMessage(text) {
  socket.emit('send_message', { message: text }, (response) => {
    if (response.success) {
      addMessageToUI(response.data);
    }
  });
}

// 5. Mark as read when viewing
socket.emit('mark_read');
```

### Admin Flow:
```javascript
// 1. Connect to socket
const socket = io('http://localhost:5000/admin-chat', {
  auth: { token: adminToken }
});

// 2. Get list of users with chats
fetch('/api/admin-chat/users', {
  headers: { Authorization: `Bearer ${adminToken}` }
})
.then(res => res.json())
.then(data => displayUserList(data.data));

// 3. Load specific user's messages
function loadUserChat(userId) {
  fetch(`/api/admin-chat/messages?userId=${userId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  .then(res => res.json())
  .then(data => displayMessages(data.data));
}

// 4. Listen for new messages from any user
socket.on('receive_message', (message) => {
  updateUserList(message.userId);
  if (currentChatUserId === message.userId) {
    addMessageToUI(message);
  }
});

// 5. Reply to user
function replyToUser(userId, text) {
  socket.emit('send_message', {
    userId: userId,
    message: text
  }, (response) => {
    if (response.success) {
      addMessageToUI(response.data);
    }
  });
}
```

---

## Key Differences from Support Tickets

| Feature | Support Tickets | Admin Chat |
|---------|----------------|------------|
| **Purpose** | Formal problem reporting | Quick live chat |
| **Requires** | Form submission first | Nothing - just start chatting |
| **Identifier** | ticketId | userId |
| **Status** | open/in-progress/resolved | N/A |
| **Use Case** | Bug reports, complaints | Quick questions, help |

---

## Error Responses

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Authentication required"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Admin only"
}
```

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Message required"
}
```

**500 Server Error:**
```json
{
  "success": false,
  "message": "Server error"
}
```
