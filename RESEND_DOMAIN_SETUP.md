# Resend Domain Verification (5 Minutes)

## Step 1: Add Domain to Resend
1. Go to: https://resend.com/domains
2. Click "Add Domain"
3. Enter your domain (e.g., `riderr.ng` or `yourdomain.com`)
4. Click "Add"

## Step 2: Add DNS Records
Resend will show you 3 DNS records to add. Go to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.) and add:

### Record 1: SPF (TXT)
```
Type: TXT
Name: @
Value: v=spf1 include:_spf.resend.com ~all
```

### Record 2: DKIM (TXT)
```
Type: TXT
Name: resend._domainkey
Value: <copy from Resend dashboard>
```

### Record 3: DMARC (TXT)
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none
```

## Step 3: Wait for Verification (2-10 minutes)
- Resend will auto-verify
- Refresh the page until status shows "Verified ✓"

## Step 4: Update Production Env

Remove ALL SMTP settings and use ONLY Resend:

```env
# Remove these (comment out or delete):
# EMAIL_HOST=...
# EMAIL_PORT=...
# EMAIL_USER=...
# EMAIL_PASSWORD=...

# Keep only these:
RESEND_API_KEY=re_VMXpiYNy_8BrGjfEAJHot3UQKyp9EULAX
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
```

⚠️ **Important**: `EMAIL_FROM_ADDRESS` must use your verified domain!

## Step 5: Update Code to Use Resend Only

No code changes needed! Your service already has Resend as fallback.

Just remove SMTP env vars and it will automatically use Resend.

## Step 6: Redeploy

Done! Resend uses HTTP (not SMTP), so no port blocking issues.

---

## What Domain Should I Use?

- If you have `riderr.ng` → Use `noreply@riderr.ng`
- If you have `yourdomain.com` → Use `noreply@yourdomain.com`
- Subdomain works too: `noreply@mail.yourdomain.com`

---

## Test After Deploy

```bash
curl -X POST https://your-api.com/api/test/send-email \
  -H "Content-Type: application/json" \
  -d '{"email":"anyone@example.com"}'
```

Should work for ANY email address now! ✅
