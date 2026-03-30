# Riderr Payment Integration Guide

**Gateway:** Flutterwave  
**Currency:** NGN  
**Base URL:** `https://your-domain.com/api/payments`  
**All requests require:** `Authorization: Bearer <token>` (except webhook)

---

## How Money Flows

```
Customer pays
     ↓
Flutterwave holds funds
     ↓
Rider delivers → Customer confirms
     ↓
Flutterwave transfers automatically:
  ├── 90% → Rider's company bank account
  └── 10% → Your platform (Flutterwave balance)
```

---

## Full Delivery + Payment Flow

```
[1] Customer creates delivery request
         ↓
[2] Rider (driver) accepts → delivery.status = "assigned"
         ↓
[3] Customer selects payment method (card or bank transfer)
         ↓
[4] Customer pays (in-app, no browser/redirect)
         ↓
[5] Payment confirmed → delivery proceeds
         ↓
[6] Driver picks up → marks picked_up
         ↓
[7] Driver delivers → marks delivered
         ↓
[8] Customer confirms receipt in app
         ↓
[9] Money automatically sent to company bank account
```

---

## Step-by-Step API Integration

---

### STEP 1 — Create Delivery

> This is handled by your existing delivery endpoints. Payment starts after a rider accepts.

---

### STEP 2 — Initialize Payment

**After rider accepts**, customer chooses how to pay and calls this single endpoint.

```
POST /api/payments/initialize
Authorization: Bearer <customer_token>
```

---

#### Option A: Card Payment

**Request:**
```json
{
  "deliveryId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "paymentType": "card",
  "cardDetails": {
    "number": "5061010000000000043",
    "cvv": "123",
    "expiry_month": "12",
    "expiry_year": "25",
    "pin": "1234"
  }
}
```

> `pin` is optional — only needed for Nigerian debit cards. Include it upfront if you collect it, otherwise the API will ask for it.

**Possible Responses:**

**A1 — Payment successful immediately:**
```json
{
  "success": true,
  "code": "PAYMENT_SUCCESSFUL",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-1234567890-ABCD",
    "amount": 5000,
    "status": "paid",
    "deliveryId": "64f..."
  }
}
```
→ Show success screen. Delivery is now active.

---

**A2 — PIN required:**
```json
{
  "success": true,
  "code": "CARD_PIN_REQUIRED",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-1234567890-ABCD",
    "amount": 5000,
    "status": "pending_pin",
    "nextAction": "submit_pin"
  }
}
```
→ Show PIN input screen. Call **submit-pin** endpoint.

---

**A3 — OTP required:**
```json
{
  "success": true,
  "code": "CARD_OTP_REQUIRED",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-1234567890-ABCD",
    "amount": 5000,
    "status": "pending_otp",
    "nextAction": "submit_otp",
    "otpMessage": "Enter OTP sent to 080*****123"
  }
}
```
→ Show OTP input screen. Call **submit-otp** endpoint.

---

#### Option B: Bank Transfer

