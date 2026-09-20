# Riderr Admin API — Full Reference

**Written for:** engineers integrating the Riderr admin dashboard.

This covers the complete admin-only API surface: dashboard/analytics, users,
drivers, companies, deliveries, payments, support tickets, system stats,
bulk notifications, and data export — plus two admin-only endpoints that
live outside `admin.routes.js` (rides, and Partner API management).

For two features already documented in more depth elsewhere, see:
- [PARTNER_ADMIN_API.md](PARTNER_ADMIN_API.md) — partner account management (`/api/admin/partners/...`)
- [UNASSIGNED_DELIVERY_FALLBACK_API.md](UNASSIGNED_DELIVERY_FALLBACK_API.md) — manually assigning a driver to an unassigned delivery

## Auth

Every endpoint below requires:
```
Authorization: Bearer <JWT>
```
issued to a user with `role: "admin"`. All are mounted under `/api/admin`
(except the two called out separately at the bottom) and pass through
`protect` (JWT check) then `authorize("admin")` — a non-admin gets `403`,
a missing/invalid token gets `401`.

Standard error shape everywhere: `{ "success": false, "message": "..." }`.
Standard list shape: `{ "success": true, "data": [...], "pagination": { "total", "page", "limit", "pages" } }`.

---

## Dashboard & Analytics

### `GET /api/admin/dashboard`
**Query:** `startDate`, `endDate` (ISO dates, optional pair) — otherwise `period` (`7days` \| `30days` \| `90days`, default `30days`).

**Response `data`:**
```json
{
  "users": { "total": 0, "byRole": [], "verified": 0, "active": 0, "newThisPeriod": 0 },
  "drivers": { "total": 0, "online": 0, "available": 0, "byVehicleType": [], "topRated": [] },
  "companies": { "total": 0, "active": 0, "pending": 0 },
  "deliveries": { "total": 0, "byStatus": [], "thisPeriod": { "count": 0, "totalRevenue": 0, "avgFare": 0 }, "byVehicleType": [], "dailyStats": [] },
  "revenue": { "totalRevenue": 0, "platformFees": 0, "companyRevenue": 0, "totalTransactions": 0, "avgTransactionValue": 0 },
  "recentActivities": [ "...10 latest deliveries" ]
}
```
Read-only, heavy aggregation. No side effects.

### `GET /api/admin/analytics`
**Query:** `period` (default `30days`), `metric` (`all` \| `users` \| `deliveries` \| `revenue` \| `drivers`, default `all`).

**Response `data`:** only the keys matching `metric` are populated — `userGrowth`, `deliveryPerformance`, `completionRate`, `revenueAnalytics`, `topDrivers`.

---

## Users

### `GET /api/admin/users`
**Query:** `page` (1), `limit` (20), `role`, `isVerified`, `isActive` (`"true"`/anything else), `search` (regex on name/email/phone), `companyId`, `startDate`, `endDate`, `sortBy` (`createdAt`), `sortOrder` (`desc`).

**Response:** list of users (password/refreshToken excluded, `companyId`/`driverId` populated) each with an injected `.stats` — customers get `{totalDeliveries, totalSpent, completedDeliveries}`, drivers get `{totalDeliveries, completedDeliveries, totalEarnings, avgRating}`. Pagination includes `hasNextPage`/`hasPrevPage` too.

### `GET /api/admin/users/:userId`
**Response `data`:** `{ user, stats, deliveries(20), payments(20), supportTickets(10) }`
`400` invalid id · `404` not found.

### `PUT /api/admin/users/:userId`
**Body (whitelisted — only these fields are ever applied, no mass-assignment risk):**
`isActive`, `isVerified`, `role`, `companyId`, `name`, `email`, `phone`, `notes` (stored as `adminNotes`).
Setting `isVerified: true` also stamps `emailVerifiedAt`/`phoneVerifiedAt`. Sends the user an `account_update` notification listing which fields changed.
`400` if you target your own admin account, or if no whitelisted field was sent · `404` not found.

### `PUT /api/admin/users/:userId/suspend`
**Body:** `suspend` (boolean), `reason` (used only when suspending).
Sets `isActive: !suspend`; if the user is a driver, also forces their Driver doc `isActive/isOnline/isAvailable = false`. Sends `account_suspended` / `account_reactivated`.
**Note:** no self-protection check here (unlike `updateUser`) and no ObjectId format validation before the query.

