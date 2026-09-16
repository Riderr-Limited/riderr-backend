# Partner Delivery API

This is a separate, external-facing API that lets other platforms (ecommerce
stores, marketplaces, or any app that needs delivery/rider services) request
deliveries fulfilled by Riderr — **without** touching the main app/website
backend used by Riderr's own customers, drivers, companies, and admins.

- Main app API: `/api/...` (JWT-based, unchanged)
- **Partner API: `/api/partner/v1/...` (API key/secret based, new)**
- Partner management (admin only): `/api/admin/partners/...` (JWT, `admin` role, new)

Everything under `/api/partner/v1` and `/api/admin/partners` is additive —
no existing route, controller, or model behavior was changed. The only
changes to existing files were new *optional* fields (`source`, `partnerId`,
`partnerOrderRef` on `Delivery`; `isGuest`, `guestSourcePartnerId` on `User`)
that default to their old values and are ignored by all existing code paths.

---

## 1. Onboarding a partner (you, the admin)

```
POST /api/admin/partners
Authorization: Bearer <your admin JWT>

{
  "businessName": "Jumia NG",
  "contactName": "Jane Doe",
  "contactEmail": "integrations@jumia.example",
  "contactPhone": "08012345678",
  "allowedCompanyIds": []   // optional: restrict to specific delivery companies
}
```

Response includes `apiKey` and a one-time `apiSecret`. **Store the secret
now — it is hashed and cannot be retrieved again.** If lost, use:

```
POST /api/admin/partners/:partnerId/regenerate-secret
```

Other admin endpoints: `GET /api/admin/partners`, `GET /api/admin/partners/:id`,
`PATCH /api/admin/partners/:id/suspend`, `PATCH /api/admin/partners/:id/activate`.

---

## 2. Partner integration

All partner requests must include:

```
X-API-Key: pk_...
X-API-Secret: sk_...
```

Rate limit: 60 requests/minute per partner (per-IP is not used, since a
partner's backend is the caller, not its end-customers' browsers).

### List companies you can dispatch through

```
GET /api/partner/v1/companies
```

### Create a delivery

```
POST /api/partner/v1/deliveries

{
  "companyId": "<companyId from the list above>",
  "partnerOrderRef": "JUMIA-ORDER-88213",   // optional: your own order id, echoed back
  "customerName": "Amaka Obi",
  "customerPhone": "08012345678",
  "customerEmail": "amaka@example.com",      // optional
  "recipientName": "Amaka Obi",
  "recipientPhone": "08012345678",
  "pickup": { "address": "Warehouse, Ikeja", "lat": 6.6018, "lng": 3.3515 },
  "dropoff": { "address": "12 Allen Ave, Ikeja", "lat": 6.6100, "lng": 3.3600 },
  "itemDetails": { "type": "parcel", "description": "Shoes", "weight": 1.5, "value": 25000 },
  "vehicleType": "bike",
  "paymentMethod": "cash"
}
```

Response: `201` with `deliveryId`, `referenceId`, `status`, `fare`, and the
assigned driver (if one was found immediately — otherwise it stays
`created` until a driver is assigned by the normal matching flow).

### Poll delivery status

```
GET /api/partner/v1/deliveries/:deliveryId
GET /api/partner/v1/deliveries?status=assigned&page=1&limit=20
```

### Cancel a delivery

```
POST /api/partner/v1/deliveries/:deliveryId/cancel
{ "reason": "Order cancelled by end customer" }
```

Only allowed while status is `created` or `assigned`.

---

## No driver available

When a delivery is created and no driver is found immediately, it stays in
`status: "created"` — exactly like a normal app delivery with no nearby
driver. Nothing further happens automatically on the partner side (no
company-fallback list is returned to the partner).

Internally: if a `partner_api` delivery is still `created` after
`PARTNER_UNASSIGNED_ALERT_MINUTES` (default 5) minutes, a background job
(`jobs/notifyUnassignedPartnerDeliveries.js`, runs every minute) notifies
every admin user so they can manually assign a driver — using the same
existing admin dashboard endpoints as normal deliveries:

- `GET /api/admin/deliveries?status=created` — find unassigned deliveries
- `PUT /api/admin/deliveries/:deliveryId/assign-driver` — assign a driver

This mirrors how unassigned app-originated deliveries are already handled;
no separate partner-specific dispatch queue was built.

## Notes

- Partner API v1 is polling-based (no webhooks yet). Poll
  `GET /deliveries/:id` for status changes.
- Each partner's end-customer is represented internally by a lightweight
  guest `User` record (`isGuest: true`) keyed by phone number — they never
  get app credentials and cannot log in.
- Deliveries created this way are tagged `source: "partner_api"` and scoped
  to the creating partner; a partner can only ever read/cancel its own
  deliveries.
