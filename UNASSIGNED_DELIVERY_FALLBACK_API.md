# Unassigned Delivery Fallback — API Documentation

**Written for:** engineers integrating the Riderr admin dashboard.

This document covers one specific feature: what happens when a delivery
(from the Partner API or the main app) has **no driver assigned**, and how
the admin dashboard hooks into the fallback so a human can assign one
manually. It's a focused extract of what's already in
[PARTNER_ADMIN_API.md](PARTNER_ADMIN_API.md) — read that for partner
account management, this one just for the fallback flow end-to-end.

---

## How the fallback works

```
1. A delivery is created (Partner API or main app)
       │
       ▼
2. System searches for a nearby online driver
       │
   ┌───┴────┐
   │ found  │──▶ status: "assigned" ──▶ normal flow continues
   └───┬────┘
       │ not found
       ▼
3. Delivery stays status: "created" (unassigned)
       │
       ▼
4. [Partner API deliveries only] Background job checks every minute.
   If still unassigned after PARTNER_UNASSIGNED_ALERT_MINUTES (default 5),
   it sends a notification to every admin account.
       │
       ▼
5. Admin dashboard: fetch unassigned deliveries, pick a driver, assign.
       │
       ▼
6. Delivery moves to status: "assigned" — driver and customer are notified.
```

For **main-app** customer deliveries, there's a separate, older fallback
already built into `delivery.controller.js`: if no driver is found at
creation time, the response itself includes `noDriversFound: true` plus a
list of nearby companies, and the customer/app can resubmit with a chosen
`companyId` via `PATCH /api/deliveries/:deliveryId/assign-company`. That
path is unchanged by this feature.

The flow below (steps 3–6) is what's new and applies to **Partner API**
deliveries, and doubles as the general-purpose "admin manually assigns a
driver" tool for any delivery.

---

## 1. Find deliveries that need manual assignment

```
GET /api/admin/deliveries?status=created
Authorization: Bearer <admin JWT>
```

To narrow to only partner-originated ones:
```
GET /api/admin/deliveries?status=created&source=partner_api
```

**Query params (all optional, all combinable):**
| Param | Type | Notes |
|---|---|---|
| `status` | string | Use `created` to find unassigned deliveries |
| `source` | `app` \| `partner_api` | Filter by origin |
| `partnerId` | string | Only one partner's deliveries |
| `companyId` | string | Only one delivery company's deliveries |
| `page`, `limit` | number | Pagination (default `1`, `20`) |
| `sortBy`, `sortOrder` | string | Default `createdAt`, `desc` |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "6aaa96b567ebe86c519cf157",
      "referenceId": "PTN-1789564597971-C2B89D",
      "status": "created",
      "source": "partner_api",
      "partnerId": { "_id": "6aaa969e67ebe86c519cf14c", "businessName": "Jumia NG", "contactEmail": "integrations@jumia.example" },
      "partnerOrderRef": "TEST-ORDER-001",
      "companyId": { "_id": "6946f9b186c744372b878f4d", "name": "Sisxo Transports Ltd" },
      "customerName": "Test Customer",
      "customerPhone": "08099988877",
      "pickup": { "address": "Test Warehouse, Ikeja", "lat": 6.6018, "lng": 3.3515 },
      "dropoff": { "address": "12 Allen Ave, Ikeja", "lat": 6.61, "lng": 3.36 },
      "fare": { "baseFare": 200, "distanceFare": 65.4, "totalFare": 300, "currency": "NGN" },
      "createdAt": "2026-09-16T13:16:37.976Z"
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "pages": 1 }
}
```

---

## 2. Find a driver to assign

Use the delivery's `companyId` to list drivers who can actually take it
(drivers belong to a single company):

```
GET /api/admin/drivers?companyId=6946f9b186c744372b878f4d&isOnline=true&isAvailable=true
Authorization: Bearer <admin JWT>
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "<driverId>",
      "userId": { "name": "John Rider", "phone": "08011223344", "avatarUrl": null },
      "companyId": { "name": "Sisxo Transports Ltd" },
      "vehicleType": "bike",
      "isOnline": true,
      "isAvailable": true,
      "rating": 4.8
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20 }
}
```
If this list is empty, there is genuinely no one online for that company
right now — the admin will need to contact the company or wait.

---

## 3. Assign the driver

```
PUT /api/admin/deliveries/:deliveryId/assign-driver
Authorization: Bearer <admin JWT>
Content-Type: application/json

{ "driverId": "<driverId from step 2>" }
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Driver assigned successfully",
  "data": {
    "_id": "6aaa96b567ebe86c519cf157",
    "status": "driver_assigned",
    "driverId": "<driverId>",
    "adminAssigned": true,
    "driverAssignedAt": "2026-09-16T13:20:00.000Z",
    "...": "rest of delivery fields"
  }
}
```

This single call:
- Sets `delivery.driverId`, `status: "driver_assigned"`, `adminAssigned: true`
- Notifies the assigned driver ("New Delivery Assigned")
- Notifies the customer ("Driver Assigned")
- If a different driver was previously assigned, notifies them it was reassigned

**Errors:** `404` delivery or driver not found · `400` driver is not
active/verified.

---

## 4. The admin alert notification (what triggers step 1 in practice)

Rather than the admin having to remember to poll `?status=created`, a
background job (`jobs/notifyUnassignedPartnerDeliveries.js`) runs every
minute and pushes a notification to every admin account once a
`partner_api` delivery has been unassigned for
`PARTNER_UNASSIGNED_ALERT_MINUTES` (env var, default `5`) minutes.

Your dashboard already has a notification bell/list wired to:
```
GET /api/notifications?type=delivery
GET /api/notifications/unread-count
PUT /api/notifications/:notificationId/read
```

The alert notification's shape:
```json
{
  "_id": "<notificationId>",
  "title": "Partner order needs a driver",
  "message": "Jumia NG's delivery PTN-1789564597971-C2B89D has had no driver for over 5 minutes. Please assign one manually.",
  "type": "delivery",
  "subType": "alert",
  "priority": "high",
  "read": false,
  "actionUrl": "/admin/deliveries/6aaa96b567ebe86c519cf157",
  "actionLabel": "Assign Driver",
  "data": {
    "deliveryId": "6aaa96b567ebe86c519cf157",
    "referenceId": "PTN-1789564597971-C2B89D",
    "partnerId": "6aaa969e67ebe86c519cf14c",
    "partnerName": "Jumia NG"
  },
  "createdAt": "2026-09-16T13:21:37.976Z"
}
```

**Recommended UI wiring:** clicking the notification uses `actionUrl` to
navigate straight to that delivery's detail screen (step 1→3 above,
pre-filtered to that one delivery via `GET /api/admin/deliveries/:deliveryId`),
so the admin can assign a driver in one click-through rather than searching.

This alert fires **once per delivery** (it won't repeat every minute once
sent) — so if it's dismissed/missed, the delivery still shows up via the
`?status=created` list in step 1.

---

## Quick reference

| Step | Endpoint | Purpose |
|---|---|---|
| Get notified | `GET /api/notifications?type=delivery` | See the "needs a driver" alert |
| List unassigned | `GET /api/admin/deliveries?status=created` | Full queue, with or without the alert |
| Find a driver | `GET /api/admin/drivers?companyId=...&isOnline=true` | Candidates for that delivery's company |
| Assign | `PUT /api/admin/deliveries/:deliveryId/assign-driver` | Resolve it |

All require `Authorization: Bearer <admin JWT>`. Error format across all of
them: `{ "success": false, "message": "..." }`.
