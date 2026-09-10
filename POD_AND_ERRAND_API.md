# Pay on Delivery (POD) & Errand API Documentation

Base URL: `/api`
All routes require `Authorization: Bearer <token>` header.

---

## PAY ON DELIVERY (POD)

A customer orders a product from a merchant, a Riderr partner delivery company picks it up and delivers it. The customer inspects the product on arrival and pays only after accepting it. The delivery company then settles the merchant.

### Status Flow

```
POD_REQUESTED → CONFIRMED → READY_FOR_DELIVERY → OUT_FOR_DELIVERY → AWAITING_CUSTOMER → DELIVERED_PAID → SETTLED
                                                                                        ↘ REJECTED_RETURN
                          ↘ CANCELLED (from POD_REQUESTED, CONFIRMED, READY_FOR_DELIVERY only)
```

---

### POST `/api/pod`
**Create a POD Order**
Role: `customer`

**Request Body:**
```json
{
  "productName": "Nike Air Max",
  "productDescription": "Size 42, Black",
  "productQuantity": 1,
  "productImageUrl": "https://...",
  "productAmount": 45000,
  "deliveryFee": 1500,
  "handlingFee": 500,
  "pickupAddress": "123 Merchant Street, Lagos",
  "pickupLat": 6.5244,
  "pickupLng": 3.3792,
  "pickupInstructions": "Call on arrival",
  "dropoffAddress": "45 Customer Avenue, Ikeja",
  "dropoffLat": 6.6018,
  "dropoffLng": 3.3515,
  "recipientName": "John Doe",
  "recipientPhone": "08012345678",
  "dropoffInstructions": "Gate 2",
  "merchantId": "<userId>",
  "companyId": "<companyId>",
  "paymentMethod": "CASH_ON_DELIVERY",
  "inspectionAllowed": true,
  "returnWindowHours": 24,
  "returnConditions": "Item must be unopened"
}
```

> `productName`, `productAmount`, `dropoffAddress`, and `companyId` are required.
> `merchantId` is optional — links the order to a merchant user for settlement notifications.
> `amountToCollect` is auto-computed: `productAmount + deliveryFee + handlingFee`

**Response `201`:**
```json
{
  "success": true,
  "message": "POD order created successfully",
  "data": { "<pod object>" }
}
```

---

### GET `/api/pod`
**List POD Orders**
Role: `customer` | `company_admin` | `driver` | `admin`

- Customer sees their own orders
- Company admin sees their company orders + new unassigned `POD_REQUESTED` orders
- Driver sees orders assigned to them
- Admin sees all

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status. Use `all` for no filter |
| `page` | number | Default: 1 |
| `limit` | number | Default: 10 |

**Response `200`:**
```json
{
  "success": true,
  "data": [ "<pod objects>" ],
  "pagination": { "total": 50, "page": 1, "limit": 10, "pages": 5 }
}
```

---

### GET `/api/pod/:podId`
**Get POD Order Details**
Role: `customer` (own) | `company_admin` (own company) | `merchant` (own) | `admin`

**Response `200`:**
```json
{
  "success": true,
  "data": { "<pod object with populated customer, merchant, company, driver>" }
}
```

---

### PATCH `/api/pod/:podId/confirm`
**Confirm Product is Available**
Role: `company_admin` | `admin`

> Moves status from `POD_REQUESTED` → `CONFIRMED`. Notifies customer.

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order confirmed",
  "data": { "<pod object>" }
}
```

---

### PATCH `/api/pod/:podId/ready`
**Mark Ready for Delivery**
Role: `company_admin` | `admin`

> Moves status from `CONFIRMED` → `READY_FOR_DELIVERY`.

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order marked ready for delivery",
  "data": { "<pod object>" }
}
```

---

### POST `/api/pod/:podId/assign`
**Assign Driver to POD Order**
Role: `company_admin` | `admin`

**Request Body:**
```json
{
  "driverId": "<driverId>"
}
```

> Moves status to `OUT_FOR_DELIVERY`. Notifies driver and customer.

**Response `200`:**
```json
{
  "success": true,
  "message": "Driver assigned to POD order",
  "data": { "<pod object>" }
}
```

---

### PATCH `/api/pod/:podId/awaiting`
**Driver Marks Arrived at Customer**
Role: `driver`

> Moves status from `OUT_FOR_DELIVERY` → `AWAITING_CUSTOMER`. Notifies customer with amount to pay.

