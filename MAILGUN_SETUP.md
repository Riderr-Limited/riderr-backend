# Mailgun Setup (Port 2525 - Works Everywhere)

## Step 1: Sign Up
1. Go to: https://signup.mailgun.com/new/signup
2. Sign up (free 5000 emails/month for 3 months)
3. Verify email

## Step 2: Get SMTP Credentials
1. Login to Mailgun dashboard
2. Go to: Sending → Domain settings → SMTP credentials
3. You'll see:
   - SMTP hostname: `smtp.mailgun.org`
   - Port: `587` or `2525` (use 2525)
   - Username: `postmaster@sandboxXXXX.mailgun.org`
   - Password: Click "Reset password" to get it

## Step 3: Update Production Env

```env
EMAIL_HOST=smtp.mailgun.org
EMAIL_PORT=2525
EMAIL_USER=postmaster@sandboxXXXXXXXX.mailgun.org
EMAIL_PASSWORD=<from-mailgun>
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=postmaster@sandboxXXXXXXXX.mailgun.org
```

⚠️ **Important**: Use the sandbox email as FROM address (not your Gmail)

## Step 4: Redeploy

Done!

---

## Can't Sign Up for Mailgun Either?

Use **Resend with your own email** (temporary solution):

Just change this in production:
```env
EMAIL_FROM_ADDRESS=auwaluizziddin2212@gmail.com
```

Resend will only send to `auwaluizziddin2212@gmail.com` but at least you can test.

To send to others, verify domain at: https://resend.com/domains
