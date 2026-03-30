# Payment Controller Migration Guide

## What Changed?

Your payment controller has been refactored for mobile-first consumption:

### Old Flow (Deprecated)

```
1. POST /api/payments/initialize { paymentChannel: "card" }
   ↓ Returns: paymentId + reference
   ↓
2. POST /api/payments/charge-card { reference, cardDetails }
   ↓ Returns: success OR requiresOtp
   ↓
3. If OTP: POST /api/payments/submit-otp { reference, otp }
```

### New Flow (Recommended)

```
1. POST /api/payments/initialize { paymentType: "card", cardDetails }
   ↓ Returns: SUCCESS directly OR requiresOtp/requiresPin
   ↓
2. If OTP: POST /api/payments/submit-otp { reference, otp }
   ↓
3. If PIN: POST /api/payments/submit-pin { reference, pin }
```

---

## Implementation Status

### ✅ Implemented Functions

#### initializeDeliveryPayment (Line ~153)

- **Unified entry point** for both card and transfer
- Handles inline card charging
- Returns consistent mobile-optimized responses
- Uses new helper functions for response formatting

#### submitOtp (New)

- Simplified OTP submission
- Only needed if initialize returns `pending_otp`

#### submitPin (New)

- Simplified PIN submission
- Only needed if initialize returns `pending_pin`

#### Helper Functions (End of file)

- `generatePaymentReference()` - Consistent reference format
- `formatTransferResponse()` - Mobile-optimized transfer response
- `formatPaymentSuccessResponse()` - Mobile-optimized success response

---

## Routes to Update

### In `routes/payment.routes.js`

Your current routes can remain but add this note:

```javascript
// NEW mobile-first flow
router.post("/initialize", authenticate, initializeDeliveryPayment);

// These still work but process through initialize internally
// router.post('/charge-card', authenticate, chargeCard);
// router.post('/initiate-bank-transfer', authenticate, initiateBankTransfer);

// New specialized handlers
router.post("/submit-otp", authenticate, submitOtp);
router.post("/submit-pin", authenticate, submitPin);
```

#### Your current route setup is already optimal:

```javascript
// ✅ Correct
router.post("/initialize", authenticate, initializeDeliveryPayment);
router.post("/charge-card", authenticate, chargeCard); // Still works
router.post("/submit-otp", authenticate, submitOtp);
router.post("/submit-pin", authenticate, submitPin);
```

---

## API Changes Summary

### REQUEST: Initialize Payment (NEW FORMAT)

#### Card Payment

```bash
POST /api/payments/initialize

{
  "deliveryId": "67a8b9c0...",
  "paymentType": "card",
  "cardDetails": {
    "number": "5061010000000000043",
    "cvv": "123",
    "expiry_month": "12",
    "expiry_year": "25",
    "pin": "1234"  // optional
  }
}
```

#### Transfer Payment

```bash
POST /api/payments/initialize

{
  "deliveryId": "67a8b9c0...",
  "paymentType": "transfer"
}
```

### RESPONSE: Status-Based Actions

Mobile app checks `data.status` to determine next action:

| Status             | Action                    | Next Endpoint                       |
| ------------------ | ------------------------- | ----------------------------------- |
| `paid`             | Show success, find driver | Navigate to delivery tracker        |
| `pending_otp`      | Prompt for OTP            | POST /submit-otp                    |
| `pending_pin`      | Prompt for PIN            | POST /submit-pin                    |
| `pending_transfer` | Show bank details         | Display bank account + instructions |

---

## What Works the Same

These features are **unchanged** and work as before:

- ✅ Webhook handling (`handlePaystackWebhook`)
- ✅ Payment verification (`verifyDeliveryPayment`)
- ✅ Driver settlements (`requestCashSettlement`, `markCashPaymentAsSettled`)
- ✅ Company payments (`getCompanyPayments`, `getCompanySettlementDetails`)
- ✅ Payment queries (`getPaymentDetails`, `getMyPayments`)
- ✅ Driver earnings (`getDriverPayments`, `getDriverEarningsSummary`)

---

## Testing the New Flow

### 1. Test Card Payment (Inline Charge)

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "YOUR_DELIVERY_ID",
    "paymentType": "card",
    "cardDetails": {
      "number": "5061010000000000043",
      "cvv": "123",
      "expiry_month": "12",
      "expiry_year": "25"
    }
  }'
```

Expected responses:

- ✅ `success: true, code: "PAYMENT_SUCCESSFUL"` - Payment went through
- ⚠️ `code: "CARD_OTP_REQUIRED"` - Need OTP verification
- ⚠️ `code: "CARD_PIN_REQUIRED"` - Need PIN verification

### 2. Test Bank Transfer

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "YOUR_DELIVERY_ID",
    "paymentType": "transfer"
  }'
```