**Response `200`:**
```json
{
  "success": true,
  "message": "Status updated to awaiting customer",
  "data": { "<pod object>" }
}
```

---

### POST `/api/pod/:podId/reject`
**Customer Rejects Product**
Role: `customer` | `admin`

> Only allowed when `inspectionAllowed: true`. Moves status to `REJECTED_RETURN`. Notifies driver to return product and notifies merchant.

**Request Body:**
```json
{
  "reason": "Product is damaged"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order rejected. Return workflow initiated.",
  "data": { "<pod object>" }
}
```

---

### POST `/api/pod/:podId/payment`
**Driver Records Payment Collection**
Role: `driver`

> Moves status from `AWAITING_CUSTOMER` → `DELIVERED_PAID`. Sets `paymentStatus` to `COLLECTED`. Notifies customer and merchant.

**Request Body:**
```json
{
  "paymentReference": "CASH-1234567890",
  "note": "Cash collected at door"
}
```

> `paymentReference` is optional — auto-generated if not provided.

**Response `200`:**
```json
{
  "success": true,
  "message": "Payment recorded. Order delivered and paid.",
  "data": { "<pod object>" }
}
```

---

### PATCH `/api/pod/:podId/settle`
**Settle Merchant**
Role: `admin` | `company_admin`

> Moves status from `DELIVERED_PAID` → `SETTLED`. Sets `paymentStatus` to `SETTLED`. Notifies merchant.

**Request Body:**
```json
{
  "settlementAmount": 45000,
  "note": "Settled via bank transfer"
}
```

