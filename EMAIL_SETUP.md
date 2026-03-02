# Email Configuration Guide - Production Ready

## ✅ Current Status
Your email service is now configured with **dual fallback system**:
1. **Primary**: Brevo SMTP (currently working ✓)
2. **Fallback**: Resend API (if SMTP fails)
3. **Dev Mode**: Console logging (if both fail in development)

## 🚀 Deployment Checklist

### Required Environment Variables
```env
# Email Configuration (Brevo SMTP)
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USER=a3ab12001@smtp-brevo.com
EMAIL_PASSWORD=bskSCj6iHA0U2GH
EMAIL_FROM_NAME=Riderr
EMAIL_FROM_ADDRESS=auwaluizziddin2212@gmail.com

# Fallback (Resend API)
RESEND_API_KEY=re_VMXpiYNy_8BrGjfEAJHot3UQKyp9EULAX
```

### For Azure/AWS/Heroku Deployment

1. **Add all environment variables** to your hosting platform
2. **No trailing spaces** in passwords
3. **Port 587** must be allowed (most cloud providers allow this)
4. **TLS/STARTTLS** is enabled by default

### Testing Before Deployment

```bash
# Test locally
node test-email-service.js

# Test after deployment
curl -X POST https://your-api.com/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "test123",
    "phone": "+1234567890",
    "role": "customer"
  }'
```

## 🔧 Alternative SMTP Providers

### If Brevo doesn't work on your host:

#### 1. SendGrid (Recommended for production)
```env
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASSWORD=<your-sendgrid-api-key>
```

#### 2. Gmail (Not recommended for production)
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=<app-password>  # Not regular password!
```

#### 3. Amazon SES
```env
EMAIL_HOST=email-smtp.us-east-1.amazonaws.com
EMAIL_PORT=587
EMAIL_USER=<your-smtp-username>
EMAIL_PASSWORD=<your-smtp-password>
```

#### 4. Mailgun
```env
EMAIL_HOST=smtp.mailgun.org
EMAIL_PORT=587
EMAIL_USER=postmaster@your-domain.com
EMAIL_PASSWORD=<your-mailgun-password>
```

## 🐛 Troubleshooting

### Issue: "Connection timeout"
**Solution**: Your hosting provider might block port 587
- Try port 465 with `secure: true`
- Or use Resend API (HTTP-based, no ports blocked)

### Issue: "Authentication failed"
**Solution**: 
- Check for trailing spaces in EMAIL_PASSWORD
- Verify credentials in your email provider dashboard
- For Gmail, use App Password, not regular password

### Issue: "Email not received"
**Solution**:
- Check spam folder
- Verify EMAIL_FROM_ADDRESS is verified in Brevo
- Check Brevo dashboard for sending limits

### Issue: Works locally but not in production
**Solution**:
- Ensure all env variables are set in production
- Check if your host blocks SMTP ports
- Enable Resend API as fallback (it uses HTTP, always works)

## 📊 Monitoring

Check logs for:
```
✅ Email sent via SMTP to user@example.com
✅ Email sent via Resend to user@example.com
❌ SMTP failed: <error message>
```

## 🔐 Security Best Practices

1. **Never commit .env file** (already in .gitignore)
2. **Use environment variables** in production
3. **Rotate API keys** regularly
4. **Monitor sending limits** (Brevo free tier: 300 emails/day)
5. **Verify sender domain** for better deliverability

## 📈 Scaling

Current setup handles:
- **Brevo Free**: 300 emails/day
- **Resend Free**: 100 emails/day (fallback)
- **Total**: 400 emails/day free tier

For higher volume:
- Upgrade Brevo plan
- Or switch to SendGrid/Amazon SES
- Or use Resend paid plan

## ✨ Features

- ✅ Beautiful HTML email templates
- ✅ Plain text fallback
- ✅ Automatic retry with fallback
- ✅ Development mode logging
- ✅ Production-ready error handling
- ✅ Works on all cloud platforms
- ✅ No port blocking issues (HTTP fallback)

## 🎯 Next Steps

1. Test signup flow: `/api/auth/signup`
2. Test password reset: `/api/auth/forgot-password`
3. Test email verification: `/api/auth/verify-email`
4. Monitor logs in production
5. Set up email analytics in Brevo dashboard

---

**Need help?** Check the logs or contact support.
