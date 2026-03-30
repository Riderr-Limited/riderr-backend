# Mobile-First Payment Integration Guide

## Overview

The payment system has been rewritten with a **single, unified `/api/payments/initialize` endpoint** that handles both card and bank transfer payments with consistent, mobile-optimized responses.

---

## Key Changes

### ✅ What's New

- **Single Init Endpoint**: One endpoint handles both card & transfer flows
- **Inline Card Charging**: Card payments are charged immediately within the initialize call
- **Consistent Responses**: All payment types return consistent, mobile-friendly format
- **Error Codes**: Structured error handling with specific error codes
- **Clear Next Steps**: Mobile UI knows exactly what to do next

### ❌ What's Deprecated

- `/api/payments/charge-card` - **NO LONGER NEEDED** (card charging is inline)
- `/api/payments/initiate-bank-transfer` - **NO LONGER NEEDED** (use `/initialize` with paymentType)
- Separate card charge endpoints

---

## Payment Flow

### **1. Card Payment Flow**

#### Step 1: Initialize Card Payment

```bash
POST /api/payments/initialize
Content-Type: application/json
Authorization: Bearer {token}

{
  "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
  "paymentType": "card",
  "cardDetails": {
    "number": "5061010000000000043",
    "cvv": "123",
    "expiry_month": "12",
    "expiry_year": "25",
    "pin": "1234"  // Optional, for Nigerian cards
  }
}
```

#### Response: Card Charged Successfully

```json
{
  "success": true,
  "message": "Payment successful!",
  "code": "PAYMENT_SUCCESSFUL",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc123",
    "reference": "RIDERR-1709234567890-A1B2C3D4",
    "amount": 5000,
    "amountFormatted": "₦5,000",
    "status": "paid",
    "paidAt": "2024-03-30T10:30:00Z",
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "message": "Ready to find a driver"
  }
}
```

#### Response: OTP Required

```json
{
  "success": true,
  "message": "OTP sent to your registered phone",
  "code": "CARD_OTP_REQUIRED",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc123",
    "reference": "RIDERR-1709234567890-A1B2C3D4",
    "amount": 5000,
    "status": "pending_otp",
    "nextAction": "submit_otp",
    "otpMessage": "Please enter the OTP sent to your phone"
  }
}
```

#### Step 2: If OTP Required → Submit OTP

```bash
POST /api/payments/submit-otp
Authorization: Bearer {token}

{
  "reference": "RIDERR-1709234567890-A1B2C3D4",
  "otp": "123456"
}
```

#### Step 3: If PIN Required → Submit PIN

```bash
POST /api/payments/submit-pin
Authorization: Bearer {token}

{
  "reference": "RIDERR-1709234567890-A1B2C3D4",
  "pin": "1234"
}
```

---

### **2. Bank Transfer Payment Flow**

#### Step 1: Initialize Bank Transfer

```bash
POST /api/payments/initialize
Content-Type: application/json
Authorization: Bearer {token}

{
  "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
  "paymentType": "transfer"
}
```

#### Response: Bank Details Generated

```json
{
  "success": true,
  "message": "Bank transfer details ready",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc123",
    "reference": "RIDERR-1709234567890-A1B2C3D4",
    "amount": 5000,
    "amountFormatted": "₦5,000",
    "paymentType": "transfer",
    "status": "pending_transfer",
    "bankAccount": {
      "bankName": "Wema Bank",
      "accountNumber": "1234567890",
      "accountName": "RIDERR PAYMENTS",
      "narration": "Not required"
    },
    "timeframe": {
      "estimated": "Instant (< 30 sec)",
      "type": "dedicated_virtual",
      "priority": "high"
    },
    "nextSteps": [
      "Open your banking app",
      "Transfer ₦5,000 exactly",
      "Payment confirmed instantly",
      "You'll get notification immediately"
    ],
    "breakdown": {
      "total": 5000,
      "platformFee": 500,
      "companyAmount": 4500
    },
    "support": {
      "whatsapp": "+234 800 000 0000",
      "email": "support@riderr.com"
    }
  }
}
```

---

## Response Format (Mobile Optimized)

### Success Response Structure

```json
{
  "success": true,
  "message": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "data": {
    "paymentId": "...",
    "reference": "RIDERR-XXX...",
    "amount": 5000,
    "amountFormatted": "₦5,000",
    "status": "paid|pending_otp|pending_pin|pending_transfer|...",
    "nextAction": "submit_otp|submit_pin|confirm_transfer|...",
    "breakdown": {
      /* payment breakdown */
    },
    "nextSteps": [
      /* clear instructions */
    ]
  }
}
```

### Error Response Structure

```json
{
  "success": false,
  "message": "User-friendly error message",
  "code": "ERROR_CODE",
  "error": "Technical details (dev only)",
  "data": {
    /* relevantdata if any */
  }
}
```

---

## Error Codes Reference

