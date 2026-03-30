# Payment Integration - Quick Reference

## 🎯 The One Endpoint You Need

```bash
POST /api/payments/initialize
```

**That's it.** Everything goes through here.

---

## 📋 Card Payment (One-Step)

### Request

```javascript
{
  "deliveryId": "xyz",
  "paymentType": "card",
  "cardDetails": {
    "number": "5061010000000000043",
    "cvv": "123",
    "expiry_month": "12",
    "expiry_year": "25"
  }
}
```

### Response Cases

#### Success

```javascript
{
  success: true,
  code: "PAYMENT_SUCCESSFUL",
  data: { status: "paid", deliveryId: "xyz", amount: 5000 }
}
```

→ **Action**: Show success, find driver

#### Needs OTP

```javascript
{
  success: true,
  code: "CARD_OTP_REQUIRED",
  data: { status: "pending_otp", reference: "RIDERR-..." }
}
```

→ **Action**: Call `POST /submit-otp` with OTP code

#### Needs PIN

```javascript
{
  success: true,
  code: "CARD_PIN_REQUIRED",
  data: { status: "pending_pin", reference: "RIDERR-..." }
}
```

→ **Action**: Call `POST /submit-pin` with PIN code

---

## 🏦 Bank Transfer (One-Step)

### Request

```javascript
{
  "deliveryId": "xyz",
  "paymentType": "transfer"
}
```

### Response

```javascript
{
  success: true,
  data: {
    status: "pending_transfer",
    bankAccount: {
      bankName: "Wema Bank",
      accountNumber: "1234567890",
      accountName: "RIDERR",
      narration: "Not required"
    },
    nextSteps: [
      "Open banking app",
      "Transfer ₦5,000",
      "Payment confirmed instantly"
    ],
    timeframe: {
      estimated: "Instant (< 30 sec)",
      priority: "high"
    }
  }
}
```

→ **Action**: Display bank account & instructions, show countdown timer

---

## 🔐 OTP/PIN Submission

### Submit OTP

```javascript
POST /api/payments/submit-otp
{ reference: "RIDERR-...", otp: "123456" }
```

### Submit PIN

```javascript
POST /api/payments/submit-pin
{ reference: "RIDERR-...", pin: "1234" }
```

Both return `success: true, data: { status: "paid" }` on success.

---

## ✅ Status Values (What to Show)

| Status                 | What It Means           | What to Do                |
| ---------------------- | ----------------------- | ------------------------- |
| `paid`                 | ✅ Done                 | Show success, find driver |
| `pending_otp`          | 🔐 Waiting for OTP      | Prompt for OTP code       |
| `pending_pin`          | 🔐 Waiting for PIN      | Prompt for PIN code       |
| `pending_transfer`     | 🏦 Waiting for transfer | Show bank details         |
| `pending_card_details` | 💳 Missing card         | Show card form            |

---

## 🚨 Error Codes (What Can Go Wrong)

| Code                      | What to Do              |
| ------------------------- | ----------------------- |
| `CARD_CHARGE_FAILED`      | Show error, retry       |
| `INVALID_PAYMENT_TYPE`    | You selected wrong type |
| `DELIVERY_NOT_FOUND`      | Invalid delivery ID     |
| `PAYMENT_EXISTS`          | Payment already started |
| `CARD_DETAILS_INCOMPLETE` | Enter all card fields   |

---

## 📱 Mobile Implementation (React Example)

