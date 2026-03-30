# Payment API - Copy-Paste Testing Guide

## 🧪 Test Commands

### Prerequisites

```bash
# Set variables
TOKEN="your_auth_token_here"
DELIVERY_ID="your_delivery_id_here"
BASE_URL="http://localhost:5000"
```

---

## 1️⃣ Test Card Payment (Inline - Success)

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "paymentType": "card",
    "cardDetails": {
      "number": "5061010000000000043",
      "cvv": "123",
      "expiry_month": "12",
      "expiry_year": "25"
    }
  }'
```

### Expected Response (Success)

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
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "message": "Ready to find a driver"
  }
}
```

---

## 2️⃣ Test Card Payment (With OTP)

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "paymentType": "card",
    "cardDetails": {
      "number": "6280000456100234567",
      "cvv": "899",
      "expiry_month": "09",
      "expiry_year": "32"
    }
  }'
```

### Expected Response (OTP Required)

```json
{
  "success": true,
  "message": "OTP sent to your registered phone",
  "code": "CARD_OTP_REQUIRED",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc456",
    "reference": "RIDERR-1709234567890-X1Y2Z3W4",
    "amount": 5000,
    "status": "pending_otp",
    "nextAction": "submit_otp",
    "otpMessage": "Please enter the OTP sent to your phone"
  }
}
```

### Then Submit OTP

```bash
curl -X POST http://localhost:5000/api/payments/submit-otp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "RIDERR-1709234567890-X1Y2Z3W4",
    "otp": "123456"
  }'
```

---

## 3️⃣ Test Bank Transfer Payment

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "paymentType": "transfer"
  }'
```

### Expected Response (Bank Details)

```json
{
  "success": true,
  "message": "Bank transfer details ready",
  "data": {
    "paymentId": "60d5ec49c12e4a0012abc789",
    "reference": "RIDERR-1709234567890-P1Q2R3S4",
    "amount": 5000,
    "amountFormatted": "₦5,000",
    "paymentType": "transfer",
    "status": "pending_transfer",
    "bankAccount": {
      "bankName": "Wema Bank",
      "accountNumber": "1234567890123456",
      "accountName": "RIDERR PAYMENTS LTD",
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

## 4️⃣ Test Error Case (Invalid Payment Type)

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "paymentType": "invalid_type"
  }'
```

### Expected Response (Error)

```json
{
  "success": false,
  "message": "Invalid payment type",
  "code": "INVALID_PAYMENT_TYPE",
  "supportedTypes": ["card", "transfer"]
}
```

---

## 5️⃣ Test Error Case (Delivery Not Found)

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "invalid_delivery_id",
    "paymentType": "card",
    "cardDetails": {
      "number": "5061010000000000043",
      "cvv": "123",
      "expiry_month": "12",
      "expiry_year": "25"
    }
  }'
```

### Expected Response (NOT FOUND)

```json
{
  "success": false,
  "message": "Delivery not found",
  "code": "DELIVERY_NOT_FOUND"
}
```

---

## 6️⃣ Test Error Case (Missing Card Details)

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "paymentType": "card",
    "cardDetails": {
      "number": "5061010000000000043"
    }
  }'
```

### Expected Response (Validation Error)

```json
{
  "success": false,
  "message": "Complete card details required",
  "code": "CARD_DETAILS_INCOMPLETE",
  "requiredFields": ["number", "cvv", "expiry_month", "expiry_year"]
}
```

---

## 7️⃣ Test Card Without CardDetails (Get Payment ID First)

### Copy-Paste Command

```bash
curl -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
    "paymentType": "card"
  }'
```

### Expected Response (Awaiting Card)

```json
{
  "success": true,
  "message": "Ready for card payment",
  "code": "CARD_AWAITING_DETAILS",
  "requiresCardDetails": true,
  "data": {
    "paymentId": "60d5ec49c12e4a0012abcdef",
    "reference": "RIDERR-1709234567890-M1N2O3P4",
    "amount": 5000,
    "amountFormatted": "₦5,000",
    "paymentType": "card",
    "status": "pending_card_details",
    "breakdown": {
      "total": 5000,
      "platformFee": 500,
      "companyAmount": 4500
    }
  }
}
```

---

## 🧪 Using Postman

### 1. Create New Request

- Method: **POST**
- URL: `http://localhost:5000/api/payments/initialize`

### 2. Headers Tab

```
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json
```

### 3. Body Tab (Select "raw" → "JSON")

```json
{
  "deliveryId": "67a8b9c0d1e2f3g4h5i6j7k8",
  "paymentType": "card",
  "cardDetails": {
    "number": "5061010000000000043",
    "cvv": "123",
    "expiry_month": "12",
    "expiry_year": "25"
  }
}
```

### 4. Click Send

---

## 🐚 Using Shell Script

Save as `test_payment.sh`:

