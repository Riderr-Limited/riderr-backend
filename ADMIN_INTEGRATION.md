# Riderr Admin Panel — Frontend Integration Guide

**Base URL:** `https://riderr-backend.onrender.com/api`  
**All protected routes require:** `Authorization: Bearer <accessToken>`

---

## Admin Credentials

```
Email:    admin@riderr.ng
Password: Riderr@Admin2025
Role:     admin
```
> ⚠️ Change the password after first login via the change-password endpoint.

---

## 1. Authentication

### Login
```
POST /auth/login
```
**Body:**
```json
{
  "email": "admin@riderr.ng",
  "password": "Riderr@Admin2025"
}
```
**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt_token>",
    "refreshToken": "<refresh_token>",
    "user": {
      "_id": "...",
      "name": "Riderr Super Admin",
      "email": "admin@riderr.ng",
      "role": "admin",
      "isVerified": true
    }
  }
}
```
> Store `accessToken` and `refreshToken` in your app state. Send `accessToken` as `Authorization: Bearer <token>` on every protected request.

---

### Refresh Token
```
POST /auth/refresh
```
**Body:**
```json
{ "refreshToken": "<refresh_token>" }
```
**Response:** New `accessToken` + `refreshToken`.

---

### Logout
```
POST /auth/logout
Authorization: Bearer <token>
```

---

### Get Current Admin Profile
```
GET /auth/me
Authorization: Bearer <token>
```

---

### Change Password
```
POST /auth/change-password
Authorization: Bearer <token>
```
**Body:**
```json
{
  "currentPassword": "Riderr@Admin2025",
  "newPassword": "YourNewPassword123"
}
```

---

## 2. Dashboard & Analytics

### Get Dashboard Overview
```
GET /admin/dashboard
GET /admin/dashboard?period=7days
GET /admin/dashboard?period=30days
GET /admin/dashboard?period=90days
GET /admin/dashboard?startDate=2025-01-01&endDate=2025-06-30
```
**Response includes:**
```json
{
  "data": {
    "users":      { "total", "byRole", "verified", "active", "newThisPeriod" },
    "drivers":    { "total", "online", "available", "byVehicleType", "topRated" },
    "companies":  { "total", "active", "pending" },
    "deliveries": { "total", "byStatus", "thisPeriod", "byVehicleType", "dailyStats" },
    "revenue":    { "totalRevenue", "platformFees", "companyRevenue", "totalTransactions", "avgTransactionValue" },
    "recentActivities": [...]
  }
}
```

---

### Get Platform Analytics
```
GET /admin/analytics
GET /admin/analytics?period=7days&metric=all
GET /admin/analytics?metric=users
GET /admin/analytics?metric=deliveries
GET /admin/analytics?metric=revenue
GET /admin/analytics?metric=drivers
```
**metric options:** `all` | `users` | `deliveries` | `revenue` | `drivers`

---

### Get System Stats (counts)
```
GET /admin/system/stats
```
**Response:**
```json
{
  "data": {
    "users": 120,
    "drivers": 45,
    "companies": 24,
    "deliveries": 890,
    "payments": 750,
    "supportTickets": 30,
    "chatMessages": 4200,
    "voiceCalls": 180
  }
}
```

---

## 3. User Management

### Get All Users
```
GET /admin/users
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| page | number | Default: 1 |
| limit | number | Default: 20 |
| role | string | `customer` \| `driver` \| `company_admin` \| `admin` |
| isVerified | boolean | `true` \| `false` |
| isActive | boolean | `true` \| `false` |
| companyId | string | Filter by company |
| search | string | Search name/email/phone |
| sortBy | string | Default: `createdAt` |
| sortOrder | string | `asc` \| `desc` |
| startDate | date | Filter by creation date |
| endDate | date | Filter by creation date |

**Example:**
```
GET /admin/users?role=driver&isActive=true&page=1&limit=20
GET /admin/users?search=john&role=customer
```

---

### Get User by ID
```
GET /admin/users/:userId
```
**Response includes:** user details + stats + deliveries + payments + support tickets.

---

### Update User
```
PUT /admin/users/:userId
```
**Body (all optional):**
```json
{
  "isActive": true,
  "isVerified": true,
  "role": "customer",
  "companyId": "...",
  "name": "New Name",
  "email": "new@email.com",
  "phone": "+2348012345678",
  "notes": "Admin note"
}
```

---

### Suspend / Unsuspend User
```
PUT /admin/users/:userId/suspend
```
**Body:**
```json
{ "suspend": true, "reason": "Violation of terms" }
{ "suspend": false }
```

---

### Delete User (Soft Delete)
```
DELETE /admin/users/:userId
```
**Body:**
```json
{ "permanent": false }
```
> Set `"permanent": true` for hard delete (irreversible).

---

### Reset User Password
```
POST /admin/users/:userId/reset-password
```
**Body:**
```json
{ "newPassword": "NewPass@123" }
```

