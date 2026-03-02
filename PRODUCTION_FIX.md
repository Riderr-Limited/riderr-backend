# 🔥 PRODUCTION FIX - Port 587 Blocked

## Problem
Your hosting provider blocks port 587 (SMTP), so Brevo fails with "Connection timeout"

## ✅ SOLUTION: Use Gmail SMTP (Port 465)

### Step 1: Create Gmail App Password

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification (if not enabled)
3. Go to https://myaccount.google.com/apppasswords
4. Create app password for "Mail"
5. Copy the 16-character password

### Step 2: Update Environment Variables

Replace your current email config with:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_USER=auwaluizziddin2212@gmail.com
EMAIL_PASSWORD=<your-16-char-app-password>
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=auwaluizziddin2212@gmail.com
```

### Step 3: Redeploy

That's it! Gmail SMTP port 465 works on ALL hosting providers.

---

## Alternative: SendGrid (Recommended for Production)

SendGrid is more reliable than Gmail for production:

1. Sign up at https://sendgrid.com (free 100 emails/day)
2. Create API key
3. Update env:

```env
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASSWORD=<your-sendgrid-api-key>
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=auwaluizziddin2212@gmail.com
```

---

## Why Port 465 Works

- Port 587 (TLS) = Often blocked by cloud providers
- Port 465 (SSL) = Rarely blocked, more reliable
- Gmail/SendGrid = Trusted by all hosting platforms

---

## Test After Deploy

```bash
curl -X POST https://your-api.com/api/test/send-email \
  -H "Content-Type: application/json" \
  -d '{"email":"auwaluizziddin2212@gmail.com"}'
```

Should see: `✅ Email sent via SMTP`
