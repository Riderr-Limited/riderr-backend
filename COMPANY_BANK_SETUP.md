# Company Bank Setup & Payments Dashboard
## Frontend Integration Guide

**Base URL:** `https://your-domain.com`
**Auth:** `Authorization: Bearer <token>`

---

## Part 1 — Company Bank Account Setup

### Screen Flow

```
[Settings / Onboarding]
        ↓
[Select Bank from dropdown]
        ↓
[Enter 10-digit account number]
        ↓
[Tap "Verify Account"]
        ↓  GET /api/payments/verify-account
[Account name auto-fills ✅]
        ↓
[Tap "Save Bank Account"]
        ↓  POST /api/payments/company/setup-bank-account
[Saved! Payments will go here]
```

---

### Step 1 — Load Bank List

Call once on screen load. Populate the bank dropdown.

```
GET /api/payments/banks
```
No auth required.

**Response:**
```json
{
  "success": true,
  "data": [
    { "code": "044", "name": "Access Bank" },
    { "code": "023", "name": "Citibank Nigeria" },
    { "code": "050", "name": "EcoBank Nigeria" },
    { "code": "011", "name": "First Bank of Nigeria" },
    { "code": "058", "name": "GTBank" },
    { "code": "090267", "name": "Kuda Bank" },
    { "code": "999991", "name": "Palmpay" },
    { "code": "999992", "name": "Opay" },
    { "code": "000014", "name": "Stanbic IBTC Bank" },
    { "code": "033", "name": "UBA" },
    { "code": "032", "name": "Union Bank" },
    { "code": "035", "name": "Wema Bank" },
    { "code": "057", "name": "Zenith Bank" }
  ]
}
```

---

### Step 2 — Verify Account Number

Call when user finishes typing the account number (on blur or after 10 digits entered). Auto-fills the account name field.

```
GET /api/payments/verify-account?accountNumber=7043995559&bankCode=999992
Authorization: Bearer <token>
```

**Success response:**
```json
{
  "success": true,
  "data": {
    "accountName": "AUWALU MUHAMMAD IZZIDDIN",
    "accountNumber": "7043995559"
  }
}
```

**Error response:**
```json
{
  "success": false,
  "message": "Could not verify account. Check account number and bank."
}
```

---

### Step 3 — Save Bank Account

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

**Success response:**
```json
{
  "success": true,
  "message": "Bank account setup successfully",
  "data": {
    "accountNumber": "7043995559",
    "accountName": "AUWALU MUHAMMAD IZZIDDIN",
    "bankCode": "999992",
    "verified": false
  }
}
```

**Error responses:**
```json
{ "success": false, "message": "Account number must be exactly 10 digits" }
{ "success": false, "message": "Account number and account name are required" }
{ "success": false, "message": "Only companies can setup bank accounts" }
```

---

### Bank Setup Screen UI

```
┌─────────────────────────────────────────┐
│          Bank Account Setup             │
│                                         │
│  Payments from deliveries will be       │
│  sent to this account automatically.    │
│                                         │
│  Bank *                                 │
│  ┌─────────────────────────────────┐    │
│  │  Search or select bank...    ▼  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Account Number *                       │
│  ┌─────────────────────────────────┐    │
│  │  7043995559                     │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Account Name                           │
│  ┌─────────────────────────────────┐    │
│  │  ✅ AUWALU MUHAMMAD IZZIDDIN    │    │  ← auto-filled after verify
│  └─────────────────────────────────┘    │
│  (verified by your bank)                │
│                                         │
│         [Save Bank Account]             │
│                                         │
│  🔒 Your account details are            │
│  encrypted and secure.                  │
└─────────────────────────────────────────┘
```

---

### Frontend Logic

```javascript
// 1. Load banks on mount
const banks = await GET('/api/payments/banks')
setBanks(banks.data)

// 2. When user selects bank + enters 10-digit account number
async function onAccountNumberChange(accountNumber, bankCode) {
  if (accountNumber.length !== 10 || !bankCode) return

  setVerifying(true)
  setAccountName('')
  setVerifyError('')

  const res = await GET(
    `/api/payments/verify-account?accountNumber=${accountNumber}&bankCode=${bankCode}`
  )

  if (res.success) {
    setAccountName(res.data.accountName)  // auto-fill
    setVerified(true)
  } else {
    setVerifyError('Account not found. Check number and bank.')
    setVerified(false)
  }
  setVerifying(false)
}

// 3. Save
async function saveBankAccount() {
  if (!verified) {
    showError('Please verify your account number first')
    return
  }

  const res = await POST('/api/payments/company/setup-bank-account', {
    accountNumber,
    accountName,
    bankCode: selectedBank.code,
  })

  if (res.success) {
    showSuccess('Bank account saved!')
    navigate('Dashboard')
  } else {
    showError(res.message)
  }
}
```

---

## Part 2 — Payments Dashboard Tab

### Screen Layout

```
┌─────────────────────────────────────────────────────┐
│  Payments                                           │
│                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │  Total   │ │ Settled  │ │ Pending  │            │
│  │ ₦45,000  │ │ ₦40,000  │ │  ₦5,000  │            │
│  │ 38 txns  │ │          │ │ 4 pending│            │
│  └──────────┘ └──────────┘ └──────────┘            │
│                                                     │
│  Filters: [All ▼]  [All Status ▼]  [Date Range]    │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  RID-1234-ABCD          Jan 15, 2024               │
│  John Doe               ₦1,300                     │
│  Victoria Is. → Lekki   ✅ Settled                 │
│  ─────────────────────────────────────────────────  │
│  RID-5678-EFGH          Jan 14, 2024               │
│  Jane Smith             ₦2,100                     │
│  Ikeja → Surulere       ⏳ Pending                 │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  [Load More]                                        │
└─────────────────────────────────────────────────────┘
```

