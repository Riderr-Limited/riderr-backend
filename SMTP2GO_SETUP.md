# SMTP2GO Setup (Port 2525 - Never Blocked)

## Step 1: Sign Up (2 minutes)
1. Go to: https://www.smtp2go.com/pricing/
2. Click "Free" plan (1000 emails/month)
3. Sign up with email
4. Verify your email

## Step 2: Get SMTP Credentials
1. Login to SMTP2GO dashboard
2. Go to: Settings → Users → Add SMTP User
3. Create username (e.g., "riderr")
4. Copy the password shown

## Step 3: Update Production Env Variables

```env
EMAIL_HOST=mail.smtp2go.com
EMAIL_PORT=2525
EMAIL_USER=<your-smtp2go-username>
EMAIL_PASSWORD=<your-smtp2go-password>
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=auwaluizziddin2212@gmail.com
```

## Step 4: Redeploy

Done! Port 2525 works on ALL hosting providers.

---

## Why Port 2525?
- Port 587 = Blocked by your host ❌
- Port 465 = Also blocked ❌
- Port 2525 = Alternative SMTP port, never blocked ✅

## Test After Deploy
```bash
curl -X POST https://your-api.com/api/test/send-email \
  -H "Content-Type: application/json" \
  -d '{"email":"auwaluizziddin2212@gmail.com"}'
```

Should see: `✅ Email sent via SMTP to auwaluizziddin2212@gmail.com`