### `DELETE /api/admin/users/:userId`
**Body:** `permanent` (default `false`).
- `permanent: false` (default) → **soft delete**: `isActive: false, isDeleted: true, deletedAt, deletedBy`; if driver, their Driver doc is deactivated but not deleted.
- `permanent: true` → **hard delete**: `User.findByIdAndDelete` + cascades to hard-delete the linked Driver doc if applicable.
`400` if targeting your own account · `404` not found. Runs in a DB transaction.

### `POST /api/admin/users/:userId/reset-password`
**Body:** `newPassword` (required, min 6 chars), `sendEmail` (default `true` — **dead param, no email is actually sent**).
Hashes the new password, clears `refreshToken` (forces logout everywhere), sends `password_reset` notification.
`400` missing/too-short password · `404` not found.

---

## Drivers

### `GET /api/admin/drivers/for-assignment`
Lightweight, **unpaginated** list for assignment pickers. **Must stay registered before `/drivers/:driverId`** in the router (already is).
**Query:** `search` (name/phone/plateNumber), `companyId`.
**Response:** `{ data: [{_id, name, phone, email, avatarUrl, company, companyId, vehicleType, vehicleColor, plateNumber, isOnline, isAvailable, approvalStatus, isSuspended, hasActiveDelivery, status}], count }`

### `GET /api/admin/drivers`
**Query:** `page`(1), `limit`(20), `isOnline`, `isAvailable`, `isActive` (`"true"`/other), `vehicleType`, `companyId`, `search`, `sortBy`(`createdAt`), `sortOrder`(`desc`), `minRating`.
**Response:** drivers (populated `userId`, `companyId`) + injected `.stats` `{totalDeliveries, completedDeliveries, totalEarnings, avgRating, totalTips}`.