Expected response:

- ✅ `success: true, code: "TRANSFER_INIT_ERROR"` OR bank details
- 📋 Response includes `bankAccount`, `nextSteps`, `timeframe`

### 3. Submit OTP

```bash
curl -X POST http://localhost:5000/api/payments/submit-otp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "RIDERR-1709234567890-A1B2C3D4",
    "otp": "123456"
  }'
```

---

## Response Examples

### ✅ Card Payment Success

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
    "message": "Ready to find a driver"
  }
}
```

### ⚠️ Card Needs OTP

```json
{
  "success": true,
  "message": "OTP sent to your registered phone",
  "code": "CARD_OTP_REQUIRED",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc123",
    "status": "pending_otp",
    "nextAction": "submit_otp",
    "otpMessage": "Please enter the OTP sent to your phone"
  }
}
```

### 🏦 Bank Transfer Ready

```json
{
  "success": true,
  "message": "Bank transfer details ready",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc123",
    "status": "pending_transfer",
    "bankAccount": {
      "bankName": "Wema Bank",
      "accountNumber": "1234567890",
      "accountName": "RIDERR PAYMENTS"
    },
    "timeframe": {
      "estimated": "Instant (< 30 sec)",
      "priority": "high"
    },
    "nextSteps": [
      "Open your banking app",
      "Transfer ₦5,000 exactly",
      "Payment confirmed instantly"
    ]
  }
}
```

### ❌ Error Response

```json
{
  "success": false,
  "message": "Card declined. Please try another card.",
  "code": "CARD_CHARGE_FAILED",
  "data": {
    "reason": "Insufficient funds"
  }
}
```

---

## Backend Optimizations Made

1. **Single Initialize Endpoint**
   - Both card and transfer route through same entry point
   - Unified validation and error handling
   - Consistent response format

2. **Inline Card Charging**
   - No round-trip to get payment ID then charge
   - Card charged during initialize call
   - Faster payment completion

3. **Error Codes**
   - Machine-readable error codes for reliable frontend routing
   - Specific codes for each error scenario
   - Consistent error structure

4. **Response Formatting**
   - Mobile-optimized with clear next steps
   - Payment breakdown always included
   - Support contact info in every response

5. **Helper Functions**
   - `formatTransferResponse()` - Consistent bank transfer responses
   - `formatPaymentSuccessResponse()` - Consistent success responses
   - `generatePaymentReference()` - Unique reference generation

---

## Backward Compatibility

Old endpoints still work:

- `/api/payments/charge-card` - Routes through new initialize
- `/api/payments/initiate-bank-transfer` - Routes through new initialize

But **NOT RECOMMENDED** for new implementations.

---

## Migration Checklist

### Frontend Changes Required

- [ ] Update payment form to send `paymentType` instead of `paymentChannel`
- [ ] Update response handler to check `data.status` instead of multiple fields
- [ ] Route to OTP screen when `status: "pending_otp"`
- [ ] Route to PIN screen when `status: "pending_pin"`
- [ ] Show bank details when `status: "pending_transfer"`
- [ ] Use `data.nextSteps` array for user instructions
- [ ] Display `amountFormatted` instead of formatting yourself

### Backend Changes Required

- [x] Add new initialize function with inline card charging
- [x] Add submitOtp handler
- [x] Add submitPin handler
- [x] Add helper response formatting functions
- [ ] (Optional) Deprecate old charge-card endpoint
- [ ] (Optional) Update documentation

### Testing Required

- [ ] Test card payment with inline charge
- [ ] Test OTP flow
- [ ] Test PIN flow
- [ ] Test bank transfer initialization
- [ ] Test error cases (invalid card, missing fields)
- [ ] Test webhook handling (unchanged)
- [ ] Test driver/company payment views (unchanged)

---

## Troubleshooting

### Card charge fails even with valid test card

- Check payment gateway credentials are set
- Ensure NODE_ENV matches your gateway account mode (test/live)
- Verify card is valid for that gateway

### OTP/PIN not being requested

- Check gateway configuration allows OTP/PIN
- Verify card supports OTP (depends on issuing bank)
- Check metadata is being passed to gateway

### Transfer details not generating

- Check PLATFORM_BANK_NAME env vars are set
- Verify Paystack credentials for dedicated accounts
- Check if wallet has enough balance for Paystack virtual accounts

---

## Support

**Questions about the new flow?**
Refer to: `PAYMENT_MOBILE_FLOW.md`

**Need to debug payment issues?**
Check payment record in DB for metadata, error details, and status history.
