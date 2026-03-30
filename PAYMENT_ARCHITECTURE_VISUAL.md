# Payment System Architecture - Visual Guide

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          MOBILE APP                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Payment Selection                                           │ │
│  │ ┌──────────────┐              ┌──────────────┐            │ │
│  │ │ 💳 Card      │              │ 🏦 Transfer  │            │ │
│  │ └──────────────┘              └──────────────┘            │ │
│  └──────────┬─────────────────────────────────┬──────────────┘ │
│             │                                 │                 │
│ ┌───────────▼───────────┐       ┌────────────▼─────────────┐  │
│ │ Card Details Form     │       │ Transfer Init Screen     │  │
│ │ - Card Number         │       │ (No user input needed)   │  │
│ │ - CVV                 │       │                          │  │
│ │ - Expiry              │       │                          │  │
│ │ - PIN (optional)      │       │                          │  │
│ └───────────┬───────────┘       └────────────┬─────────────┘  │
│             │                                 │                 │
│ ┌───────────▼─────────────────────────────────▼─────────────┐  │
│ │  POST /api/payments/initialize                           │  │
│ │  { deliveryId, paymentType, cardDetails? }               │  │
│ └───────────┬──────────────────────────────────────────────┘  │
└─────────────┼─────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BACKEND - Main Endpoint                     │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  initializeDeliveryPayment()                                │ │
│  │                                                             │ │
│  │  1. Validate customer role                                 │ │
│  │  2. Validate payment type ('card' | 'transfer')            │ │
│  │  3. Find delivery                                          │ │
│  │  4. Check for existing payment                             │ │
│  │  5. Calculate amounts (total, fee, company)                │ │
│  │  6. Generate unique reference                              │ │
│  │  7. Route to type-specific handler                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────────────────────┬──────────────────────────────┐ │
│  │                              │                              │ │
│  ▼  CARD PATH                   ▼  TRANSFER PATH               │ │
│  ┌─────────────────────┐        ┌────────────────────────────┐ │
│  │ handleCardCharge    │        │ handleTransferInit         │ │
│  │ Inline()            │        │                            │ │
│  │                     │        │ 1. Generate bank details   │ │
│  │ 1. Validate card    │        │    - Try Paystack virtual  │ │
│  │ 2. Create payment   │        │    - Fallback: company acc │ │
│  │    record           │        │    - Fallback: platform    │ │
│  │ 3. Call gateway     │        │                            │ │
│  │    chargeCard()     │        │ 2. Create payment record   │ │
│  │ 4. Handle response: │        │ 3. Update delivery         │ │
│  │    - Success        │        │ 4. Return bank details     │ │
│  │    - OTP needed     │        │                            │ │
│  │    - PIN needed     │        │ Response: status =         │ │
│  │    - Error          │        │ "pending_transfer"         │
│  │                     │        │                            │
│  │ Response: status =  │        └────────────────────────────┘ │
│  │ paid | pending_otp  │                                       │ │
│  │ | pending_pin       │                                       │ │
│  └─────────────────────┘                                       │ │
│                                                                   │
│  Helper Functions:                                                │ │
│  • generateBankTransferDetails()                                  │ │
│  • formatTransferResponse()                                       │ │
│  • formatPaymentSuccessResponse()                                 │ │
└──────────────────────────────────────────────────────────────────┘
              │
              ▼
        Payment Gateway
        (Paystack/Flutterwave)
        │
        ├─→ Direct charge
        ├─→ OTP verification
        ├─→ PIN verification
        └─→ Virtual account