---

### Fetch Payments

```
GET /api/payments/company-payments
Authorization: Bearer <company_token>
```

**Query params (all optional):**
- `status` — `all` | `pending` | `successful` | `failed`
- `settlementStatus` — `all` | `pending` | `settled`
- `startDate` — `2024-01-01`
- `endDate` — `2024-01-31`
- `page` — default `1`
- `limit` — default `10`

**Example:**
```
GET /api/payments/company-payments?settlementStatus=pending&page=1&limit=10
```

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
        "paystackReference": "RIDERR-1234567890-ABCD",
        "customer": {
          "name": "John Doe",
          "phone": "+2348012345678",
          "avatarUrl": "https://..."
        },
        "delivery": {
          "referenceId": "RID-1234-ABCD",
          "pickup": "Victoria Island, Lagos",
          "dropoff": "Lekki Phase 1, Lagos",
          "status": "completed"
        }
      }
    ],
    "summary": {
      "totalEarnings": 45000,
      "totalFees": 5000,
      "totalTransactions": 38,
      "settledAmount": 40000,
      "pendingAmount": 5000,
      "pendingSettlements": 4
    },
    "recentSettlements": [...],
    "company": {
      "name": "Express Logistics Ltd",
      "earnings": 45000,
      "totalDeliveries": 38,
      "lastPaymentReceived": "2024-01-15T11:00:00.000Z"
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

### Payment Item — escrowStatus values

| `escrowStatus` | Badge | Meaning |
|----------------|-------|---------|
| `settled` | ✅ Green | Money sent to your bank |
| `pending` | ⏳ Orange | Waiting for customer to confirm delivery |
| `held` | 🔒 Blue | Payment received, delivery in progress |

---

### Fetch Single Payment Detail

```
GET /api/payments/company-settlements/:paymentId
Authorization: Bearer <company_token>
```

**Response includes:**
- Full payment breakdown (total, your share, platform fee)
- Delivery details (pickup, dropoff, driver info)
- Customer info
- Settlement timeline
- Transfer ID and settled date

---

### Download Receipt

```
GET /api/payments/company-settlements/:paymentId/receipt
Authorization: Bearer <company_token>
```
Returns an HTML receipt file. Trigger a download in the app.

---

### Frontend Logic — Payments Tab

```javascript
// Load on tab open
async function loadPayments(filters = {}) {
  const params = new URLSearchParams({
    page: filters.page || 1,
    limit: 10,
    status: filters.status || 'all',
    settlementStatus: filters.settlementStatus || 'all',
    ...(filters.startDate && { startDate: filters.startDate }),
    ...(filters.endDate && { endDate: filters.endDate }),
  })

  const res = await GET(`/api/payments/company-payments?${params}`)

  if (res.success) {
    setPayments(res.data.payments)
    setSummary(res.data.summary)
    setPagination(res.data.pagination)
  }
}

// Summary cards
const cards = [
  {
    label: 'Total Earnings',
    value: `₦${summary.totalEarnings.toLocaleString()}`,
    sub: `${summary.totalTransactions} transactions`,
  },
  {
    label: 'Settled',
    value: `₦${summary.settledAmount.toLocaleString()}`,
    color: 'green',
  },
  {
    label: 'Pending',
    value: `₦${summary.pendingAmount.toLocaleString()}`,
    sub: `${summary.pendingSettlements} awaiting confirmation`,
    color: 'orange',
  },
]

// Payment row badge
function getStatusBadge(escrowStatus) {
  switch (escrowStatus) {
    case 'settled': return { label: 'Settled', color: 'green', icon: '✅' }
    case 'pending': return { label: 'Pending', color: 'orange', icon: '⏳' }
    case 'held':    return { label: 'In Escrow', color: 'blue', icon: '🔒' }
    default:        return { label: escrowStatus, color: 'gray', icon: '•' }
  }
}

// Load more / pagination
function loadMore() {
  loadPayments({ ...currentFilters, page: currentPage + 1 })
}
```

---

## Part 3 — All Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/payments/banks` | No | Bank list for dropdown |
| GET | `/api/payments/verify-account?accountNumber=&bankCode=` | Yes | Verify & get account name |
| POST | `/api/payments/company/setup-bank-account` | Yes (company) | Save bank account |
| GET | `/api/payments/company-payments` | Yes (company) | Payments + summary |
| GET | `/api/payments/company-settlements/:paymentId` | Yes (company) | Single payment detail |
| GET | `/api/payments/company-settlements/:paymentId/receipt` | Yes (company) | Download receipt |

---

## Part 4 — Important Notes

1. **Always verify before saving** — call `verify-account` first so the account name is confirmed by the bank. Never let users type the account name manually.

2. **Bank code is required for settlement** — without it, Flutterwave cannot send the transfer. The `verify-account` step ensures the bank code is correct.

3. **Settlement is automatic** — once the customer confirms delivery, money moves to the company bank account within minutes. No manual action needed.

4. **`escrowStatus: "pending"`** means the delivery hasn't been confirmed by the customer yet — not that anything is wrong.

5. **One bank account per company** — calling setup again overwrites the previous account.