```bash
#!/bin/bash

# Configuration
TOKEN="your_token_here"
DELIVERY_ID="your_delivery_id_here"
BASE_URL="http://localhost:5000"

# Test 1: Card Payment
echo "=== TEST 1: Card Payment ==="
curl -X POST $BASE_URL/api/payments/initialize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "'$DELIVERY_ID'",
    "paymentType": "card",
    "cardDetails": {
      "number": "5061010000000000043",
      "cvv": "123",
      "expiry_month": "12",
      "expiry_year": "25"
    }
  }' | jq '.'

echo -e "\n\n=== TEST 2: Bank Transfer ==="
curl -X POST $BASE_URL/api/payments/initialize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryId": "'$DELIVERY_ID'",
    "paymentType": "transfer"
  }' | jq '.'
```

Run with:

```bash
chmod +x test_payment.sh
./test_payment.sh
```

---

## 📊 Response Status Quick Reference

| Status                 | Next Action       | Endpoint                      |
| ---------------------- | ----------------- | ----------------------------- |
| `paid`                 | Show success      | N/A                           |
| `pending_otp`          | Collect OTP       | `/submit-otp`                 |
| `pending_pin`          | Collect PIN       | `/submit-pin`                 |
| `pending_transfer`     | Show bank details | N/A                           |
| `pending_card_details` | Ask for card      | `/initialize` again with card |

---

## 🔍 Debugging Tips

### Check Response Status Code

```bash
curl -i -X POST http://localhost:5000/api/payments/initialize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

- `200` = Success
- `400` = Client error (check input)
- `404` = Not found (delivery doesn't exist)
- `403` = Forbidden (not a customer)
- `500` = Server error

### Pretty-Print JSON Response

```bash
curl -X POST http://localhost:5000/api/payments/initialize ... | jq '.'
```

### Save Response to File

```bash
curl -X POST http://localhost:5000/api/payments/initialize ... > response.json
cat response.json | jq '.'
```

### See Full Request/Response

```bash
curl -v -X POST http://localhost:5000/api/payments/initialize ...
```

---

## 🎯 Test Checklist

### After Each API Call, Verify:

- [ ] `success` field is correct (true/false)
- [ ] `code` field matches expected code
- [ ] `message` field is present
- [ ] `data` field contains expected fields
- [ ] HTTP status code is correct
- [ ] Response time is acceptable

### For Card Payments

- [ ] Payment created in database
- [ ] Delivery status updated
- [ ] Correct amount breakdown
- [ ] Reference is unique

### For Bank Transfers

- [ ] Bank account details returned
- [ ] All instructions included
- [ ] Support contact info present
- [ ] Correct timeframe shown

---

## 💡 Common Issues & Solutions

### Issue: 401 Unauthorized

**Solution**: Check Bearer token is valid

```bash
# Verify token
echo "$TOKEN"  # Should print your token
```

### Issue: Delivery not found

**Solution**: Verify delivery ID exists and belongs to user

```bash
# Check DB
db.deliveries.findById("YOUR_DELIVERY_ID")
```

### Issue: Payment already exists

**Solution**: Check for existing payment for this delivery

```bash
# Check DB
db.payments.findOne({deliveryId: "YOUR_DELIVERY_ID"})
```

### Issue: Card declined

**Solution**: Use test card with valid credentials

```
Test card: 5061010000000000043
CVV: 123
Expiry: 12/25
```

---

## 📝 Integration Test Template

Create file: `test_payment_flow.js`

```javascript
const axios = require("axios");

const TOKEN = "your_token";
const BASE_URL = "http://localhost:5000";
const DELIVERY_ID = "your_delivery_id";

async function testCardPayment() {
  try {
    console.log("Testing card payment...");
    const response = await axios.post(
      `${BASE_URL}/api/payments/initialize`,
      {
        deliveryId: DELIVERY_ID,
        paymentType: "card",
        cardDetails: {
          number: "5061010000000000043",
          cvv: "123",
          expiry_month: "12",
          expiry_year: "25",
        },
      },
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );

    console.log("Success:", response.data);
    console.log("Status:", response.data.data.status);
  } catch (error) {
    console.error("Error:", error.response.data);
  }
}

async function testTransferPayment() {
  try {
    console.log("Testing transfer payment...");
    const response = await axios.post(
      `${BASE_URL}/api/payments/initialize`,
      {
        deliveryId: DELIVERY_ID,
        paymentType: "transfer",
      },
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );

    console.log("Success:", response.data);
    console.log("Bank Account:", response.data.data.bankAccount);
  } catch (error) {
    console.error("Error:", error.response.data);
  }
}

// Run tests
(async () => {
  await testCardPayment();
  console.log("\n---\n");
  await testTransferPayment();
})();
```

Run with:

```bash
node test_payment_flow.js
```

---

**Ready to test?** Copy the curl command for your use case and start testing! 🚀