---

## 4. Driver Management

### Get All Drivers
```
GET /admin/drivers
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| page | number | Default: 1 |
| limit | number | Default: 20 |
| isOnline | boolean | Filter online drivers |
| isAvailable | boolean | Filter available drivers |
| isActive | boolean | Filter active drivers |
| vehicleType | string | `bike` \| `car` \| `van` \| `truck` |
| companyId | string | Filter by company |
| minRating | number | Minimum rating filter |
| search | string | Search name/phone/plate |
| sortBy | string | Default: `createdAt` |
| sortOrder | string | `asc` \| `desc` |

---

### Get Driver by ID
```
GET /admin/drivers/:driverId
```
**Response includes:** driver profile + deliveries + monthly earnings + recent activity.

---

### Update Driver
```
PUT /admin/drivers/:driverId
```
**Body (all optional):**
```json
{
  "isActive": true,
  "isVerified": true,
  "vehicleType": "bike",
  "plateNumber": "ABC-123-XY",
  "companyId": "...",
  "notes": "Admin note"
}
```

---

### Approve / Reject Driver
```
PUT /admin/drivers/:driverId/approve
```
**Body:**
```json
{ "approve": true }
{ "approve": false, "reason": "Incomplete documents" }
```

---

## 5. Company Management

### Get All Companies
```
GET /admin/companies
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| page | number | Default: 1 |
| limit | number | Default: 20 |
| status | string | `pending` \| `active` \| `suspended` \| `rejected` |
| search | string | Search name/email/phone |
| sortBy | string | Default: `createdAt` |
| sortOrder | string | `asc` \| `desc` |

**Example:**
```
GET /admin/companies?status=pending
GET /admin/companies?status=active&page=1&limit=10
```

---

### Get Company by ID
```
GET /admin/companies/:companyId
```
**Response includes:** company details + drivers + deliveries + payments + admins.

---

### Update Company
```
PUT /admin/companies/:companyId
```
**Body (all optional):**
```json
{
  "status": "active",
  "name": "Updated Name",
  "contactPhone": "+2348012345678",
  "address": "New Address",
  "notes": "Admin note"
}
```
> Setting `status: "suspended"` automatically deactivates all company drivers.

---

### Approve / Reject Company
```
PUT /admin/companies/:companyId/approve
```
**Body:**
```json
{ "approve": true }
{ "approve": false, "reason": "Invalid documents" }
```
**Status values after action:**
- Approved → `status: "active"`
- Rejected → `status: "rejected"`

---

### Approve Company Bank Details
```
PUT /admin/companies/:companyId/bank-details/approve
```
**No body required.**

**Response:**
```json
{
  "success": true,
  "message": "Bank details approved successfully",
  "data": {
    "accountName": "...",
    "accountNumber": "...",
    "bankName": "...",
    "verified": true,
    "verifiedAt": "2025-01-01T00:00:00.000Z"
  }
}
```

---

## 6. Delivery Management

### Get All Deliveries
```
GET /admin/deliveries
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| page | number | Default: 1 |
| limit | number | Default: 20 |
| status | string | See statuses below |
| vehicleType | string | `bike` \| `car` \| `van` \| `truck` |
| customerId | string | Filter by customer |
| driverId | string | Filter by driver |
| companyId | string | Filter by company |
| startDate | date | Date range start |
| endDate | date | Date range end |
| search | string | Search by delivery ID or tracking number |
| sortBy | string | Default: `createdAt` |
| sortOrder | string | `asc` \| `desc` |

**Delivery statuses:** `created` | `pending_driver` | `driver_assigned` | `picked_up` | `in_transit` | `delivered` | `cancelled`

---

### Get Delivery by ID
```
GET /admin/deliveries/:deliveryId
```
**Response includes:** delivery + payment + chat messages + voice calls.

---

### Update Delivery Status
```
PUT /admin/deliveries/:deliveryId/status
```
**Body:**
```json
{
  "status": "delivered",
  "reason": "Admin override"
}
```

---

### Assign Driver to Delivery
```
PUT /admin/deliveries/:deliveryId/assign-driver
```
**Body:**
```json
{ "driverId": "<driver_object_id>" }
```

---

## 7. Payment Management

### Get All Payments
```
GET /admin/payments
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| page | number | Default: 1 |
| limit | number | Default: 20 |
| status | string | `successful` \| `pending` \| `failed` |
| customerId | string | Filter by customer |
| driverId | string | Filter by driver |
| companyId | string | Filter by company |
| startDate | date | Date range start |
| endDate | date | Date range end |
| minAmount | number | Minimum amount |
| maxAmount | number | Maximum amount |
| sortBy | string | Default: `createdAt` |
| sortOrder | string | `asc` \| `desc` |

**Response includes:** payments list + totals summary:
```json
{
  "totals": {
    "totalAmount": 500000,
    "totalPlatformFees": 50000,
    "totalCompanyRevenue": 450000
  }
}
```