```javascript
// 1. INITIALIZE
async function payWithCard(cardDetails) {
  const res = await fetch("/api/payments/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      deliveryId,
      paymentType: "card",
      cardDetails,
    }),
  });

  const data = await res.json();

  // 2. ROUTE BASED ON STATUS
  switch (data.data.status) {
    case "paid":
      navigation.navigate("Success");
      break;
    case "pending_otp":
      navigation.navigate("EnterOTP", { ref: data.data.reference });
      break;
    case "pending_pin":
      navigation.navigate("EnterPIN", { ref: data.data.reference });
      break;
    default:
      Alert.alert("Error", data.message);
  }
}

// 3. HANDLE OTP
async function submitOTP(reference, otp) {
  const res = await fetch("/api/payments/submit-otp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reference, otp }),
  });

  if (res.ok) {
    navigation.navigate("Success");
  } else {
    Alert.alert("OTP Failed", "Please try again");
  }
}
```

---

## 🏦 Bank Transfer Flow

```javascript
async function payWithTransfer() {
  const res = await fetch("/api/payments/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      deliveryId,
      paymentType: "transfer",
    }),
  });

  const data = await res.json();
  const { bankAccount, nextSteps, timeframe } = data.data;

  // Display to user
  return {
    account: bankAccount.accountNumber,
    bank: bankAccount.bankName,
    amount: `₦5,000`,
    instructions: nextSteps,
    timeToConfirm: timeframe.estimated,
  };
}
```

---

## 📊 Response Format (Always)

```javascript
{
  success: boolean,
  message: string,              // Human readable
  code: string,                 // Machine readable
  error?: string,               // Dev only
  data: {
    status: string,             // What to do next
    reference: string,          // Unique ID
    amount: number,
    amountFormatted: string,    // "₦5,000"
    breakdown: {
      total, platformFee, companyAmount
    },
    nextSteps: string[],        // Step-by-step instructions
    support?: {
      email, whatsapp, phone
    }
    // + payment-type-specific fields
  }
}
```

---

## 🧪 Test Cards

| Purpose | Number              | CVV | Expiry |
| ------- | ------------------- | --- | ------ |
| Success | 5061010000000000043 | 123 | 12/25  |
| OTP     | (depends on bank)   | 123 | 12/25  |
| Decline | Use any other card  | 123 | 12/25  |

---

## ⚡ Environment Setup

```env
PAYMENT_PROVIDER=paystack
PAYSTACK_PUBLIC_KEY=pk_test_...
PAYSTACK_SECRET_KEY=sk_test_...

PLATFORM_BANK_NAME=Zenith Bank
PLATFORM_ACCOUNT_NUMBER=1234567890
PLATFORM_ACCOUNT_NAME=RIDERR TECH

SUPPORT_WHATSAPP=+234800000000
SUPPORT_EMAIL=support@riderr.com
```

---

## 🔧 Debugging

### Check Payment Record

```javascript
// In MongoDB
db.payments.findOne({ paystackReference: "RIDERR-..." });
```

### Look for

- `status`: Current state
- `metadata`: Debug info
- `paymentMethod`: card vs transfer
- `error`: Any error message

---

## 📈 What to Monitor

1. **Success Rate** → Should be > 95%
2. **Payment Method Split** → Card vs Transfer usage
3. **Failure Reasons** → Card declines, transfer delays, etc.
4. **Response Times** → Latency monitoring

---

## 🎓 Full Docs

For complete documentation, see:

- `PAYMENT_MOBILE_FLOW.md` - Full API reference
- `PAYMENT_MIGRATION_GUIDE.md` - Implementation guide
- `PAYMENT_CONTROLLER_REWRITE.md` - Architecture overview

---

## ⏱️ Typical Timeframes

| Method             | Time           |
| ------------------ | -------------- |
| Card (instant)     | < 1 second     |
| Card (with OTP)    | User-dependent |
| Transfer (virtual) | Instant        |
| Transfer (manual)  | 5-30 minutes   |

---

## 💡 Tips

✅ Always check `data.status` to know what to do next
✅ Store `reference` for follow-ups
✅ Show `nextSteps` array to user
✅ Include `support` info in error messages
✅ Format amounts using `amountFormatted`
✅ Handle errors based on `code`, not message text

---

**Ready? → POST to `/api/payments/initialize` 🚀**
