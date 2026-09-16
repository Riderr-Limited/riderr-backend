# Partner Management API — Riderr Admin Integration

This is the reference for the **Riderr admin dashboard** to manage external
Partner API integrations (ecommerce/marketplace platforms consuming
delivery services) and to handle their orders alongside normal deliveries.

For the separate document aimed at the *external partner's* engineers
(how they call `/api/partner/v1/...` to create deliveries), see
[PARTNER_API.md](PARTNER_API.md). This document is for the Riderr admin
frontend only.

Base URL: `/api`
Auth: `Authorization: Bearer <admin JWT>` on every endpoint below (same
login your admin dashboard already uses — role must be `admin`).

---

## 1. Partner accounts

### Create a partner

```
POST /api/admin/partners
```

**Body:**
```json
{
  "businessName": "Jumia NG",
  "contactName": "Jane Doe",
  "contactEmail": "integrations@jumia.example",
  "contactPhone": "08012345678",
  "allowedCompanyIds": []
}
```
`allowedCompanyIds` is optional — an array of Riderr `Company` ids this
partner is restricted to dispatching through. Leave empty/omit to allow any
active company.

**Response `201`:**
```json
{
  "success": true,
  "message": "Partner created. Store the apiSecret now — it will not be shown again.",
  "data": {
    "id": "6aaa969e67ebe86c519cf14c",
    "businessName": "Jumia NG",
    "contactName": "Jane Doe",
    "contactEmail": "integrations@jumia.example",
    "contactPhone": "08012345678",
    "apiKey": "pk_76fd7f44b8443d0c77f4ffa59911a9a7",
    "apiSecret": "sk_5dbf23f14b33c70610667fefbdece069546f9ecf8ec4249dd7a746d53f9fd453",
    "status": "active",
    "allowedCompanyIds": [],
    "lastUsedAt": null,
    "requestCount": 0,
    "createdAt": "2026-09-16T13:16:14.049Z"
  }
}
```

> ⚠️ `apiSecret` is returned **only on this call and on regenerate**. It is
> stored as a bcrypt hash — there is no "view secret" endpoint. Show it to
> the admin once in a copy-to-clipboard field, then it's gone.

`409` if `contactEmail` is already used by another partner.

---

### List partners

```
GET /api/admin/partners
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "6aaa969e67ebe86c519cf14c",
      "businessName": "Jumia NG",
      "contactName": "Jane Doe",
      "contactEmail": "integrations@jumia.example",
      "contactPhone": "08012345678",
      "apiKey": "pk_76fd7f44b8443d0c77f4ffa59911a9a7",
      "status": "active",
      "allowedCompanyIds": [],
      "lastUsedAt": "2026-09-16T13:16:37.976Z",
      "requestCount": 42,
      "createdAt": "2026-09-16T13:16:14.049Z"
    }
  ]
}
```
Note: `apiSecret`/hash is never included in list or get responses.

### Get one partner

```
GET /api/admin/partners/:partnerId
```
Same shape as one item above. `404` if not found.

### Suspend / activate a partner

```
PATCH /api/admin/partners/:partnerId/suspend
PATCH /api/admin/partners/:partnerId/activate
```
No body needed. A suspended partner's API key/secret immediately stop
working (every `/api/partner/v1/...` call returns `403`), but their
historical deliveries are untouched.

### Regenerate a partner's secret

```
POST /api/admin/partners/:partnerId/regenerate-secret
```
Use this if a partner's secret is compromised or lost. The `apiKey` stays
the same; only the secret rotates and the old one stops working
immediately.

**Response `200`:**
```json
{
  "success": true,
  "message": "New apiSecret generated. Store it now — it will not be shown again.",
  "data": { "apiKey": "pk_76fd7f44b8443d0c77f4ffa59911a9a7", "apiSecret": "sk_..." }
}
```

---

## 2. Viewing partner-originated deliveries

Partner deliveries are **regular `Delivery` documents** — they show up in
the same admin deliveries screens you already have, tagged with two extra
fields:

| Field | Values | Meaning |
|---|---|---|
| `source` | `"app"` \| `"partner_api"` | Where the delivery was created from |
| `partnerId` | ObjectId or `null` | Which partner created it (populated with `businessName`, `contactEmail` when you fetch it) |
| `partnerOrderRef` | string or `null` | The partner's own order ID, for cross-referencing their system |

### List deliveries, optionally filtered to partner orders

```
GET /api/admin/deliveries?source=partner_api
GET /api/admin/deliveries?source=partner_api&partnerId=6aaa969e67ebe86c519cf14c
GET /api/admin/deliveries?source=partner_api&status=created   // unassigned partner orders needing a driver
```

All existing filters still work unchanged (`status`, `vehicleType`,
`customerId`, `driverId`, `companyId`, `startDate`, `endDate`, `search`,
`page`, `limit`, `sortBy`, `sortOrder`) — `source` and `partnerId` are
additive. Response shape is unchanged, each delivery now includes populated
`partnerId: { businessName, contactEmail }` when applicable.

### Get one delivery's full detail

```
GET /api/admin/deliveries/:deliveryId
```
Same as before, now also populates `partnerId` with
`businessName, contactEmail, contactPhone, status`.

### Manually assign a driver (the fallback path)

If a partner order has no driver (`status: "created"`), assign one exactly
like you would for a normal app delivery — no separate partner endpoint:

```
PUT /api/admin/deliveries/:deliveryId/assign-driver
Body: { "driverId": "<driverId>" }
```

---

## 3. "No driver found" alerts

If a partner-originated delivery is still unassigned after
**5 minutes** (configurable server-side via `PARTNER_UNASSIGNED_ALERT_MINUTES`),
a background job notifies every admin account through the notification
system your dashboard already polls:

```
GET /api/notifications?type=delivery
GET /api/notifications/unread-count
```

The alert notification looks like:
```json
{
  "title": "Partner order needs a driver",
  "message": "Jumia NG's delivery PTN-1789564597971-C2B89D has had no driver for over 5 minutes. Please assign one manually.",
  "type": "delivery",
  "subType": "alert",
  "priority": "high",
  "actionUrl": "/admin/deliveries/6aaa96b567ebe86c519cf157",
  "actionLabel": "Assign Driver",
  "data": {
    "deliveryId": "6aaa96b567ebe86c519cf157",
    "referenceId": "PTN-1789564597971-C2B89D",
    "partnerId": "6aaa969e67ebe86c519cf14c",
    "partnerName": "Jumia NG"
  }
}
```

Wire your admin UI's notification bell/list to route `actionUrl` to your
delivery-detail screen so clicking it lands directly on the
assign-driver action — no new notification endpoint needed, it uses the
same `/api/notifications` your dashboard already has.

---

## Error format

Same as the rest of the platform:
```json
{ "success": false, "message": "Human-readable error message" }
```
`401` invalid/missing admin token · `403` not an admin / partner suspended
· `404` not found · `409` duplicate `contactEmail` on partner creation.
