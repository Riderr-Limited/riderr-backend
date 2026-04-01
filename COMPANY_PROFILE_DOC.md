# Company — Registration, Login & Edit Profile
## Frontend Integration Guide

**Base URL:** `https://your-domain.com`
**Auth:** `Authorization: Bearer <accessToken>`

---

## 1. Company Registration

```
POST /api/auth/signup
```

**Request:**
```json
{
  "name": "Express Logistics Ltd",
  "email": "admin@expresslogistics.com",
  "phone": "+2348012345678",
  "password": "Password123!",
  "role": "company_admin",
  "companyName": "Express Logistics Ltd",
  "businessLicense": "BN-12345678",
  "taxId": "TAX-987654",
  "address": "12 Marina Street",
  "city": "Lagos",
  "state": "Lagos",
  "lga": "Lagos Island",
  "contactPhone": "+2348012345678",
  "contactEmail": "admin@expresslogistics.com"
}
```

**Success response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "64f...",
      "name": "Express Logistics Ltd",
      "email": "admin@expresslogistics.com",
      "role": "company_admin",
      "companyId": "64f..."
    },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

> Company is **automatically active** — no approval needed. Store `accessToken`, `refreshToken`, and `companyId`.

---

## 2. Company Login

```
POST /api/auth/login
```

**Request:**
```json
{
  "email": "admin@expresslogistics.com",
  "password": "Password123!"
}
```

**Response:** same shape as registration — store `accessToken`, `refreshToken`, `user.companyId`.

---

## 3. Get Company Profile

```
GET /api/company/profile
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f...",
    "name": "Express Logistics Ltd",
    "slug": "express-logistics-ltd",
    "businessLicense": "BN-12345678",
    "taxId": "TAX-987654",
    "address": "12 Marina Street",
    "city": "Lagos",
    "state": "Lagos",
    "lga": "Lagos Island",
    "contactPhone": "+2348012345678",
    "contactEmail": "admin@expresslogistics.com",
    "logoUrl": null,
    "status": "active",
    "isActive": true,
    "bankAccount": {
      "accountNumber": "7043995559",
      "accountName": "AUWALU MUHAMMAD IZZIDDIN",
      "bankCode": "999992",
      "bankName": "Opay",
      "verified": false
    },
    "settings": {
      "autoAccept": false,
      "commissionRate": 15,
      "notificationChannels": ["push"],
      "operatingHours": { "start": "00:00", "end": "23:59" }
    },
    "stats": {
      "totalDrivers": 5,
      "onlineDrivers": 2,
      "totalDeliveries": 38,
      "totalEarnings": 45000
    },
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## 4. Edit Company Profile

```
PUT /api/company/profile
Authorization: Bearer <token>
```

**Request — send only fields you want to update:**
```json
{
  "name": "Express Logistics Nigeria Ltd",
  "address": "15 Broad Street",
  "city": "Lagos",
  "state": "Lagos",
  "lga": "Lagos Island",
  "contactPhone": "+2348099999999",
  "contactEmail": "info@expresslogistics.com",
  "description": "Fast and reliable delivery across Lagos",
  "website": "https://expresslogistics.com",
  "logo": "https://..."
}
```

**Editable fields:**
| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Company display name |
| `address` | string | Street address |
| `city` | string | City |
| `state` | string | State |
| `lga` | string | Local government area |
| `contactPhone` | string | Nigerian format |
| `contactEmail` | string | Contact email |
| `description` | string | About the company |
| `website` | string | Company website URL |
| `logo` | string | Logo image URL |
| `businessLicense` | string | Business license number |
| `taxId` | string | Tax ID |

**Success response:**
```json
{
  "success": true,
  "message": "Company profile updated successfully",
  "data": {
    "_id": "64f...",
    "name": "Express Logistics Nigeria Ltd",
    "address": "15 Broad Street",
    "contactPhone": "+2348099999999",
    ...
  }
}
```

---

## 5. Get My User Profile (logged-in admin)

```
GET /api/auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f...",
    "name": "Auwalu Izziddin",
    "email": "admin@expresslogistics.com",
    "phone": "+2348012345678",
    "role": "company_admin",
    "companyId": "64f...",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## 6. Update Admin Personal Profile

```
PUT /api/auth/profile
Authorization: Bearer <token>
```

```json
{
  "name": "Auwalu Muhammad Izziddin",
  "phone": "+2348012345678",
  "avatarUrl": "https://..."
}
```

---

## 7. Change Password

```
POST /api/auth/change-password
Authorization: Bearer <token>
```

```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword456!",
  "confirmPassword": "NewPassword456!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

---

## 8. Company Settings

```
PUT /api/company/settings
Authorization: Bearer <token>
```

```json
{
  "autoAccept": false,
  "commissionRate": 15,
  "notificationChannels": ["push", "email"],
  "operatingHours": {
    "start": "08:00",
    "end": "22:00"
  }
}
```

---

## 9. Logout

```
POST /api/auth/logout
Authorization: Bearer <token>
```

---

## All Company Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register company |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/refresh` | Refresh token |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get logged-in admin profile |
| PUT | `/api/auth/profile` | Update admin personal profile |
| POST | `/api/auth/change-password` | Change password |
| GET | `/api/company/profile` | Get company profile |
| PUT | `/api/company/profile` | Edit company profile |
| PUT | `/api/company/settings` | Update settings |
| GET | `/api/company/stats` | Company statistics |
| GET | `/api/company/drivers` | List company drivers |
| GET | `/api/company/notifications` | Company notifications |
| GET | `/api/payments/company-payments` | Payment history |
| GET | `/api/payments/company/bank-account` | Get bank account |
| POST | `/api/payments/company/setup-bank-account` | Add bank account |
| PUT | `/api/payments/company/bank-account` | Edit bank account |
| DELETE | `/api/payments/company/bank-account` | Remove bank account |
| GET | `/api/payments/verify-account` | Verify account number |
| GET | `/api/payments/banks` | Get bank list |

---

## Frontend — Edit Profile Screen

```
onLoad:
  profile = await GET /api/company/profile
  fill form fields with profile data

onSave:
  PUT /api/company/profile  { only changed fields }
  
  if success → show "Profile updated!" toast
  if error   → show error message

onChangePassword:
  POST /api/auth/change-password
  { currentPassword, newPassword, confirmPassword }
```

---

## Token Storage (fix for localStorage error)

```javascript
// After login/signup — store correctly
const onLoginSuccess = (response) => {
  const { user, accessToken, refreshToken } = response.data
  
  localStorage.setItem('accessToken', accessToken)
  localStorage.setItem('refreshToken', refreshToken)
  localStorage.setItem('user', JSON.stringify(user))
}

// Read token safely — never crashes
const getToken = () => localStorage.getItem('accessToken') || ''

const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')
  } catch {
    return {}
  }
}

// Add to every request
const authHeader = () => ({
  Authorization: `Bearer ${getToken()}`
})

// On 401 — refresh token
const onUnauthorized = async () => {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) { logout(); return; }
  
  const res = await POST('/api/auth/refresh', { refreshToken })
  if (res.success) {
    localStorage.setItem('accessToken', res.data.accessToken)
    // retry original request
  } else {
    logout()
  }
}

const logout = () => {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  navigate('/login')
}
```