> Since [this session's change] `source`/`partnerId` filters don't apply here (those were added to `getAllDeliveries`, not drivers) — this endpoint is unchanged from before.

### `GET /api/admin/drivers/:driverId`
**Response `data`:** `{ driver, deliveries(20), earnings(monthly aggregate, up to 12 months), recentActivity(5) }`
`404` not found. (No ObjectId format validation before query.)

### `PUT /api/admin/drivers/:driverId`
**Body (whitelisted):** `isActive`, `isVerified`, `vehicleType`, `plateNumber`, `companyId`, `notes` (→`adminNotes`).
Setting `isActive: false` also forces `isOnline`/`isAvailable` to `false`. Sends `driver_update` notification.

### `DELETE /api/admin/drivers/:driverId`
**Body:** `permanent` (default `false`).
- `permanent: false` → Driver doc only deactivated (`isActive/isOnline/isAvailable: false`), **not** deleted or flagged — but the linked **User is still soft-deleted** (`isDeleted: true`) either way.
- `permanent: true` → Driver doc hard-deleted (`findByIdAndDelete`).
Sends `driver_suspended` (urgent) notification regardless of branch. Runs in a transaction.

### `PUT /api/admin/drivers/:driverId/approve`
**Body:** `approve` (boolean), `reason` (stored as rejection/verification note).
Sets `driver.isVerified = approve`, `isActive = approve`, `verificationStatus: "approved"/"rejected"`, `verificationNotes`, `verifiedAt/By`; also flips the linked `User.isVerified`. Sends `driver_approved`/`driver_rejected`.

> ⚠️ **Naming inconsistency to be aware of:** this endpoint writes `driver.verificationStatus`, while the driver-matching/eligibility logic used elsewhere in the platform (and the `for-assignment` list above) reads `driver.approvalStatus` (`pending`/`approved`/`rejected`). These are two different fields on the same document — approving a driver here does **not** change `approvalStatus`. If your dashboard's "approve driver" action is meant to make a driver eligible for automatic matching, double check which field the UI/flow you're building actually needs; as of the last platform change, automatic matching only excludes `approvalStatus: "rejected"` (pending is now allowed through), independent of `verificationStatus`.

---

## Companies

### `GET /api/admin/companies`
**Query:** `page`(1), `limit`(20), `status`, `search` (name/email/contactPhone regex), `sortBy`(`createdAt`), `sortOrder`(`desc`).
**Response:** companies + injected `.stats` `{totalDrivers, totalDeliveries, completedDeliveries, totalRevenue}`.

### `GET /api/admin/companies/:companyId`
**Response `data`:** `{ company, drivers(20), deliveries(20), payments(20), admins }`
`404` not found.

### `PUT /api/admin/companies/:companyId`
**Body (whitelisted):** `status`, `name`, `email`, `contactPhone`, `address`, `notes` (→`adminNotes`).
Setting `status: "suspended"` also deactivates every driver at that company. Notifies all `company_admin` users of that company.

### `PUT /api/admin/companies/:companyId/approve`
**Body:** `approve` (boolean), `reason`.
Sets `status: "active"/"rejected"`, `verificationNotes`, `verifiedAt/By`. Notifies company admins.

### `PUT /api/admin/companies/:companyId/bank-details/approve`
No body needed. `400` if the company has no `bankDetails.accountNumber` on file yet. Sets `bankDetails.verified = true` + timestamps; notifies company admins.

### `DELETE /api/admin/companies/:companyId`
**Body:** `permanent` (default `false`).
- `permanent: false` → company `status: "suspended"`, all its drivers/users deactivated (nothing flagged `isDeleted`).
- `permanent: true` → hard delete: all company Drivers deleted, all company Users soft-marked `isDeleted`, Company doc hard-deleted.
Notifies company admins either way (urgent). Transaction-wrapped.

---

## Deliveries

### `GET /api/admin/deliveries`
**Query:** `page`(1), `limit`(20), `status`, `vehicleType`, `customerId`, `driverId`, `companyId`, **`source`** (`app` \| `partner_api`), **`partnerId`**, `startDate`, `endDate`, `search` (deliveryId/trackingNumber regex), `sortBy`(`createdAt`), `sortOrder`(`desc`).
**Response:** deliveries populated with `customerId`, `driverId.userId`, `companyId`, and **`partnerId`** (`businessName`, `contactEmail`).

`source`/`partnerId` are the two filters added for Partner API integration — every other param is original/unchanged behavior. See [UNASSIGNED_DELIVERY_FALLBACK_API.md](UNASSIGNED_DELIVERY_FALLBACK_API.md) for the `?status=created` unassigned-queue use case.

### `GET /api/admin/deliveries/:deliveryId`
**Response `data`:** `{ delivery, payment, chatMessages, voiceCalls }` (delivery now also populates `partnerId`).
`404` not found.

### `PUT /api/admin/deliveries/:deliveryId/status`
**Body:** `status` (required — one of `created, pending_driver, driver_assigned, picked_up, in_transit, delivered, cancelled`), `reason`.
Auto-stamps `pickupTime`/`deliveryTime`/`cancelledAt` when transitioning into those statuses (only if not already set). Notifies both customer and driver.
`400` invalid status (response includes the valid list).

### `PUT /api/admin/deliveries/:deliveryId/assign-driver`
**Body:** `driverId` (required). This is the manual-dispatch endpoint — see the fallback doc for the full walkthrough.
`400`: missing `driverId` · invalid ObjectId(s) · driver `isActive: false` · driver already has a `currentDeliveryId` (busy) · **delivery already has a driver assigned** (returns `data: {assignedDriverId, assignedDriverName}` instead of reassigning).
`404`: delivery or driver not found.

> ⚠️ Because the "already assigned" check returns `400` before ever reaching the reassignment branch, the reassignment/old-driver-notification code path in this handler is effectively unreachable as written — to reassign a delivery you'd currently need to clear `driverId` first via another route, or this needs a fix if reassignment is meant to work through this endpoint.

### `DELETE /api/admin/deliveries/:deliveryId`
**Body:** `permanent` (default `false`), `reason`.
`400` if the delivery is currently `driver_assigned`/`picked_up`/`in_transit` — cancel it first via the status endpoint.
- `permanent: false` → soft: `status: "cancelled"`, `isDeleted: true`, `cancellationReason`.
- `permanent: true` → hard delete.
Notifies customer + driver either way.

---

## Payments

### `GET /api/admin/payments`
**Query:** `page`(1), `limit`(20), `status`, `customerId`, `driverId`, `companyId`, `startDate`, `endDate`, `minAmount`, `maxAmount`, `sortBy`(`createdAt`), `sortOrder`(`desc`).
**Response:** payments (fully populated) + top-level `totals: {totalAmount, totalPlatformFees, totalCompanyRevenue}` alongside the usual `pagination`.

### `GET /api/admin/payments/:paymentId`
`404` not found.

### `POST /api/admin/payments/:paymentId/refund`
**Body:** `amount` (optional, defaults to the full payment amount), `reason`.
`400`: payment isn't `status: "successful"` · already refunded · `amount` exceeds the original payment.
Sets `refundStatus: "refunded"`, `refundAmount/Reason/At/By`; notifies the customer.

> ⚠️ **This only updates the database record** — there is no call out to Paystack/Flutterwave or any payment gateway here. If money actually needs to move back to the customer, that has to happen separately (manually or via a gateway API you call yourself); this endpoint alone does not trigger a real refund.

---

## Support Tickets

### `GET /api/admin/support-tickets`
**Query:** `page`(1), `limit`(20), `status`, `priority`, `issueType`, `search` (ticketId/title/description regex), `sortBy`(`createdAt`), `sortOrder`(`desc`).

### `GET /api/admin/support-tickets/:ticketId`
`404` not found.

### `PUT /api/admin/support-tickets/:ticketId`
**Body (whitelisted):** `status`, `priority`, `assignedTo`, `response`, `internalNotes`.
`status: "resolved"` stamps `resolvedAt/By`; setting `response` stamps `respondedAt/By`. Notifies the ticket's user if `status` or `response` changed (uses your `response` text as the notification message if provided).

---

## System, Notifications, Export

### `GET /api/admin/system/stats`
No params. Returns raw collection counts via `estimatedDocumentCount()`: `{ users, drivers, companies, deliveries, payments, supportTickets, chatMessages, voiceCalls }`.

### `POST /api/admin/notifications/bulk`
**Body:** `title` (required), `message` (required), `userIds` (array, optional), `roles` (array, optional), `type` (default `"announcement"`).
Targeting priority: explicit `userIds` first, else `roles`, else **every active user on the platform** if neither is given.
**Response `data`:** `{ recipientCount }`.

> ⚠️ **Swagger/implementation mismatch:** the route's Swagger comment documents a required `targetRole` field, but the actual controller never reads `targetRole` at all — it uses `userIds`/`roles` instead. Don't send `targetRole` expecting it to do anything; use `userIds` or `roles`, and be aware that omitting both broadcasts to your entire active user base.

### `GET /api/admin/export/:dataType`
**Path:** `dataType` — only `users`, `drivers`, `deliveries`, or `payments` (`400` for anything else, including `companies`/`support-tickets` which aren't supported here).
**Query:** `format` (default `json`), `startDate`, `endDate`.
**Response `data`:** `{ dataType, format, count, data: [...] }`.

> ⚠️ **`format` is accepted but not implemented.** Despite the Swagger doc advertising CSV/JSON export, the handler always returns JSON regardless of what `format` is set to — there is no CSV serialization code. If your dashboard needs an actual CSV download, that still needs to be built (client-side conversion of the JSON, or a real CSV writer added server-side).

---

## Admin-only endpoints outside `admin.routes.js`

### `GET /api/rides/admin/all`
Same auth requirement (`authenticate` + `authorize("admin")`), just mounted under `/api/rides` instead of `/api/admin`.
**Query:** `page`(1), `limit`(20), `status`, `companyId`.
**Response:** rides (populated `customerId`, `companyId`, `driverId.userId`) + standard `pagination`.

### Partner API management
`/api/admin/partners/...` — create/list/suspend/activate partners and regenerate their API secrets. Fully documented separately: [PARTNER_ADMIN_API.md](PARTNER_ADMIN_API.md).

---

## Known gaps / inconsistencies worth planning around

These aren't things I changed — they're pre-existing behaviors surfaced while cataloguing the API, worth knowing before you build against them:

1. **`approveDriver` vs `approvalStatus`** — approving a driver via `PUT /drivers/:id/approve` writes `verificationStatus`, not the `approvalStatus` field that driver-matching logic actually checks. Confirm which one your "approve" UI is supposed to affect.
2. **`assignDriver` reassignment is unreachable** — the guard that blocks assigning a driver to an already-assigned delivery fires before the reassignment logic ever runs.
3. **`issueRefund` doesn't call a payment gateway** — it's a DB-only status change.
4. **`exportData`'s `format` param is a no-op** — always returns JSON.
5. **`sendBulkNotification`'s Swagger doc references `targetRole`, which the code doesn't use** — use `userIds`/`roles` instead, and don't omit both unless you mean to notify everyone.
6. **`suspendUser` has no self-protection or ObjectId validation**, unlike `updateUser`/`deleteUser` which both block acting on your own admin account.