```

---

## 🔄 Card Payment Flow

```
MOBILE APP                          BACKEND                         GATEWAY
   │                                 │                                 │
   │ 1. User fills form              │                                 │
   │    (card, cvv, etc)             │                                 │
   │                                 │                                 │
   ├─ POST /initialize ──────────────>│                                 │
   │   {paymentType:card,            │                                 │
   │    cardDetails:{...}}           │                                 │
   │                                 │                                 │
   │                                 ├─ Validate card                 │
   │                                 ├─ Create payment record         │
   │                                 │                                 │
   │                                 ├─ gatewayChargeCard() ──────────>│
   │                                 │                                 │
   │                                 │<── Response: success/OTP/PIN ──┤
   │                                 │                                 │
   │<──── Response ──────────────────┤                                 │
   │ status: "paid" OR               │                                 │
   │ status: "pending_otp" OR        │                                 │
   │ status: "pending_pin"           │                                 │
   │                                 │                                 │
   │ If OTP needed:                  │                                 │
   ├─ POST /submit-otp ─────────────>│                                 │
   │   {reference, otp}              │                                 │
   │                                 ├─ gatewaySubmitOtp() ──────────>│
   │                                 │                                 │
   │                                 │<── Verify OTP ────────────────┤
   │                                 │                                 │
   │<──── Response ──────────────────┤                                 │
   │ status: "paid"                  │                                 │
   │                                 │                                 │
   └─ Show success                   │                                 │
      Find driver                    │                                 │
