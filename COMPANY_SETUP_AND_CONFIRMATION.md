# Company Bank Setup & Customer Delivery Confirmation
## Frontend Integration Guide

**Base URL:** `https://your-domain.com`  
**Auth:** `Authorization: Bearer <accessToken>`

---

## Part 1 — Company Bank Account Setup

### When to show this screen
- During company onboarding (required before receiving payments)
- In company settings / profile
- When settlement fails due to missing bank details

---

### Step 1 — Get Bank List (for dropdown)

```
GET /api/payments/banks
```
No auth required.

**Response:**
```json
{
  "success": true,
  "data": [
    { "code": "057", "name": "Zenith Bank" },
    { "code": "058", "name": "GTBank" },
    { "code": "044", "name": "Access Bank" },
    { "code": "011", "name": "First Bank" },
    { "code": "033", "name": "UBA" },
    { "code": "999992", "name": "Opay" },
    { "code": "999991", "name": "Palmpay" },
    { "code": "090267", "name": "Kuda Bank" },
    { "code": "000014", "name": "Stanbic IBTC" },
    { "code": "000013", "name": "GTBank (737)" }
  ]
}
```
Use this to populate the bank dropdown. Store both `code` and `name`.

---

### Step 2 — Setup Bank Account

```
POST /api/payments/company/setup-bank-account
Authorization: Bearer <company_token>
```

```json
{
  "accountNumber": "7043995559",
  "accountName": "AUWALU MUHAMMAD IZZIDDIN",
  "bankCode": "999992"
}
```

**Validation rules:**
- `accountNumber` — exactly 10 digits
- `accountName` — account holder name as registered with the bank
- `bankCode` — from the bank list above

**Success response:**
```json
{
  "success": true,
  "message": "Bank account setup successfully",
  "data": {
    "accountNumber": "7043995559",
    "accountName": "AUWALU MUHAMMAD IZZIDDIN",
    "bankCode": "999992",
    "verified": false,
    "note": "Account will be verified on first settlement"
  }
}
```

**Error responses:**
```json
{ "success": false, "message": "Account number must be exactly 10 digits" }
{ "success": false, "message": "Only companies can setup bank accounts" }
{ "success": false, "message": "Account number and account name are required" }
```

---

### Company Bank Setup Screen

```
┌─────────────────────────────────────┐
│        Bank Account Setup           │
│                                     │
│  This is where your delivery        │
│  payments will be sent.             │
│                                     │
│  Bank                               │
│  [Select Bank ▼]                    │
│   → loads from GET /api/payments/banks
│                                     │
│  Account Number                     │
│  [7043995559        ]               │
│  (10 digits)                        │
│                                     │
│  Account Name                       │
│  [AUWALU MUHAMMAD IZZIDDIN]         │
│  (as registered with your bank)     │
│                                     │
│       [Save Bank Account]           │
│                                     │
│  ⚠️  Payments will be sent here     │
│  after each delivery is confirmed.  │
└─────────────────────────────────────┘
```

**Frontend logic:**
```
onLoad:
  banks = await GET /api/payments/banks
  populate bank dropdown with banks.data

onSave:
  selectedBank = banks.find(b => b.name === selectedBankName)
  
  POST /api/payments/company/setup-bank-account
  {
    accountNumber: input.accountNumber,
    accountName: input.accountName,
    bankCode: selectedBank.code
  }
  
  if success → show "Bank account saved!" → go to dashboard
  if error   → show error message
```

---

## Part 2 — Customer Delivery Confirmation & Payment Settlement

### When to show this screen
When `delivery.status === "delivered"` — the driver has marked the delivery as done.

The customer must confirm they received the package. This triggers the automatic bank transfer to the company.

---

### The Confirmation Screen

```
┌─────────────────────────────────────┐
│      📦 Package Delivered!          │
│                                     │
│  Your package has been delivered    │
│  by Musa Ibrahim.                   │
│                                     │
│  Please confirm you received it     │
│  to release payment to the company. │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ★ ★ ★ ★ ★  Rate delivery  │    │
│  │  [tap to rate 1-5 stars]    │    │
│  └─────────────────────────────┘    │
│                                     │
│  Review (optional)                  │
│  [Fast and careful delivery...]     │
│                                     │
│  Payment: ₦1,300                    │
│  Goes to: Swift Riders Ltd          │
│                                     │
│   [✅ Yes, I received my package]   │
│                                     │
│   [❌ I did not receive it]         │
│      → opens support/dispute        │
└─────────────────────────────────────┘
```

---

### Step 1 — Confirm Delivery & Trigger Payout

```
POST /api/payments/complete-and-settle/:deliveryId
Authorization: Bearer <customer_token>
```

```json
{
  "verified": true,
  "review": "Fast and careful delivery!"
}
```

**Success response:**
```json
{
  "success": true,
  "message": "Delivery verified and payment settled successfully!",
  "data": {
    "deliveryId": "64f...",
    "paymentId": "64f...",
    "status": "completed",
    "review": "Fast and careful delivery!",
    "settlement": {
      "success": true,
      "companyReceived": "₦1,170",
      "platformFee": "₦130",
      "settledAt": "2024-01-15T10:30:00.000Z",
      "transferStatus": "NEW"
    }
  }
}
```

**What `transferStatus` means:**
| Value | Meaning |
|-------|---------|
| `NEW` | Transfer accepted by Flutterwave, processing |
| `SUCCESSFUL` | Money already in company account |
| `FAILED` | Transfer failed — support will handle manually |

**Error responses:**
```json
{ "success": false, "message": "Please confirm that you received the delivery" }
{ "success": false, "message": "Delivery must be completed before verification. Current status: assigned" }
{ "success": false, "message": "Payment not found or not successful" }
```

---

### Step 2 — After Confirmation Screen

