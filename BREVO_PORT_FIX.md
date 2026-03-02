# Brevo Port Fix (1 Minute)

## Problem
Your host blocks port 587, but Brevo supports multiple ports.

## Solution
Change port from 587 to 465 in production:

```env
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=465
EMAIL_USER=a3ab12001@smtp-brevo.com
EMAIL_PASSWORD=bskSCj6iHA0U2GH
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=auwaluizziddin2212@gmail.com
```

**Only change**: `EMAIL_PORT=465` (was 587)

## Redeploy

That's it! Port 465 (SSL) is less likely to be blocked than 587 (TLS).

---

## If Port 465 Also Fails

Try port 25:
```env
EMAIL_PORT=25
```

Or port 2525 (if Brevo supports it - check their docs).

---

## Test After Deploy
```bash
curl -X POST https://your-api.com/api/test/send-email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

Should see: `✅ Email sent via SMTP`