```

---

## 💰 Bank Transfer Flow

```
MOBILE APP                          BACKEND                         GATEWAY/BANK

   │                                 │                                 │
   │ 1. User selects Transfer        │                                 │
   │                                 │                                 │
   ├─ POST /initialize ──────────────>│                                 │
   │   {paymentType:transfer}        │                                 │
   │                                 │                                 │
   │                                 ├─ generateBankTransfer...()     │
   │                                 │                                 │
   │                                 ├─ Try createDedicatedAccount ──>│
   │                                 │<──── Account details ──────────┤
   │                                 │ (Or fallback to company acct)   │
   │                                 │                                 │
   │                                 ├─ Create payment record         │
   │                                 │ (status: pending_transfer)     │
   │                                 │                                 │
   │<──── Response ──────────────────┤                                 │
   │ bankAccount: {                  │                                 │
   │   bankName, accountNumber,      │                                 │
   │   accountName, narration        │                                 │
   │ }                               │                                 │
   │ nextSteps: [array]              │                                 │
   │ timeframe: "Instant"            │                                 │
   │                                 │                                 │
   │ 2. Show bank details             │                                 │
   │    & countdown timer            │                                 │
   │                                 │                                 │
   │ 3. User transfers money         │                                 │
   │    from their bank              │                                 │
   │                                 │                                 │
   │                         (Transfer happens in user's bank)        │
   │                                 │                                 │
   │                                 │<───── Webhook ─────────────────┤
   │                                 │ Transfer received & verified   │
   │                                 │ Update payment: paid           │
   │                                 │                                 │
   │<───── Notification ─────────────┤                                 │
   │ Payment confirmed!              │                                 │
   │                                 │                                 │
   └─ Show success                   │                                 │
      Find driver                    │                                 │
```

---

## 📊 Data Structure Flow

### Payment Record Created

```javascript
{
  _id: ObjectId,
  deliveryId: ObjectId,
  customerId: ObjectId,
  companyId: ObjectId,

  // Amount breakdown
  amount: 5000,           // Total amount
  currency: "NGN",
  platformFee: 500,       // 10%
  companyAmount: 4500,    // 90%

  // Payment details
  gateway: "paystack",
  gatewayReference: "RIDERR-1709234567890-A1B2C3D4",
  paymentMethod: "card" | "bank_transfer_dedicated" | ...,
  paymentType: "escrow",
  status: "successful" | "pending" | "processing" | "failed",

  // For card payments
  paidAt: Date (if successful)
  verifiedAt: Date (if verified)

  // For bank transfers
  metadata: {
    bankTransferDetails: {
      type: "dedicated_virtual" | "company_account" | "platform_account",
      bankName: "Wema Bank",
      accountNumber: "1234567890",
      accountName: "RIDERR PAYMENTS",
      narration: "Not required" | "RIDERR-REF",
      reference: "RIDERR-..."
    },
    paymentPriority: "high" | "medium" | "low",
    cardLast4?: "0043",
    requiresOtp?: true,
    requiresPin?: true,
    chargeReference?: "..."
  }
}
```

---

## 🎯 Response Status Mapping

```
USER ACTION              RESPONSE STATUS       NEXT ENDPOINT      FRONTEND ACTION
─────────────────────────────────────────────────────────────────────────────────
Card submitted           "paid"                (none)             Show success
                                                                   Find driver

Card with OTP issued     "pending_otp"         /submit-otp        Show OTP screen

Card with PIN needed     "pending_pin"         /submit-pin        Show PIN screen

OTP verified             "paid"                (none)             Show success
                                                                   Find driver

PIN verified             "paid"                (none)             Show success
                                                                   Find driver

Transfer initialized     "pending_transfer"    (none)             Show bank details
Webhook confirms                                                   notification

Bank transfer created    "pending_transfer"    (none)             Show instructions
                                                                   Countdown start

Payment info missing     "pending_card_details" (error)           Show card form
```

---

## 🔐 Security Flow

```
┌─────────────────────┐
│ Mobile App          │
│ Receives card data  │
│ from user (SSL)     │
└──────────┬──────────┘
           │ HTTPS only
           ▼
┌─────────────────────────────────────────┐
│ Backend API (/initialize)               │
│ - Validate input                        │
│ - Hash sensitive data                   │
│ - Create payment record                 │
│ - Never store full card in DB           │
└──────────┬──────────────────────────────┘
           │ Direct to gateway (no interception)
           ▼
┌─────────────────────────────────────────┐
│ Payment Gateway (Paystack/Flutterwave)  │
│ - Process charge                        │
│ - Handle OTP/PIN                        │
│ - Return only authorization             │
│ - Send webhook for confirmation         │
└──────────┬──────────────────────────────┘
           │ HTTPS + Signed Webhook
           ▼
┌──────────────────────────┐
│ Backend Webhook Handler  │
│ - Verify signature       │
│ - Verify against DB      │
│ - Update payment status  │
│ - Send notification      │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ Update Delivery          │
│ Status = "paid"          │
│ Ready for driver pickup  │
└──────────────────────────┘
```

---

## 💾 Database Transactions

```
ATOMIC TRANSACTION FOR PAYMENT

1. Start Transaction
   │
   ├─ Create Payment record
   │  (status: pending)
   │
   ├─ Update Delivery
   │  payment.status: "pending_payment"
   │
   ├─ Call Payment Gateway
   │  (external, not in transaction)
   │
   ├─ On Success:
   │  ├─ Update Payment.status = "successful"
   │  ├─ Set Payment.paidAt = now
   │  └─ Update Delivery.payment.status = "paid"
   │
   ├─ On OTP Required:
   │  ├─ Update Payment.status = "processing"
   │  └─ Set metadata.requiresOtp = true
   │
   └─ On Failure:
      ├─ Update Payment.status = "failed"
      └─ Store error reason

2. Commit Transaction
```

---

## 📈 Error Handling Flow

```
REQUEST
   │
   ▼
┌──────────────────────────┐
│ Validation Checks        │
├──────────────────────────┤
│ ✗ Invalid role          │ ──→ 403 INVALID_ROLE
│ ✗ Invalid paymentType   │ ──→ 400 INVALID_PAYMENT_TYPE
│ ✗ Delivery not found    │ ──→ 404 DELIVERY_NOT_FOUND
│ ✗ Wrong delivery status │ ──→ 400 INVALID_DELIVERY_STATUS
│ ✗ Payment exists        │ ──→ 400 PAYMENT_EXISTS
└──────────┬───────────────┘
           │ All valid
           ▼
┌──────────────────────────┐
│ Payment Gateway          │
├──────────────────────────┤
│ Card charge fails        │ ──→ 400 CARD_CHARGE_FAILED
│ OTP submission fails     │ ──→ 400 OTP_FAILED
│ PIN submission fails     │ ──→ 400 PIN_FAILED
│ Gateway error            │ ──→ 500 CHARGE_ERROR
└──────────┬───────────────┘
           │ Success
           ▼
┌──────────────────────────┐
│ Payment Successful       │
│ 200 PAYMENT_SUCCESSFUL   │
└──────────────────────────┘
```

---

## 🎨 Response Format Structure

```
┌─────────────────────────────────────────────────┐
│ Response Object (ALL responses follow this)      │
├─────────────────────────────────────────────────┤
│                                                 │
│ ✓ success: boolean                              │
│   ├─ true  → payment flow continued             │
│   └─ false → error occurred                     │
│                                                 │
│ ✓ message: string (user-friendly)               │
│   └─ "Payment successful!" | "OTP sent..." etc │
│                                                 │
│ ✓ code: string (machine-readable)               │
│   └─ "PAYMENT_SUCCESSFUL" | "CARD_OTP_REQUIRED" │
│                                                 │
│ ✓ error?: string (dev only, undefined in prod) │
│   └─ Technical error details                    │
│                                                 │
│ ✓ data: object (payload)                        │
│   ├─ paymentId: string                          │
│   ├─ reference: string (unique per payment)    │
│   ├─ amount: number                             │
│   ├─ amountFormatted: string ("₦5,000")        │
│   ├─ status: enum                               │
│   │  ├─ "paid"                                  │
│   │  ├─ "pending_otp"                           │
│   │  ├─ "pending_pin"                           │
│   │  ├─ "pending_transfer"                      │
│   │  └─ "pending_card_details"                  │
│   ├─ breakdown?: { total, platformFee, ...}    │
│   ├─ bankAccount?: { bank, account, ... }      │
│   ├─ nextSteps?: string[]  ← KEY FIELD!        │
│   ├─ timeframe?: { estimated, priority }       │
│   └─ support?: { email, whatsapp, phone }      │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 🚀 Deployment Architecture

```
┌───────────────────────┐
│   Mobile App          │
│   (iOS/Android)       │
└──────────┬────────────┘
           │ HTTPS
           ▼
┌───────────────────────────────────────┐
│   API Gateway / Load Balancer         │
├───────────────────────────────────────┤
│   Handles SSL termination              │
│   Routes to backend instances          │
└──────────┬────────────────────────────┘
           │
    ┌──────┴──────────────────────┐
    │                             │
    ▼                             ▼
┌──────────────────┐      ┌──────────────────┐
│ Backend Node 1   │      │ Backend Node 2   │
│ /initialize      │      │ /submit-otp      │
│ /submit-otp      │      │ /submit-pin      │
│ /submit-pin      │      │                  │
│ /webhook         │      │ /webhook         │
└────────┬─────────┘      └────────┬─────────┘
         │                        │
         └──────────┬─────────────┘
                    │
                    ▼
        ┌──────────────────────┐
        │  Shared Resources    │
        ├──────────────────────┤
        │ MongoDB (payments)   │
        │ Redis (cache)        │
        │ Message Queue        │
        └──────────────────────┘
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
    ┌──────────────┐    ┌──────────────┐
    │  Paystack    │    │ Flutterwave  │
    │  Gateway     │    │  Gateway     │
    └──────────────┘    └──────────────┘
```

---

## 🎯 Mobile App Integration Points

```
App Flow                    Backend Endpoint      What Happens
─────────────────────────────────────────────────────────────
1. Enter card details
   ↓
2. Click "Pay Now"
   ↓
3. POST /initialize ────→  Process card inline
   {card, amount}         ├─ Charge gateway
                          ├─ Check for OTP/PIN
                          └─ Return status
   ↓
4. Get response
   {status: "pending_otp"}
   ↓
5. Show OTP screen
   ↓
6. User enters OTP
   ↓
7. POST /submit-otp ────→  Verify with gateway
   {reference, otp}       └─ Mark as paid if ok
   ↓
8. Payment success!
   ↓
9. Navigate to driver
      assignment
```

---

This visual guide helps understand the complete payment system flow, data structures, security measures, and deployment architecture. Use this alongside the technical documentation for complete implementation guidance.