```
┌─────────────────────────────────────┐
│         ✅ All Done!                │
│                                     │
│  Your delivery is complete.         │
│                                     │
│  Payment Summary                    │
│  ─────────────────────────────      │
│  Total paid:      ₦1,300            │
│  Company gets:    ₦1,170  (90%)     │
│  Platform fee:    ₦130    (10%)     │
│                                     │
│  Transfer sent to:                  │
│  Swift Riders Ltd                   │
│                                     │
│       [Back to Home]                │
│       [View Receipt]                │
└─────────────────────────────────────┘
```

---

### Frontend Logic — Full Confirmation Flow

```
// 1. Check delivery status on active delivery screen
const delivery = await GET /api/deliveries/customer/active

if (delivery.status === 'delivered') {
  showConfirmationScreen(delivery)
}

// 2. User taps "Yes, I received my package"
async function confirmDelivery(deliveryId, rating, review) {
  
  // First confirm delivery + trigger payout
  const result = await POST /api/payments/complete-and-settle/:deliveryId
  {
    verified: true,
    review: review
  }
  
  if (result.success) {
    // Show success screen with settlement info
    showSuccessScreen(result.data.settlement)
    
    // Optionally also submit rating separately
    if (rating) {
      await POST /api/deliveries/:deliveryId/rate
      { rating: rating, review: review }
    }
    
    navigate('Home')
    
  } else {
    showError(result.message)
  }
}

// 3. User taps "I did not receive it"
function reportIssue(deliveryId) {
  // Open support/dispute screen
  // Do NOT call complete-and-settle
  navigate('Support', { deliveryId, issue: 'not_received' })
}
```

---

## Part 3 — What Happens After Confirmation

```
Customer taps "I received it"
         ↓
POST /api/payments/complete-and-settle/:deliveryId
         ↓
Backend checks:
  ✅ delivery.status === "delivered"
  ✅ payment.status === "successful"
  ✅ company.bankAccount is configured
         ↓
Flutterwave transfer fires:
  ├── 90% → Company bank account (e.g. ₦1,170)
  └── 10% → Stays in your Flutterwave balance (e.g. ₦130)
         ↓
Notifications sent:
  → Customer: "Payment released to Swift Riders Ltd"
  → Company:  "₦1,170 transferred to your bank account"
  → Driver:   "Delivery completed & payment settled"
         ↓
delivery.status = "completed"
payment.escrowDetails.settledToCompany = true
```

---

## Part 4 — Settlement Failure Handling

If the company has no bank account set up, settlement fails. The delivery is still marked complete but money stays in your Flutterwave balance.

**Response when settlement fails:**
```json
{
  "success": false,
  "message": "Delivery verified but automatic settlement failed",
  "data": {
    "deliveryId": "64f...",
    "deliveryStatus": "completed",
    "settlement": {
      "success": false,
      "error": "Company bank code not configured",
      "companyAmount": 1170,
      "requiresAction": "Contact support to complete manual settlement"
    }
  }
}
```

**Frontend — handle settlement failure gracefully:**
```
if (result.data.settlement.success === false) {
  // Delivery is still complete — don't block the user
  showMessage(
    "Delivery confirmed! Payment will be processed within 24 hours.",
    "Our team will ensure the company receives their payment."
  )
  navigate('Home')
}
```

---

## Part 5 — Company Payments Dashboard

Company can view all their payments and settlement history:

```
GET /api/payments/company-payments
Authorization: Bearer <company_token>
```

Query params (all optional):
- `status` — `all` | `pending` | `successful` | `failed`
- `settlementStatus` — `all` | `pending` | `settled`
- `startDate` — `2024-01-01`
- `endDate` — `2024-01-31`
- `page` — default `1`
- `limit` — default `10`

**Response:**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "_id": "64f...",
        "amount": 1300,
        "companyAmount": 1170,
        "platformFee": 130,
        "status": "successful",
        "escrowStatus": "settled",
        "paidAt": "2024-01-15T10:30:00.000Z",
        "settledAt": "2024-01-15T11:00:00.000Z",
        "paymentMethod": "bank_transfer_dedicated",
        "customer": { "name": "John Doe", "phone": "+2348012345678" },
        "delivery": {
          "referenceId": "RID-1234-ABCD",
          "pickup": "Victoria Island, Lagos",
          "dropoff": "Lekki Phase 1, Lagos"
        }
      }
    ],
    "summary": {
      "totalEarnings": 45000,
      "totalTransactions": 38,
      "settledAmount": 40000,
      "pendingAmount": 5000,
      "pendingSettlements": 4
    },
    "pagination": {
      "total": 38,
      "page": 1,
      "limit": 10,
      "pages": 4
    }
  }
}
```

---

## Quick Reference

| Action | Method | Endpoint | Who |
|--------|--------|----------|-----|
| Get bank list | GET | `/api/payments/banks` | Company |
| Setup bank account | POST | `/api/payments/company/setup-bank-account` | Company |
| Confirm delivery + payout | POST | `/api/payments/complete-and-settle/:deliveryId` | Customer |
| View company payments | GET | `/api/payments/company-payments` | Company |
| View settlement detail | GET | `/api/payments/company-settlements/:paymentId` | Company |

---

## Important Notes

1. **Company must set bank account before any settlement can happen.** Add this as a required step in company onboarding.

2. **Settlement only triggers when customer confirms.** Money stays in Flutterwave escrow until then — this protects the customer.

3. **In test mode**, Flutterwave transfers are simulated. Use live keys for real transfers.

4. **Bank codes are fixed** — always fetch from `GET /api/payments/banks` rather than hardcoding them.

5. **10% platform fee** is configured in `.env` as `PLATFORM_FEE_PERCENTAGE=10`. Change this to adjust your commission.
