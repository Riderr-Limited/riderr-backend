# Riderr — Frontend Integration Guide
## Delivery Request & Payment Flow

**Base URL:** `https://your-domain.com`  
**All protected routes require:** `Authorization: Bearer <accessToken>`  
**Content-Type:** `application/json`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Customer Flow](#2-customer-flow)
3. [Driver Flow](#3-driver-flow)
4. [Payment Screens](#4-payment-screens)
5. [All Endpoints Reference](#5-all-endpoints-reference)
6. [Error Handling](#6-error-handling)

---

## 1. Authentication

### Sign Up
```
POST /api/auth/signup
```
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+2348012345678",
  "password": "Password123!",
  "role": "customer"
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "_id": "...", "name": "John Doe", "role": "customer" },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### Login
```
POST /api/auth/login
```
```json
{
  "email": "john@example.com",
  "password": "Password123!"
}
```
**Response:** same shape as signup — store `accessToken` and `refreshToken`.

### Refresh Token
```
POST /api/auth/refresh
```
```json
{ "refreshToken": "eyJ..." }
```
Call this when any request returns `401`. Replace stored `accessToken` with the new one.

---

## 2. Customer Flow

### Full Screen-by-Screen Flow

```
[Screen 1]  Home / Map
     ↓  tap "Send a Package"
[Screen 2]  Set Pickup & Dropoff locations
     ↓  tap "Calculate Fare"
[Screen 3]  Fare Preview + Choose Payment Method
     ↓  tap "Confirm & Request"
[Screen 4A] Card Payment  ← if card selected
[Screen 4B] Bank Transfer ← if transfer selected
[Screen 4C] (skip)        ← if cash selected
     ↓  payment confirmed (or cash — no payment needed)
[Screen 5]  Waiting for Rider
     ↓  rider accepts
[Screen 6]  Rider Assigned — tracking map
     ↓  rider picks up
[Screen 7]  Package Picked Up
     ↓  rider delivers
[Screen 8]  Confirm Delivery Received
     ↓  confirmed
[Screen 9]  Rate & Review
```

---

### Step 1 — Calculate Fare

Show this before the customer commits. Use it to display the price and check driver availability.

```
POST /api/deliveries/calculate-fare
Authorization: Bearer <token>
```
```json
{
  "pickupLat": 6.5244,
  "pickupLng": 3.3792,
  "dropoffLat": 6.4698,
  "dropoffLng": 3.5852,
  "itemType": "parcel",
  "itemWeight": 1
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "quoteId": "QUOTE-1234-ABCD",
    "fare": {
      "baseFare": 500,
      "distanceFare": 800,
      "totalFare": 1300,
      "currency": "NGN",
      "formatted": "₦1,300"
    },
    "distance": { "km": 8.2, "formatted": "8.2 km" },
    "estimatedDuration": { "minutes": 25, "formatted": "25 min" },
    "pickup": { "lat": 6.5244, "lng": 3.3792, "address": "Victoria Island, Lagos" },
    "dropoff": { "lat": 6.4698, "lng": 3.5852, "address": "Lekki Phase 1, Lagos" },
    "availability": {
      "nearbyDriversCount": 4,
      "hasDrivers": true,
      "estimatedPickupTime": "5-15 min"
    }
  }
}
```
> Store `quoteId` and `fare.totalFare` — pass them when creating the delivery.

---

### Step 2 — Create Delivery Request

**One call does everything** — creates the delivery AND initializes payment if card/transfer.

```
POST /api/deliveries/request
Authorization: Bearer <token>
```
```json
{
  "pickupLat": 6.5244,
  "pickupLng": 3.3792,
  "pickupAddress": "Victoria Island, Lagos",
  "pickupName": "John Doe",
  "pickupPhone": "+2348012345678",
  "dropoffLat": 6.4698,
  "dropoffLng": 3.5852,
  "dropoffAddress": "Lekki Phase 1, Lagos",
  "recipientName": "Jane Doe",
  "recipientPhone": "+2348087654321",
  "itemType": "parcel",
  "itemDescription": "Documents",
  "itemWeight": 1,
  "paymentMethod": "card",
  "quoteId": "QUOTE-1234-ABCD",
  "expectedFare": 1300
}
```

> `paymentMethod` values: `"card"` | `"transfer"` | `"cash"`

---

**Response — Card or Transfer:**
```json
{
  "success": true,
  "data": {
    "delivery": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "referenceId": "RID-1234567-ABCDEF",
      "status": "created",
      "fare": { "totalFare": 1300, "currency": "NGN" },
      "payment": { "method": "card", "status": "pending_payment" }
    },
    "requiresPayment": true,
    "payment": {
      "paymentId": "64f...",
      "reference": "RIDERR-1234567890-ABCD",
      "amount": 1300,
      "amountFormatted": "₦1,300",
      "paymentMethod": "card",
      "nextAction": "show_card_form",
      "breakdown": {
        "total": 1300,
        "platformFee": 130,
        "companyAmount": 1170
      }
    },
    "message": "Please complete card payment to confirm your delivery"
  }
}
```

**Response — Cash:**
```json
{
  "success": true,
  "data": {
    "delivery": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "status": "created",
      "payment": { "method": "cash", "status": "pending" }
    },
    "requiresPayment": false,
    "payment": null,
    "message": "4 nearby drivers notified!"
  }
}
```

---

**Frontend logic after create:**
```
const { requiresPayment, payment, delivery } = response.data

if (!requiresPayment) {
  // Cash — go straight to waiting screen
  navigate('WaitingForRider', { deliveryId: delivery._id })

} else if (payment.nextAction === 'show_card_form') {
  // Card — show card input screen
  navigate('CardPayment', {
    deliveryId: delivery._id,
    reference: payment.reference,
    amount: payment.amountFormatted
  })

} else if (payment.nextAction === 'show_bank_details') {
  // Transfer — fetch bank details then show them
  // Call POST /api/payments/initialize to get virtual account
  navigate('BankTransfer', {
    deliveryId: delivery._id,
    reference: payment.reference,
    amount: payment.amountFormatted
  })
}
```

---

### Step 3A — Card Payment Screen

Collect card details and charge in one call.

```
POST /api/payments/charge-card
Authorization: Bearer <token>
```
```json
{
  "reference": "RIDERR-1234567890-ABCD",
  "cardDetails": {
    "number": "5061010000000000043",
    "cvv": "123",
    "expiry_month": "12",
    "expiry_year": "25",
    "pin": "1234"
  }
}
```

> `pin` is optional — include it if you collect it upfront. If not, the API will ask for it.

**Possible responses — handle all 3:**

**Success:**
```json
{
  "success": true,
  "message": "Payment successful!",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-...",
    "amount": 1300,
    "deliveryId": "64f..."
  }
}
```
→ Navigate to **Waiting for Rider** screen.

**PIN required:**
```json
{
  "success": true,
  "requiresPin": true,
  "message": "Card requires PIN",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-...",
    "displayMessage": "Please enter your card PIN"
  }
}
```
→ Show PIN input. Call `POST /api/payments/submit-pin`.

**OTP required:**
```json
{
  "success": true,
  "requiresOtp": true,
  "message": "OTP sent to your phone number",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-...",
    "displayMessage": "Enter OTP sent to 080*****123"
  }
}
```
→ Show OTP input. Call `POST /api/payments/submit-otp`.

---

### Step 3B — Submit PIN

```
POST /api/payments/submit-pin
Authorization: Bearer <token>
```
```json
{
  "reference": "RIDERR-1234567890-ABCD",
  "pin": "1234"
}
```
**Possible responses:** success (same as above) or OTP required (same as above).

---

### Step 3C — Submit OTP

```
POST /api/payments/submit-otp
Authorization: Bearer <token>
```
```json
{
  "reference": "RIDERR-1234567890-ABCD",
  "otp": "123456"
}
```
**Response on success:**
```json
{
  "success": true,
  "message": "Payment completed successfully!",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-...",
    "amount": 1300,
    "deliveryId": "64f...",
    "paidAt": "2024-01-15T10:30:00.000Z"
  }
}
```
→ Navigate to **Waiting for Rider** screen.

---

### Step 3D — Bank Transfer Screen

First, get the virtual account details:

```
POST /api/payments/initialize
Authorization: Bearer <token>
```
```json
{
  "deliveryId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "paymentType": "transfer"
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-1234567890-ABCD",
    "amount": 1300,
    "amountFormatted": "₦1,300",
    "status": "pending_transfer",
    "bankAccount": {
      "bankName": "Wema Bank",
      "accountNumber": "9876543210",
      "accountName": "RIDERR TECHNOLOGIES",
      "narration": "Not required"
    },
    "polling": {
      "url": "/api/payments/status/RIDERR-1234567890-ABCD",
      "intervalSeconds": 5,
      "timeoutMinutes": 30
    }
  }
}
```

Display the bank details. Then **poll every 5 seconds**:

```
GET /api/payments/status/RIDERR-1234567890-ABCD
Authorization: Bearer <token>
```
```json
{
  "success": true,
  "data": {
    "status": "successful",
    "amount": 1300,
    "paidAt": "2024-01-15T10:30:00.000Z",
    "reference": "RIDERR-..."
  }
}
```

**Poll logic:**
```
startPolling(reference) {
  interval = setInterval(async () => {
    const res = await GET /api/payments/status/:reference
    
    if (res.data.status === 'successful') {
      clearInterval(interval)
      navigate('WaitingForRider', { deliveryId })
    }
    
    if (res.data.status === 'failed') {
      clearInterval(interval)
      showError('Payment failed. Please try again.')
    }
    
    if (timeElapsed > 30 minutes) {
      clearInterval(interval)
      showMessage('Taking longer than expected. We will notify you.')
    }
    
  }, 5000)
}
```

---

### Step 4 — Waiting for Rider Screen

Poll the delivery status while waiting for a rider to accept.

```
GET /api/deliveries/customer/active
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f...",
    "status": "assigned",
    "currentStep": "driver_assigned",
    "nextStep": "Driver heading to pickup location",
    "driver": {
      "name": "Musa Ibrahim",
      "phone": "+2348011111111",
      "avatarUrl": "https://...",
      "rating": 4.8,
      "vehicle": {
        "type": "bike",
        "make": "Honda",
        "model": "CB125",
        "plateNumber": "LAG-123-AB"
      },
      "currentLocation": { "lat": 6.5100, "lng": 3.3600 }
    },
    "company": {
      "name": "Swift Riders Ltd",
      "logo": "https://...",
      "contactPhone": "+2348099999999"
    },
    "etaMinutes": 8,
    "progress": {
      "percentage": 30,
      "message": "Driver assigned and heading to pickup"
    },
    "payment": { "method": "card", "status": "paid" }
  }
}
```

**Poll every 10 seconds.** When `status` changes:

| status | What to show |
|--------|-------------|
| `created` | Searching for riders... |
| `assigned` | Rider found! Show driver card + map |
| `picked_up` | Package picked up, on the way |
| `delivered` | Delivered! Show confirm button |
| `cancelled` | Cancelled — show reason |

---

### Step 5 — Track Delivery (Live Map)

```
GET /api/deliveries/:deliveryId/updates
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "data": {
    "status": "picked_up",
    "driverLocation": {
      "lat": 6.4900,
      "lng": 3.4200,
      "updatedAt": "2024-01-15T10:45:00.000Z"
    },
    "etaMinutes": 12,
    "canTrack": true
  }
}
```
Poll every 10 seconds to update driver pin on map.

---

### Step 6 — Confirm Delivery & Trigger Payout

When `delivery.status === "delivered"`, show a **"I received my package"** button.

```
POST /api/payments/complete-and-settle/:deliveryId
Authorization: Bearer <token>
```
```json
{
  "verified": true,
  "review": "Fast and careful delivery!"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Delivery verified and payment settled successfully!",
  "data": {
    "status": "completed",
    "settlement": {
      "success": true,
      "companyReceived": "₦1,170",
      "platformFee": "₦130",
      "transferStatus": "NEW"
    }
  }
}
```
→ Navigate to **Rate & Review** screen.

---

### Step 7 — Rate Delivery

```
POST /api/deliveries/:deliveryId/rate
Authorization: Bearer <token>
```
```json
{
  "rating": 5,
  "review": "Excellent service, very fast!"
}
```

---

### Resume Payment (App Reopened)

If the user closes the app mid-payment, fetch the payment state on app resume:

```
GET /api/payments/for-delivery/:deliveryId
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-...",
    "status": "pending",
    "amount": 1300,
    "paymentMethod": "card",
    "bankAccount": null,
    "polling": {
      "url": "/api/payments/status/RIDERR-...",
      "intervalSeconds": 5
    }
  }
}
```
Use `status` to decide which screen to resume on.

---

## 3. Driver Flow

### Full Screen-by-Screen Flow

```
[Screen 1]  Go Online toggle
     ↓  toggle ON
[Screen 2]  Delivery Requests Feed (auto-refreshes)
     ↓  tap a request
[Screen 3]  Request Detail — Accept or Reject
     ↓  tap Accept
[Screen 4]  Active Delivery — Navigate to Pickup
     ↓  arrive at pickup, tap "Picked Up"
[Screen 5]  Navigate to Dropoff
     ↓  arrive, tap "Delivered"
[Screen 6]  Delivery Complete — wait for customer confirmation
```

---

### Step 1 — Go Online

```
POST /api/drivers/status
Authorization: Bearer <token>
```
```json
{ "isOnline": true, "isAvailable": true }
```

Update location every 30 seconds while online:

```
POST /api/deliveries/driver/location
Authorization: Bearer <token>
```
```json
{
  "lat": 6.5244,
  "lng": 3.3792
}
```

---

### Step 2 — Get Delivery Requests Feed

```
GET /api/deliveries/driver/nearby?lat=6.5244&lng=3.3792&maxDistance=10
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "data": {
    "deliveries": [
      {
        "_id": "64f...",
        "pickup": {
          "address": "Victoria Island, Lagos",
          "lat": 6.5244,
          "lng": 3.3792
        },
        "dropoff": {
          "address": "Lekki Phase 1, Lagos"
        },
        "fare": { "totalFare": 1300, "currency": "NGN" },
        "distanceFromDriver": 1.2,
        "distanceText": "1.2 km away",
        "estimatedPickupTime": 4,
        "estimatedPickupTimeText": "4 min",
        "payment": {
          "method": "card",
          "isPaid": true,
          "cashOnDelivery": false
        },
        "customer": { "name": "John D.", "rating": 4.5 },
        "canAccept": true
      }
    ],
    "count": 3
  }
}
```

> Only deliveries where payment is confirmed (or cash) appear here. Refresh every 15 seconds.

---

### Step 3 — Accept Delivery

```
POST /api/deliveries/:deliveryId/accept
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "message": "Delivery accepted! Payment is secured. Head to the pickup location",
  "data": {
    "delivery": { "_id": "...", "status": "assigned" },
    "payment": {
      "method": "card",
      "status": "secured",
      "amount": 1300,
      "message": "Payment held securely until delivery completion"
    }
  }
}
```

---

### Step 4 — Reject Delivery

```
POST /api/deliveries/:deliveryId/reject
Authorization: Bearer <token>
```
```json
{ "reason": "Too far from my location" }
```

---

### Step 5 — Mark Picked Up

```
POST /api/deliveries/:deliveryId/start
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "message": "Delivery started successfully",
  "data": {
    "delivery": { "status": "picked_up", "pickedUpAt": "..." },
    "payment": { "status": "secured" }
  }
}
```

---

### Step 6 — Mark Delivered

```
POST /api/deliveries/:deliveryId/complete
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "message": "Delivery completed! Waiting for customer verification to release payment.",
  "data": {
    "delivery": { "status": "delivered", "deliveredAt": "..." },
    "payment": {
      "status": "awaiting_verification",
      "message": "Payment will be released after customer verifies delivery",
      "expectedAmount": 1300
    }
  }
}
```

---

### Cash Payment — Confirm Collection

For cash deliveries, after the customer pays physically:

```
POST /api/deliveries/:deliveryId/confirm-cash
Authorization: Bearer <token>
```
**Response:**
```json
{
  "success": true,
  "message": "Cash payment confirmed successfully",
  "data": {
    "payment": { "amount": 1300, "status": "successful" }
  }
}
```

---

## 4. Payment Screens

### Card Payment Screen Logic

```
┌─────────────────────────────────┐
│        Pay ₦1,300               │
│                                 │
│  Card Number                    │
│  [5061 0100 0000 0000]          │
│                                 │
│  Expiry          CVV            │
│  [12 / 25]       [123]          │
│                                 │
│  PIN (optional)                 │
│  [• • • •]                      │
│                                 │
│       [Pay Now]                 │
└─────────────────────────────────┘

On tap "Pay Now":
  POST /api/payments/charge-card
  
  if success          → WaitingForRider screen
  if requiresPin      → show PIN modal → submit-pin
  if requiresOtp      → show OTP modal → submit-otp
  if success === false → show error, let user retry
```

---

### Bank Transfer Screen Logic

```
┌─────────────────────────────────┐
│     Transfer ₦1,300             │
│                                 │
│  Bank:    Wema Bank             │
│  Account: 9876543210            │
│  Name:    RIDERR TECHNOLOGIES   │
│  Amount:  ₦1,300 (exact)        │
│                                 │
│  ⏳ Waiting for payment...      │
│  [████████░░░░░░░░] checking... │
│                                 │
│  Open your banking app and      │
│  transfer the exact amount.     │
│  This screen updates            │
│  automatically.                 │
└─────────────────────────────────┘

Polling every 5s:
  GET /api/payments/status/:reference
  
  if status === 'successful' → WaitingForRider screen
  if status === 'failed'     → show error
  if 30 min elapsed          → show support message
```

---

## 5. All Endpoints Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signup` | No | Register |
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/refresh` | No | Refresh token |
| POST | `/api/auth/logout` | Yes | Logout |
| GET | `/api/auth/me` | Yes | Get profile |

### Customer — Delivery
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/deliveries/calculate-fare` | Yes | Get fare estimate |
| POST | `/api/deliveries/request` | Yes | Create delivery + init payment |
| GET | `/api/deliveries/customer/active` | Yes | Get active delivery |
| GET | `/api/deliveries/my` | Yes | Delivery history |
| GET | `/api/deliveries/:id` | Yes | Delivery details |
| GET | `/api/deliveries/:id/track` | Yes | Track with timeline |
| GET | `/api/deliveries/:id/updates` | Yes | Live driver location |
| POST | `/api/deliveries/:id/cancel` | Yes | Cancel + auto refund |
| POST | `/api/deliveries/:id/rate` | Yes | Rate delivery |

### Customer — Payment
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payments/charge-card` | Yes | Charge card directly |
| POST | `/api/payments/submit-pin` | Yes | Submit card PIN |
| POST | `/api/payments/submit-otp` | Yes | Submit OTP |
| POST | `/api/payments/initialize` | Yes | Get bank transfer details |
| GET | `/api/payments/status/:ref` | Yes | Poll payment status |
| GET | `/api/payments/for-delivery/:id` | Yes | Get payment by delivery |
| POST | `/api/payments/complete-and-settle/:id` | Yes | Confirm delivery + payout |
| GET | `/api/payments/my-payments` | Yes | Payment history |

### Driver
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/deliveries/driver/nearby` | Yes | Get delivery requests |
| POST | `/api/deliveries/:id/accept` | Yes | Accept delivery |
| POST | `/api/deliveries/:id/reject` | Yes | Reject delivery |
| POST | `/api/deliveries/:id/start` | Yes | Mark picked up |
| POST | `/api/deliveries/:id/complete` | Yes | Mark delivered |
| POST | `/api/deliveries/:id/confirm-cash` | Yes | Confirm cash collected |
| POST | `/api/deliveries/driver/location` | Yes | Update location |
| GET | `/api/deliveries/driver/active` | Yes | Active delivery |
| GET | `/api/deliveries/driver/my-deliveries` | Yes | Delivery history |

---

## 6. Error Handling

All errors follow this shape:
```json
{
  "success": false,
  "message": "Human readable message",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | Meaning | What to show |
|------|---------|--------------|
| `INVALID_DELIVERY_STATUS` | Delivery not in right state | Refresh and retry |
| `PAYMENT_EXISTS` | Already paid | Check payment status |
| `CARD_CHARGE_FAILED` | Card declined | "Card declined. Try another card." |
| `INVALID_PAYMENT_TYPE` | Wrong paymentType value | Dev error — check request |
| `DELIVERY_NOT_FOUND` | Wrong deliveryId | Refresh delivery list |
| `CARD_DETAILS_INCOMPLETE` | Missing card fields | Highlight missing fields |

### HTTP Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request — check `message` |
| `401` | Token expired — refresh token |
| `403` | Not authorized for this action |
| `404` | Resource not found |
| `500` | Server error — show generic error |

### Token Expiry Handling
```
On any 401 response:
  1. Call POST /api/auth/refresh with stored refreshToken
  2. Save new accessToken
  3. Retry the original request
  4. If refresh also fails → logout user → Login screen
```

---

## Money Flow (for reference)

```
Customer pays ₦1,300
       ↓
Flutterwave holds funds
       ↓
Delivery completed + customer confirms
       ↓
Auto transfer splits:
  ├── ₦1,170 (90%) → Rider's company bank account
  └──   ₦130 (10%) → Riderr platform
```

This happens automatically when the customer calls `complete-and-settle`. No manual action needed.
