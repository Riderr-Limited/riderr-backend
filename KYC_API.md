# Individual Rider Verification (KYC) API

Riderr lets **individuals** (people without a company) sign up as riders. Before they can go online they must pass:

1. **NIN check:** the NIN must exist on NIMC, and the name on it must match the account name.
2. **Selfie check:** a live selfie, checked for liveness and matched against the NIN photo.
3. **2 guarantors:** each one confirms through a link: phone OTP, then their own NIN.
4. **Admin approval:** a Riderr admin reviews everything and approves or rejects.

**Company riders skip all of this.** Their company vouches for them, and nothing about them has changed. Riders who were already verified stay verified.

All responses use the usual shape: `{ success, data }` or `{ success: false, message, code }`.

---

## 1. Sign up (individual rider)

`POST /api/auth/signup-individual-driver` (public)

```json
{
  "name": "Amina Bello Yusuf",
  "email": "amina@example.com",
  "phone": "08012345678",
  "password": "atleast8chars",
  "vehicleType": "bike",
  "plateNumber": "KAN123AB",
  "vehicleColor": "Red"
}
```

- `name` must be the **full name exactly as on the NIN**, with at least two words. The NIN check compares against it.
- `vehicleType`: `bike | car | van | truck`.
- Returns `accessToken`, `refreshToken`, `user`, and `kyc: { status: "not_started", nextStep: "submit_nin" }`.

Email verification works the same as for every other account.

---

## 2. Rider endpoints (Bearer token, role `driver`)

### `GET /api/kyc/status`

Use this to drive the onboarding screens.

```json
{
  "onboardingType": "individual",
  "required": true,
  "status": "in_progress",
  "canWork": false,
  "nextStep": "submit_selfie",
  "checks": {
    "nin":  { "status": "passed", "last4": "8901", "attemptsLeft": 2 },
    "face": { "status": "not_started", "attemptsLeft": 3 },
    "guarantors": { "status": "not_started", "required": 2, "confirmed": 0, "list": [] }
  }
}
```

| `nextStep` | Show the rider |
|---|---|
| `submit_nin` | NIN entry screen, with a consent checkbox |
| `submit_selfie` | Camera screen (front camera, live capture, not the gallery) |
| `add_guarantors` | Guarantor form |
| `await_review` | "We're reviewing your application" |
| `contact_support` | Rejected: show `rejectionReason` |
| `null` | Approved, `canWork: true` |

For company riders this returns `{ "onboardingType": "company", "required": false, "canWork": true }`.

Each check's `status` is one of `not_started | pending | passed | failed | manual_review`.
The overall `status` is one of `not_started | in_progress | pending_review | approved | rejected`.

### `POST /api/kyc/nin`

```json
{ "nin": "12345678901", "consent": true }
```

`consent` must be `true`: the rider agrees to Riderr checking their NIN with NIMC. Show the consent text next to the checkbox.

| Error `code` | Meaning |
|---|---|
| `CONSENT_REQUIRED` | Consent box not ticked |
| `INVALID_NIN` | The NIN isn't 11 digits |
| `NIN_NOT_FOUND` | NIMC has no record of this NIN |
| `NIN_NAME_MISMATCH` | The name doesn't match. The rider must fix their account name (`PUT /api/auth/profile`), then retry |
| `NIN_IN_USE` (409) | This NIN is already on another Riderr account |
| `NIN_ATTEMPTS_EXCEEDED` (429) | 3 tries used. The rider must contact support, and an admin can reopen |

A partial name match (for example, only the surname matches) returns 200 with `nin.status = "manual_review"`. The rider continues, and an admin decides later.

### `POST /api/kyc/selfie`

`multipart/form-data` with a single field, **`selfie`** (JPEG, PNG or WEBP, at most 8 MB).

| Error `code` | Meaning |
|---|---|
| `NIN_REQUIRED` | The NIN step isn't done yet |
| `INVALID_IMAGE` | The file isn't an image |
| `FACE_FAILED` | Liveness failed, or the face doesn't match the NIN photo. `message` tells the rider what to fix |
| `FACE_ATTEMPTS_EXCEEDED` (429) | 3 tries used |

### `POST /api/kyc/guarantors`

```json
{
  "guarantors": [
    { "name": "Musa Ibrahim", "phone": "08031110001", "relationship": "family", "address": "...", "occupation": "Teacher" },
    { "name": "Grace Okafor", "phone": "08031110002", "relationship": "employer" }
  ]
}
```

- `relationship`: `family | employer | religious_leader | community_leader | friend | colleague | other`.
- The rider can't use their own phone, and the two guarantors need different phones. Maximum 2 active guarantors at a time.
- The response includes a **`link` for each guarantor. It is returned only this once.** Let the rider share it by SMS or WhatsApp (open the share sheet).

```json
{ "guarantors": [ { "id": "...", "name": "Musa Ibrahim", "link": "https://riderr.ng/guarantor/<token>", "expiresAt": "..." } ] }
```

Links expire after 72 hours.

### `POST /api/kyc/guarantors/:guarantorId/link`

Creates a new link, for when the old one expired or got lost. The old link stops working.

### `DELETE /api/kyc/guarantors/:guarantorId`