> `settlementAmount` defaults to `productAmount` if not provided.

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order settled",
  "data": { "<pod object>" }
}
```

---

### PATCH `/api/pod/:podId/cancel`
**Cancel POD Order**
Role: `customer` | `company_admin` | `admin`

> Only cancellable from: `POD_REQUESTED`, `CONFIRMED`, `READY_FOR_DELIVERY`.

**Request Body:**
```json
{
  "reason": "Customer changed their mind"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order cancelled",
  "data": { "<pod object>" }
}
```

---

### POD Object Reference

```json
{
  "_id": "<id>",
  "referenceId": "POD-1234567890-ABC123",
  "serviceType": "PAY_ON_DELIVERY",
  "customerId": "<userId>",
  "merchantId": "<userId>",
  "companyId": "<companyId>",
  "driverId": "<driverId>",
  "customerName": "Jane Doe",
  "customerPhone": "08012345678",
  "merchantName": "Shop Owner",
  "merchantPhone": "08098765432",
  "product": {
    "name": "Nike Air Max",
    "description": "Size 42, Black",
    "quantity": 1,
    "imageUrl": "https://..."
  },
  "pickup": {
    "address": "123 Merchant Street, Lagos",
    "lat": 6.5244,
    "lng": 3.3792,
    "instructions": "Call on arrival"
  },
  "dropoff": {
    "address": "45 Customer Avenue, Ikeja",
    "lat": 6.6018,
    "lng": 3.3515,
    "recipientName": "John Doe",
    "recipientPhone": "08012345678",
    "instructions": "Gate 2"
  },
  "productAmount": 45000,
  "deliveryFee": 1500,
  "handlingFee": 500,
  "amountToCollect": 47000,
  "paymentMethod": "CASH_ON_DELIVERY",
  "paymentStatus": "UNPAID",
  "paymentReference": null,
  "paymentCollectedAt": null,
  "status": "POD_REQUESTED",
  "inspectionAllowed": true,
  "returnWindowHours": 24,
  "returnConditions": "Item must be unopened",
  "rejectionReason": null,
  "rejectedAt": null,
  "returnStatus": "NONE",
  "settlementAmount": null,
  "settledAt": null,
  "auditLog": [],
  "confirmedAt": null,
  "readyAt": null,
  "outForDeliveryAt": null,
  "awaitingCustomerAt": null,
  "deliveredAt": null,
  "cancelledAt": null,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---
---

## ERRAND

A customer sends a rider to perform a task on their behalf — buying items, picking up documents, moving stock, or any custom task. The rider can be given a cash advance and must record actual spend.

### Errand Types
| Type | Description |
|------|-------------|
| `PICKUP_DELIVERY` | Pick up and deliver an item |
| `PURCHASE` | Buy items on behalf of customer |
| `DOCUMENT_COLLECTION` | Collect documents from a location |
| `STOCK_MOVEMENT` | Move stock between locations |
| `CUSTOM` | Any other custom task |

### Status Flow

```
REQUESTED → SEARCHING_RIDER → RIDER_ASSIGNED → ACCEPTED → IN_PROGRESS → AT_PICKUP → AWAITING_CONFIRMATION → COMPLETED
                                             ↘ CANCELLED (from REQUESTED, SEARCHING_RIDER, RIDER_ASSIGNED, ACCEPTED)
                                                                                                              ↘ FAILED
```

---

### POST `/api/errands`
**Create an Errand**
Role: `customer`

**Request Body:**
```json
{
  "errandType": "PURCHASE",
  "description": "Buy 2 bags of rice from Shoprite and deliver to my house",
  "specialInstructions": "Get the 10kg Mama Gold brand",
  "preferredTime": "2024-01-15T14:00:00.000Z",
  "pickupAddress": "Shoprite, Ikeja City Mall",
  "pickupLat": 6.6018,
  "pickupLng": 3.3515,
  "pickupInstructions": "Go to the rice aisle",
  "destinationAddress": "45 Customer Avenue, Ikeja",
  "destinationLat": 6.6100,
  "destinationLng": 3.3600,
  "estimatedItemCost": 25000,
  "spendingLimit": 30000,
  "customerAdvance": 30000,
  "serviceFee": 2000,
  "paymentMethod": "CASH",
  "companyId": "<companyId>"
}
```

> `errandType`, `description`, `pickupAddress`, and `companyId` are required.
> `spendingLimit` is required for `PURCHASE` errands and cannot exceed `₦500,000` (configurable via `ERRAND_MAX_SPEND` env var).
> Descriptions containing prohibited keywords (weapon, drug, explosive, illegal, contraband) are rejected.

**Payment Methods:** `CASH` | `CARD` | `WALLET`

**Response `201`:**
```json
{
  "success": true,
  "message": "Errand created successfully",
  "data": { "<errand object>" }
}
```

---

### GET `/api/errands`
**List Errands**
Role: `customer` | `company_admin` | `driver` | `admin`

- Customer sees their own errands
- Company admin sees their company errands + unassigned `REQUESTED` errands
- Driver sees errands assigned to them
- Admin sees all

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status. Use `all` for no filter |
| `page` | number | Default: 1 |
| `limit` | number | Default: 10 |

**Response `200`:**
```json
{
  "success": true,
  "data": [ "<errand objects>" ],
  "pagination": { "total": 20, "page": 1, "limit": 10, "pages": 2 }
}
```

---

### GET `/api/errands/:errandId`
**Get Errand Details**
Role: `customer` (own) | `company_admin` (own company) | `driver` (assigned) | `admin`

**Response `200`:**
```json
{
  "success": true,
  "data": { "<errand object with populated customer, company, driver>" }
}
```

---

### POST `/api/errands/:errandId/assign`
**Assign Rider to Errand**
Role: `company_admin` | `admin`

> Company admin can only assign riders from their own company. Notifies the assigned driver.

**Request Body:**
```json
{
  "driverId": "<driverId>"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Rider assigned to errand",
  "data": { "<errand object>" }
}
```

---

### PATCH `/api/errands/:errandId/accept`
**Rider Accepts Errand**
Role: `driver`

> Moves status from `RIDER_ASSIGNED` → `ACCEPTED`. Notifies customer.

**Response `200`:**
```json
{
  "success": true,
  "message": "Errand accepted",
  "data": { "<errand object>" }
}
```

---

### PATCH `/api/errands/:errandId/start`
**Rider Starts Errand**
Role: `driver`

> Moves status from `ACCEPTED` → `IN_PROGRESS`. Notifies customer.

**Response `200`:**
```json
{
  "success": true,
  "message": "Errand started",
  "data": { "<errand object>" }
}
```

---

### PATCH `/api/errands/:errandId/at-pickup`
**Rider Marks Arrived at Pickup**
Role: `driver`

> Moves status from `IN_PROGRESS` → `AT_PICKUP`. Notifies customer.

**Response `200`:**
```json
{
  "success": true,
  "message": "Status updated to at pickup",
  "data": { "<errand object>" }
}
```

---

### POST `/api/errands/:errandId/expense`
**Rider Records Actual Spend**
Role: `driver`

> Only allowed when status is `IN_PROGRESS` or `AT_PICKUP`.
> If `spendingLimit > 0` and `actualSpend > spendingLimit`, the request is rejected — customer approval required.
> `balanceReturned` is auto-computed: `max(0, customerAdvance - actualSpend)`

**Request Body:**
```json
{
  "actualSpend": 24500,
  "receiptUrl": "https://...",
  "note": "Bought 2 bags of Mama Gold rice"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Expense recorded",
  "data": {
    "actualSpend": 24500,
    "customerAdvance": 30000,
    "balanceReturned": 5500
  }
}
```

---

### PATCH `/api/errands/:errandId/complete`
**Rider Marks Errand Complete**
Role: `driver`

> Moves status from `IN_PROGRESS` or `AT_PICKUP` → `AWAITING_CONFIRMATION`. Notifies customer with balance to return (if any).

**Request Body:**
```json
{
  "completionProof": "https://photo-url.com/proof.jpg",
  "note": "Task completed successfully"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Errand completed. Awaiting customer confirmation.",
  "data": { "<errand object>" }
}
```

---

### PATCH `/api/errands/:errandId/confirm-completion`
**Customer Confirms Errand Completion**
Role: `customer` | `admin`

> Moves status from `AWAITING_CONFIRMATION` → `COMPLETED`. Sets `paymentStatus` to `PAID`. Notifies driver.

**Response `200`:**
```json
{
  "success": true,
  "message": "Errand confirmed and completed",
  "data": { "<errand object>" }
}
```

---

### PATCH `/api/errands/:errandId/cancel`
**Cancel Errand**
Role: `customer` | `company_admin` | `admin`

> Only cancellable from: `REQUESTED`, `SEARCHING_RIDER`, `RIDER_ASSIGNED`, `ACCEPTED`. Notifies driver if already assigned.

**Request Body:**
```json
{
  "reason": "No longer needed"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Errand cancelled",
  "data": { "<errand object>" }
}
```

---

### POST `/api/errands/:errandId/dispute`
**Raise a Dispute**
Role: `customer` | `admin`

> Can be raised at any point. Flags the errand for support team review.

**Request Body:**
```json
{
  "details": "Rider did not return the ₦5,500 balance"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Dispute raised. Support team will review.",
  "data": { "<errand object>" }
}
```

---

### Errand Object Reference

```json
{
  "_id": "<id>",
  "referenceId": "ERR-1234567890-ABC123",
  "serviceType": "ERRAND",
  "customerId": "<userId>",
  "companyId": "<companyId>",
  "driverId": "<driverId>",
  "customerName": "Jane Doe",
  "customerPhone": "08012345678",
  "errandType": "PURCHASE",
  "description": "Buy 2 bags of rice from Shoprite",
  "specialInstructions": "Get Mama Gold brand",
  "preferredTime": "2024-01-15T14:00:00.000Z",
  "pickupLocation": {
    "address": "Shoprite, Ikeja City Mall",
    "lat": 6.6018,
    "lng": 3.3515,
    "instructions": "Go to the rice aisle"
  },
  "destination": {
    "address": "45 Customer Avenue, Ikeja",
    "lat": 6.6100,
    "lng": 3.3600
  },
  "estimatedItemCost": 25000,
  "spendingLimit": 30000,
  "customerAdvance": 30000,
  "actualSpend": 24500,
  "balanceReturned": 5500,
  "serviceFee": 2000,
  "paymentMethod": "CASH",
  "paymentStatus": "UNPAID",
  "receiptUrl": "https://...",
  "completionProof": "https://...",
  "status": "COMPLETED",
  "cancelledBy": null,
  "cancelledAt": null,
  "failureReason": null,
  "disputeRaised": false,
  "disputeDetails": null,
  "auditLog": [
    {
      "action": "ERRAND_CREATED",
      "actor": "<userId>",
      "actorRole": "customer",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "note": ""
    }
  ],
  "assignedAt": null,
  "acceptedAt": null,
  "startedAt": null,
  "completedAt": "2024-01-01T02:00:00.000Z",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T02:00:00.000Z"
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Human-readable error message"
}
```

| Status Code | Meaning |
|-------------|---------|
| `400` | Bad request / validation error |
| `403` | Forbidden — wrong role or not your resource |
| `404` | Resource not found |
| `500` | Internal server error |