**Request:**
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
    "amount": 5000,
    "amountFormatted": "₦5,000",
    "paymentType": "transfer",
    "status": "pending_transfer",
    "bankAccount": {
      "bankName": "Wema Bank",
      "accountNumber": "9876543210",
      "accountName": "RIDERR TECHNOLOGIES",
      "narration": "Not required"
    },
    "timeframe": {
      "estimated": "Instant (< 30 sec)"
    },
    "instructions": [
      "Open your banking app",
      "Transfer exactly ₦5,000",
      "Return here — payment confirms automatically"
    ],
    "polling": {
      "url": "/api/payments/status/RIDERR-1234567890-ABCD",
      "intervalSeconds": 5,
      "timeoutMinutes": 30
    }
  }
}
```
→ Display bank details in-app. Start polling. See **Step 3B**.

---

### STEP 3A — Submit PIN (card flow only)

```
POST /api/payments/submit-pin
Authorization: Bearer <customer_token>
```

**Request:**
```json
{
  "reference": "RIDERR-1234567890-ABCD",
  "pin": "1234"
}
```

**Possible Responses:**

- Payment successful → same as A1 above
- OTP now required → same as A3 above (PIN accepted, bank sends OTP next)

---

### STEP 3B — Submit OTP (card flow only)

```
POST /api/payments/submit-otp
Authorization: Bearer <customer_token>
```

**Request:**
```json
{
  "reference": "RIDERR-1234567890-ABCD",
  "otp": "123456"
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Payment completed successfully!",
  "data": {
    "paymentId": "64f...",
    "reference": "RIDERR-1234567890-ABCD",
    "amount": 5000,
    "deliveryId": "64f...",
    "paidAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### STEP 3C — Poll Payment Status (bank transfer only)

```
GET /api/payments/status/:reference
Authorization: Bearer <customer_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "successful",
    "amount": 5000,
    "paidAt": "2024-01-15T10:30:00.000Z",
    "reference": "RIDERR-1234567890-ABCD",
    "deliveryId": "64f..."
  }
}
```

**Poll logic (implement in app):**
```
every 5 seconds:
  GET /api/payments/status/:reference
  if status === "successful" → stop polling, show success
  if status === "failed"     → stop polling, show error
  if 30 minutes passed       → stop polling, show timeout message
```

---

### STEP 4 — Confirm Delivery & Trigger Payout

After the driver marks delivery as `delivered`, the customer confirms receipt in the app. This triggers the automatic bank transfer to the company.

```
POST /api/payments/complete-and-settle/:deliveryId
Authorization: Bearer <customer_token>
```

**Request:**
```json
{
  "verified": true,
  "review": "Fast delivery, great service!"
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Delivery verified and payment settled successfully!",
  "data": {
    "deliveryId": "64f...",
    "paymentId": "64f...",
    "status": "completed",
    "settlement": {
      "success": true,
      "companyReceived": "₦4,500",
      "platformFee": "₦500",
      "transferStatus": "NEW"
    }
  }
}
```

> `transferStatus: "NEW"` means Flutterwave accepted the transfer. It processes within minutes. The webhook confirms completion automatically.

---

## Card Payment — Full App Screen Flow

```
┌─────────────────────────┐
│   Enter Card Details    │
│                         │
│  Card Number: [______]  │
│  Expiry:  MM / YY       │
│  CVV:     [___]         │
│  PIN:     [____] (opt.) │
│                         │
│     [Pay ₦5,000]        │
└─────────────────────────┘
         ↓ POST /initialize
         
┌── if PAYMENT_SUCCESSFUL ──────────────┐
│  ✅ Payment Successful!               │
│  Your delivery is on the way          │
└───────────────────────────────────────┘

┌── if CARD_PIN_REQUIRED ───────────────┐
│  Enter your card PIN                  │
│  [_ _ _ _]                            │
│  [Confirm]  → POST /submit-pin        │
└───────────────────────────────────────┘

┌── if CARD_OTP_REQUIRED ───────────────┐
│  OTP sent to 080*****123              │
│  [_ _ _ _ _ _]                        │
│  [Verify]  → POST /submit-otp         │
└───────────────────────────────────────┘
```

---

## Bank Transfer — Full App Screen Flow

```
┌─────────────────────────────────────┐
│      Transfer Payment Details       │
│                                     │
│  Bank:    Wema Bank                 │
│  Account: 9876543210                │
│  Name:    RIDERR TECHNOLOGIES       │
│  Amount:  ₦5,000 (exact)            │
│                                     │
│  Open your banking app and          │
│  transfer the exact amount above.   │
│                                     │
│  ⏳ Waiting for payment...          │
│  (auto-detects when received)       │
└─────────────────────────────────────┘
         ↓ polling GET /status/:reference every 5s
         
┌── when status === "successful" ──────┐
│  ✅ Payment Confirmed!               │
│  Your delivery is on the way         │
└───────────────────────────────────────┘
```

---

## Webhook Setup (Backend — One Time)

In your **Flutterwave dashboard** → Webhooks, add:

```
URL:    https://your-domain.com/api/payments/webhook
Hash:   (same value as FLW_SECRET_HASH in your .env)
```

Events to enable:
- `charge.completed` — confirms card/transfer payments
- `transfer.completed` — confirms company payout sent

The webhook runs automatically. Your app doesn't need to do anything for it.

---

## Environment Variables (already configured)

```env
PAYMENT_PROVIDER=flutterwave
FLW_SECRET_KEY=FLWSECK-...        # server-side only, never expose
FLW_PUBLIC_KEY=FLWPUBK-...        # can be used in app if needed
FLW_SECRET_HASH=...               # webhook verification
PLATFORM_FEE_PERCENTAGE=10        # your commission %
```

---

## Error Handling

All error responses follow this shape:
```json
{
  "success": false,
  "message": "Human readable message",
  "code": "ERROR_CODE"
}
```

| Code | Meaning | What to do |
|------|---------|------------|
| `INVALID_DELIVERY_STATUS` | Delivery not yet assigned | Wait for rider to accept |
| `PAYMENT_EXISTS` | Already paid | Check payment status |
| `CARD_CHARGE_FAILED` | Card declined | Ask user to try another card |
| `INVALID_PAYMENT_TYPE` | Wrong paymentType value | Use `"card"` or `"transfer"` |
| `DELIVERY_NOT_FOUND` | Wrong deliveryId | Check the ID |

---

## Quick Reference — 5 Endpoints

| # | When | Method | Endpoint |
|---|------|--------|----------|
| 1 | Customer pays | `POST` | `/api/payments/initialize` |
| 2 | PIN needed | `POST` | `/api/payments/submit-pin` |
| 3 | OTP needed | `POST` | `/api/payments/submit-otp` |
| 4 | Bank transfer — check if paid | `GET` | `/api/payments/status/:reference` |
| 5 | Customer confirms delivery | `POST` | `/api/payments/complete-and-settle/:deliveryId` |