---

### Get Payment by ID
```
GET /admin/payments/:paymentId
```

---

### Issue Refund
```
POST /admin/payments/:paymentId/refund
```
**Body:**
```json
{
  "amount": 5000,
  "reason": "Customer complaint - item not delivered"
}
```
> Omit `amount` to refund the full payment amount.

---

## 8. Support Ticket Management

### Get All Support Tickets
```
GET /admin/support-tickets
```
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| page | number | Default: 1 |
| limit | number | Default: 20 |
| status | string | `open` \| `in_progress` \| `resolved` \| `closed` |
| priority | string | `low` \| `medium` \| `high` \| `urgent` |
| issueType | string | Filter by issue type |
| search | string | Search by ticket ID/title/description |
| sortBy | string | Default: `createdAt` |
| sortOrder | string | `asc` \| `desc` |

---

### Get Support Ticket by ID
```
GET /admin/support-tickets/:ticketId
```

---

### Update Support Ticket
```
PUT /admin/support-tickets/:ticketId
```
**Body (all optional):**
```json
{
  "status": "resolved",
  "priority": "high",
  "assignedTo": "<admin_user_id>",
  "response": "We have resolved your issue.",
  "internalNotes": "Checked with driver, confirmed delivery failed."
}
```

---

## 9. Notifications

### Send Bulk Notification
```
POST /admin/notifications/bulk
```
**Body:**
```json
{
  "title": "System Maintenance",
  "message": "The platform will be down for 30 minutes tonight.",
  "type": "announcement",
  "roles": ["driver", "customer"]
}
```
> To send to specific users: use `"userIds": ["id1", "id2"]` instead of `roles`.  
> To send to ALL active users: omit both `userIds` and `roles`.

---

## 10. Data Export

```
GET /admin/export/:dataType
```
**dataType options:** `users` | `drivers` | `deliveries` | `payments`

**Query params:**
```
GET /admin/export/users?startDate=2025-01-01&endDate=2025-06-30
GET /admin/export/deliveries?format=json
```

---

## 11. Standard Response Format

All endpoints return:
```json
{
  "success": true | false,
  "message": "...",
  "data": { ... }
}
```

Paginated endpoints also return:
```json
{
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "pages": 5,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

## 12. Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 400 | Bad request / validation error |
| 401 | Not authenticated / token expired |
| 403 | Forbidden / insufficient role |
| 404 | Resource not found |
| 409 | Conflict (duplicate) |
| 423 | Account locked |
| 500 | Server error |

**Token expired response:**
```json
{
  "success": false,
  "message": "Token expired. Please login again.",
  "code": "TOKEN_EXPIRED"
}
```
> When you receive `TOKEN_EXPIRED`, call `POST /auth/refresh` with the stored `refreshToken` to get a new `accessToken`.

---

## 13. Frontend Implementation Tips

### Axios Setup
```js
import axios from "axios";

const api = axios.create({
  baseURL: "https://riderr-backend.onrender.com/api",
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("adminToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on token expiry
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.data?.code === "TOKEN_EXPIRED") {
      const refreshToken = localStorage.getItem("adminRefreshToken");
      const { data } = await axios.post("/auth/refresh", { refreshToken });
      localStorage.setItem("adminToken", data.data.accessToken);
      localStorage.setItem("adminRefreshToken", data.data.refreshToken);
      error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
      return api.request(error.config);
    }
    return Promise.reject(error);
  }
);

export default api;
```

### Login Flow
```js
const login = async (email, password) => {
  const { data } = await api.post("/auth/login", { email, password });
  localStorage.setItem("adminToken", data.data.accessToken);
  localStorage.setItem("adminRefreshToken", data.data.refreshToken);
  return data.data.user;
};
```

### Approve a Company
```js
// Approve
await api.put(`/admin/companies/${companyId}/approve`, { approve: true });

// Reject
await api.put(`/admin/companies/${companyId}/approve`, {
  approve: false,
  reason: "Invalid documents",
});
```

### Approve Bank Details
```js
await api.put(`/admin/companies/${companyId}/bank-details/approve`);
```

### Paginated Fetch
```js
const getUsers = async (page = 1, filters = {}) => {
  const params = new URLSearchParams({ page, limit: 20, ...filters });
  const { data } = await api.get(`/admin/users?${params}`);
  return data; // { data: [...], pagination: {...} }
};
```

---

## 14. Company Status Flow

```
Registration → pending → (Admin approves) → active
                       → (Admin rejects)  → rejected
active → (Admin suspends) → suspended
suspended → (Admin updates status: active) → active
```

## 15. Driver Approval Flow

```
Driver registers → approvalStatus: "pending"
Admin approves  → approvalStatus: "approved", isVerified: true, isActive: true
Admin rejects   → approvalStatus: "rejected", isVerified: false, isActive: false
```
