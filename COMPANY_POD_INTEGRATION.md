# Company Dashboard — POD Integration Guide

Base URL: `/api`
All routes require `Authorization: Bearer <token>` header.
Role required: `company_admin`

---

## Overview

When a customer creates a POD order and selects your company, the order lands in your dashboard with status `POD_REQUESTED`. Your job as company admin is to:

1. Review and confirm the order
2. Mark it ready for delivery
3. Assign a driver
4. Settle the merchant after payment is collected

---

## Full Flow

```
[Customer]                        [Company Admin]                  [Driver]
    |                                    |                             |
    | POST /api/pod                      |                             |
    | (selects your companyId)           |                             |
    |─────────────────────────────────→ |                             |
    |                             POD_REQUESTED                        |
    |                                    |                             |
    |                             GET /api/pod                         |
    |                             (sees new order)                     |
    |                                    |                             |
    |                             PATCH /pod/:id/confirm               |
    |                             → CONFIRMED                          |
    |  ← push: "Order Confirmed"         |                             |
    |                                    |                             |
    |                             PATCH /pod/:id/ready                 |
    |                             → READY_FOR_DELIVERY                 |
    |                                    |                             |
    |                             POST /pod/:id/assign                 |
    |                             (picks a driver)                     |
    |                             → OUT_FOR_DELIVERY                   |
    |  ← push: "Driver On The Way"       |                ← push: "New POD Delivery"
    |                                    |                             |
    |                                    |              PATCH /pod/:id/awaiting
    |                                    |              → AWAITING_CUSTOMER
    |  ← push: "Driver Has Arrived"      |                             |
    |                                    |                             |
    | (customer inspects, pays cash)     |                             |
    |                                    |              POST /pod/:id/payment
    |                                    |              → DELIVERED_PAID
    |  ← push: "Payment Recorded"        |                             |
    |                                    |                             |
    |                             PATCH /pod/:id/settle                |
    |                             → SETTLED                            |
    |                             (merchant notified)                  |
```

---

## Step 1 — Fetch Incoming Orders

Poll this on your dashboard to see new and existing orders.

```
GET /api/pod
Authorization: Bearer <token>
```

As `company_admin` you see:
- All orders where `companyId` matches yours (any status)
- All new `POD_REQUESTED` orders with no company assigned yet

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter: `POD_REQUESTED` \| `CONFIRMED` \| `READY_FOR_DELIVERY` \| `OUT_FOR_DELIVERY` \| `DELIVERED_PAID` \| `all` |
| `page` | number | Default: 1 |
| `limit` | number | Default: 10 |

**Example — fetch only new incoming orders:**
```
GET /api/pod?status=POD_REQUESTED
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "<podId>",
      "referenceId": "POD-1234567890-ABC123",
      "status": "POD_REQUESTED",
      "customerName": "Jane Doe",
      "customerPhone": "08012345678",
      "product": {
        "name": "Nike Air Max",
        "description": "Size 42, Black",
        "quantity": 1
      },
      "pickup": {
        "address": "123 Merchant Street, Lagos"
      },
      "dropoff": {
        "address": "45 Customer Avenue, Ikeja",
        "recipientName": "John Doe",
        "recipientPhone": "08012345678"
      },
      "productAmount": 45000,
      "deliveryFee": 1500,
      "handlingFee": 500,
      "amountToCollect": 47000,
      "inspectionAllowed": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": { "total": 12, "page": 1, "limit": 10, "pages": 2 }
}
```

---

## Step 2 — Confirm the Order

Confirms the product is available and the company will handle it.
Moves status: `POD_REQUESTED` → `CONFIRMED`
Customer receives a push notification.

```
PATCH /api/pod/:podId/confirm
Authorization: Bearer <token>
```

No request body needed.

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order confirmed",
  "data": { "<pod object>" }
}
```

**Error cases:**
| Status | Message |
|--------|---------|
| `400` | `Cannot confirm from status: CONFIRMED` — already confirmed |
| `403` | `This order was not directed to your company` — wrong company |
| `404` | POD order not found |

---

## Step 3 — Mark Ready for Delivery

Signals the product has been picked up from the merchant and is ready to go out.
Moves status: `CONFIRMED` → `READY_FOR_DELIVERY`

```
PATCH /api/pod/:podId/ready
Authorization: Bearer <token>
```

No request body needed.

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order marked ready for delivery",
  "data": { "<pod object>" }
}
```