Removes a guarantor, for example one who declined or failed, so the rider can add someone else.

### Going online

`POST /api/driver/online-status { "isOnline": true }` returns **403**, `code: "KYC_REQUIRED"`, until an individual rider is approved. Use it to send them to the onboarding screens.

---

## 3. Guarantor pages (public, no login)

The web page at `https://riderr.ng/guarantor/<token>` must call these endpoints, using the token from the URL.

| Step | Endpoint | Body |
|---|---|---|
| 1. Show the request | `GET /api/guarantors/:token` | none |
| 2. Send an SMS code | `POST /api/guarantors/:token/otp` | none |
| 3. Verify the code | `POST /api/guarantors/:token/otp/verify` | `{ "code": "123456" }` |
| 4a. Accept | `POST /api/guarantors/:token/respond` | `{ "accept": true, "nin": "11 digits", "consent": true }` |
| 4b. Decline | `POST /api/guarantors/:token/respond` | `{ "accept": false }` |

Step 1 returns `riderName` (first name plus last initial only), `guarantorName`, `relationship`, `status`, a masked `phoneHint`, and a `responsibilities` list to show the guarantor before they accept.

Rules:
- The name on the guarantor's NIN must match the name the rider entered. They get 3 tries.
- A guarantor can't use the rider's own NIN.
- One person can guarantee at most **2** riders at a time (`GUARANTOR_LIMIT`).
- Error codes: `INVALID_LINK` (404), `LINK_EXPIRED` (410), `REVOKED` (410), `BAD_OTP`, `GUARANTOR_NIN_FAILED`, `GUARANTOR_LIMIT`.

The rider gets a push notification when a guarantor confirms, declines or fails. Once all checks are done, the application moves to `pending_review` automatically.

---

## 4. Admin endpoints (Bearer token, role `admin`)

| Endpoint | What it does |
|---|---|
| `GET /api/admin/kyc?status=pending_review&page=1&limit=20` | Review queue. `status`: `pending_review` (default) / `in_progress` / `approved` / `rejected` / `not_started` / `all` |
| `GET /api/admin/kyc/:driverId` | Full detail: rider, vehicle, documents, every check, guarantors, history |
| `GET /api/admin/kyc/:driverId/selfie` | The selfie image (needs the auth header, so fetch it as a blob and show it) |
| `POST /api/admin/kyc/:driverId/checks/:check` | Settle a `manual_review` check. `check` = `nin` or `face`. Body: `{ "status": "passed" \| "failed", "note": "why" }` |
| `POST /api/admin/kyc/:driverId/approve` | `{ "note": "optional" }`. Only works once NIN, face and guarantors have all passed |
| `POST /api/admin/kyc/:driverId/reject` | `{ "reason": "required" }`. Takes the rider offline and notifies them |
| `POST /api/admin/kyc/:driverId/reopen` | `{ "note": "required" }`. Lets a rejected or locked-out rider try again |

On the NIN check, compare `kyc.nin.providerName` (the name NIMC returned) with the account name. The full NIN is never shown, only `last4`. Every admin action is written to `kyc.history`, with who did it and when.

---

## 5. Configuration (environment variables)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `KYC_ENCRYPTION_KEY` | **yes** | none | 64 hex characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Back it up.** If it's lost, stored NINs can't be read |
| `KYC_PROVIDER` | | `mock` | `mock` or `dojah` |
| `DOJAH_APP_ID`, `DOJAH_SECRET_KEY` | for Dojah | none | From the Dojah dashboard |
| `DOJAH_BASE_URL` | | `https://sandbox.dojah.io` | Use `https://api.dojah.io` for live |
| `KYC_ALLOW_MOCK` | | `false` | The mock is **blocked in production** unless this is `true` |
| `KYC_GUARANTOR_LINK_BASE_URL` | | `FRONTEND_URL` | The site that hosts `/guarantor/:token` |
| `KYC_REQUIRED_GUARANTORS` | | `2` | |
| `KYC_MAX_NIN_ATTEMPTS` / `KYC_MAX_FACE_ATTEMPTS` | | `3` | Each attempt is a paid provider call |
| `KYC_FACE_MATCH_THRESHOLD` | | `0.8` | Scores 0.6 up to this go to manual review |
| `KYC_MAX_RIDERS_PER_GUARANTOR` | | `2` | |
| `KYC_GUARANTOR_LINK_TTL_HOURS` | | `72` | |

Guarantor OTPs use the existing Twilio Verify settings (`TWILIO_*`). Without Twilio, and outside production, the OTP is always `123456`.

### Testing with the mock provider

| NIN | Result |
|---|---|
| `00000000000` | NIN not found |
| `11111111111` | Found, but the name doesn't match |
| `22222222222` | The selfie doesn't match |
| `33333333333` | Liveness fails |
| any other 11 digits | Passes, using the name on the account |

---

## 6. Data protection (NDPA)

- NINs are encrypted with AES-256-GCM. A separate keyed hash is used only to detect duplicate NINs.
- Selfies are re-encoded, which strips location data, and stored in `private_uploads/kyc/`. They are **not** in the public `/uploads` folder. Only admins can fetch them, through the API.
- When the rider and the guarantors consent, the time and IP address are recorded.