| Code                      | HTTP | Meaning                               | Action                        |
| ------------------------- | ---- | ------------------------------------- | ----------------------------- |
| `INVALID_PAYMENT_TYPE`    | 400  | Payment type not 'card' or 'transfer' | Show payment method selector  |
| `DELIVERY_NOT_FOUND`      | 404  | Delivery doesn't exist                | Verify delivery ID            |
| `INVALID_DELIVERY_STATUS` | 400  | Delivery not in 'created' status      | Cannot pay for this delivery  |
| `PAYMENT_EXISTS`          | 400  | Payment already initialized           | Reuse existing payment        |
| `CARD_DETAILS_INCOMPLETE` | 400  | Missing card fields                   | Prompt user for all card info |
| `CARD_CHARGE_FAILED`      | 400  | Card declined/failed                  | Show error, ask to retry      |
| `CARD_OTP_REQUIRED`       | 200  | OTP needed                            | Route to OTP input screen     |
| `CARD_PIN_REQUIRED`       | 200  | PIN needed                            | Route to PIN input screen     |
| `PAYMENT_SUCCESSFUL`      | 200  | Payment completed                     | Show success, find driver     |
| `TRANSFER_INIT_ERROR`     | 500  | Transfer setup failed                 | Show bank details or retry    |

---

## Mobile UI Implementation Examples

### React/React Native Example

```javascript
// Initialize payment
async function initializePayment(deliveryId, paymentType, cardDetails) {
  try {
    const response = await fetch("/api/payments/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deliveryId,
        paymentType,
        cardDetails,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      Alert.alert("Payment Failed", result.message);
      return;
    }

    // Handle based on status
    switch (result.data.status) {
      case "paid":
        // Show success
        navigateTo("DeliveryTracker", { deliveryId });
        break;

      case "pending_otp":
        // Go to OTP screen
        navigateTo("EnterOTP", {
          reference: result.data.reference,
          amount: result.data.amountFormatted,
        });
        break;

      case "pending_transfer":
        // Go to bank transfer screen
        navigateTo("BankTransfer", {
          reference: result.data.reference,
          bankAccount: result.data.bankAccount,
          nextSteps: result.data.nextSteps,
          timeframe: result.data.timeframe,
        });
        break;
    }
  } catch (error) {
    Alert.alert("Error", "Failed to initialize payment");
  }
}

// Submit OTP
async function submitOTP(reference, otp) {
  const response = await fetch("/api/payments/submit-otp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reference, otp }),
  });

  const result = await response.json();
  if (result.success) {
    navigateTo("DeliveryTracker");
  } else {
    Alert.alert("OTP Failed", result.message);
  }
}
```

---

## Backward Compatibility

The old endpoints still work for now, but they're handled through the main initialize function:

- Old: `POST /payments/charge-card` → Now: Use `/initialize` with cardDetails in first call
- Old: `POST /payments/initiate-bank-transfer` → Now: Use `/initialize` with paymentType='transfer'

**Recommendation**: Update mobile app to use new unified endpoint for cleaner flow.

---

## Payment Breakdown

All payments show clear breakdown:

```json
"breakdown": {
  "total": 5000,           // Total amount
  "platformFee": 500,      // Platform fee (10%)
  "companyAmount": 4500    // Company receives (90%)
}
```

---

## Support Resources

- **Dedicated Virtual Transfer**: Instant confirmation (< 30 seconds)
- **Company Bank Account**: 5-10 minutes
- **Manual Bank Transfer**: 5-30 minutes (requires screenshot)

Support contact in every response for customer reference.

---

## Environment Variables Required

```env
# Payment Gateway
PAYMENT_PROVIDER=paystack          # or flutterwave
PAYSTACK_PUBLIC_KEY=pk_...
PAYSTACK_SECRET_KEY=sk_...

# Fallback Bank Account
PLATFORM_BANK_NAME=Zenith Bank
PLATFORM_ACCOUNT_NUMBER=1234567890
PLATFORM_ACCOUNT_NAME=RIDERR TECHNOLOGIES LTD

# Support Contact
SUPPORT_EMAIL=support@riderr.com
SUPPORT_PHONE=+234 800 000 0000
SUPPORT_WHATSAPP=+234 800 000 0000
```

---

## Testing Payment Flow

### Test Card

- Number: `5061010000000000043`
- CVV: `123`
- Expiry: `12/25`
- PIN: `1234` (optional)

### Test Transfer

- Use test mode with Paystack test account
- Dedicated virtual accounts created in test mode

---

## Metrics to Track

1. **Payment Success Rate**: Successful / Total Initiated
2. **Payment Method Split**: Card vs Transfer
3. **Avg Time to Payment**: From init to success
4. **Failure Reasons**: OTP failures, card declines, etc.
5. **Retry Rate**: How many retries per payment

---

## FAQ

**Q: Why card charging is inline instead of separate?**
A: Mobile users expect single-request flow. Inline charging = better UX, fewer network calls, faster payment.

**Q: What if user doesn't have card details ready?**
A: They can call /initialize without cardDetails first, system returns paymentId, then they add details later.

**Q: Why different transfer timeframes?**
A: Priority system accounts for different bank account types with different verification speeds.

**Q: Can I use old endpoints?**
A: Old endpoints still work but deprecated. New endpoint is recommended for better UX.