---

## Step 4 — Assign a Driver

Assigns one of your drivers to the order.
Moves status: `CONFIRMED` or `READY_FOR_DELIVERY` → `OUT_FOR_DELIVERY`
Driver and customer both receive push notifications.

```
POST /api/pod/:podId/assign
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "driverId": "<driverId>"
}
```

> `driverId` is the Driver profile `_id` (from `GET /api/company/drivers`), not the user `_id`.

**Response `200`:**
```json
{
  "success": true,
  "message": "Driver assigned to POD order",
  "data": { "<pod object>" }
}
```

**How to get your drivers list:**
```
GET /api/company/drivers
Authorization: Bearer <token>
```

Returns drivers with their `_id`, `name`, `phone`, `isOnline`, `isAvailable`.

---

## Step 5 — Settle the Merchant

After the driver collects payment (`DELIVERED_PAID`), you settle the merchant.
Moves status: `DELIVERED_PAID` → `SETTLED`
Merchant receives a push notification.

```
PATCH /api/pod/:podId/settle
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "settlementAmount": 45000,
  "note": "Settled via bank transfer"
}
```

> `settlementAmount` defaults to `productAmount` if not provided.
> `note` is optional.

**Response `200`:**
```json
{
  "success": true,
  "message": "POD order settled",
  "data": { "<pod object>" }
}
```

---

## Cancel an Order

You can cancel from: `POD_REQUESTED`, `CONFIRMED`, `READY_FOR_DELIVERY` only.

```
PATCH /api/pod/:podId/cancel
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "reason": "Product unavailable"
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

## Get Order Details

```
GET /api/pod/:podId
Authorization: Bearer <token>
```

Returns the full POD object with populated `customer`, `merchant`, `company`, and `driver`.

---

## Status Reference

| Status | Meaning | Who acts next |
|--------|---------|---------------|
| `POD_REQUESTED` | Customer placed order | Company admin — confirm |
| `CONFIRMED` | Company confirmed product available | Company admin — mark ready or assign driver |
| `READY_FOR_DELIVERY` | Product ready to go out | Company admin — assign driver |
| `OUT_FOR_DELIVERY` | Driver assigned and heading to customer | Driver — mark arrived |
| `AWAITING_CUSTOMER` | Driver at customer location | Customer — inspect and pay or reject |
| `DELIVERED_PAID` | Payment collected by driver | Company admin — settle merchant |
| `REJECTED_RETURN` | Customer rejected product | Driver returns product to merchant |
| `SETTLED` | Merchant has been paid | Terminal state |
| `CANCELLED` | Order cancelled | Terminal state |

---

## Push Notifications Received by Company Admin

| Event | Title | Trigger |
|-------|-------|---------|
| New POD order | — | Poll `GET /api/pod?status=POD_REQUESTED` |

> Company admin does not receive a push on new orders — use polling or websocket on your dashboard to detect new `POD_REQUESTED` orders.

---

## Recommended Dashboard Screen Flow

```
[Incoming Orders Tab]          [Active Orders Tab]         [Completed Tab]
  POD_REQUESTED                  CONFIRMED                   DELIVERED_PAID
  → tap "Confirm"                READY_FOR_DELIVERY          SETTLED
                                 OUT_FOR_DELIVERY            CANCELLED
                                 AWAITING_CUSTOMER           REJECTED_RETURN
                                 → tap "Assign Driver"
                                 → tap "Settle"
```

**Suggested polling interval:** every 15 seconds on the Incoming Orders tab.

---

## Quick Endpoint Summary

| Action | Method | Endpoint |
|--------|--------|----------|
| List orders | `GET` | `/api/pod` |
| Get order detail | `GET` | `/api/pod/:podId` |
| Confirm order | `PATCH` | `/api/pod/:podId/confirm` |
| Mark ready | `PATCH` | `/api/pod/:podId/ready` |
| Assign driver | `POST` | `/api/pod/:podId/assign` |
| Settle merchant | `PATCH` | `/api/pod/:podId/settle` |
| Cancel order | `PATCH` | `/api/pod/:podId/cancel` |
| Get drivers | `GET` | `/api/company/drivers` |
