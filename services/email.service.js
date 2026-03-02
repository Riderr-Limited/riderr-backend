import nodemailer from 'nodemailer';
import { Resend } from 'resend';

// Initialize Resend as fallback
let resend = null;
if (process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
}

// Create SMTP transporter (Brevo/SendGrid/Gmail)
const createTransporter = () => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // Use TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

// Generate 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Email HTML template
const getEmailHTML = (name, code, type = 'verification') => {
  const isVerification = type === 'verification';
  const title = isVerification ? 'Email Verification' : 'Password Reset';
  const message = isVerification 
    ? 'Welcome to Riderr! Please verify your email with the code below:'
    : 'You requested to reset your password. Use the code below:';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f5f5f5">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:40px;text-align:center;color:#fff">
      <h1 style="margin:0;font-size:32px">🚗 Riderr</h1>
      <p style="margin:10px 0 0 0">${title}</p>
    </div>
    <div style="padding:40px 30px">
      <div style="font-size:18px;font-weight:600;margin-bottom:20px">Hello ${name},</div>
      <p>${message}</p>
      <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px;padding:30px;text-align:center;margin:30px 0">
        <p style="font-size:42px;font-weight:700;letter-spacing:8px;color:#fff;margin:0">${code}</p>
      </div>
      <div style="font-size:14px;color:#666;padding:15px;background:#f8f9fa;border-radius:8px;border-left:4px solid #667eea">
        ⏰ This code expires in 10 minutes
      </div>
      <p style="color:#888;font-size:14px;margin-top:30px">
        ${isVerification ? "If you didn't create a Riderr account, please ignore this email." : "If you didn't request this, please ignore this email."}
      </p>
    </div>
    <div style="background:#f8f9fa;padding:20px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee">
      <p><strong>Riderr - Fast & Reliable Delivery</strong></p>
      <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
};

// Send email via SMTP (primary method)
const sendViaSMTP = async (to, subject, html, text) => {
  const transporter = createTransporter();
  if (!transporter) return null;

  try {
    const info = await transporter.sendMail({
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Riderr',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to,
      subject,
      html,
      text,
    });

    console.log(`✅ Email sent via SMTP to ${to}`);
    return { success: true, messageId: info.messageId, method: 'SMTP' };
  } catch (error) {
    console.error('❌ SMTP failed:', error.message);
    return null;
  }
};

// Send email via Resend (fallback)
const sendViaResend = async (to, subject, html, text) => {
  if (!resend) return null;

  try {
    const { data, error } = await resend.emails.send({
      from: 'Riderr <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
      text,
    });

    if (error) throw new Error(error.message);

    console.log(`✅ Email sent via Resend to ${to}`);
    return { success: true, messageId: data.id, method: 'Resend' };
  } catch (error) {
    console.error('❌ Resend failed:', error.message);
    return null;
  }
};

// Main email sending function with fallback
export const sendEmail = async (to, subject, html, text) => {
  // Try SMTP first
  let result = await sendViaSMTP(to, subject, html, text);
  
  // Fallback to Resend
  if (!result) {
    result = await sendViaResend(to, subject, html, text);
  }

  // Development fallback - log to console
  if (!result && process.env.NODE_ENV === 'development') {
    console.log('\n' + '='.repeat(60));
    console.log('📧 DEV MODE - Email not sent, but here\'s the content:');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Text: ${text}`);
    console.log('='.repeat(60) + '\n');
    return { success: true, devMode: true };
  }

  return result || { success: false, error: 'All email methods failed' };
};

// Send verification email
export const sendVerificationEmail = async (email, code, name) => {
  const subject = '🔐 Your Riderr Verification Code';
  const html = getEmailHTML(name, code, 'verification');
  const text = `Hello ${name},\n\nWelcome to Riderr! Your verification code is: ${code}\n\nThis code expires in 10 minutes.\n\n© ${new Date().getFullYear()} Riderr`;

  return sendEmail(email, subject, html, text);
};

// Send password reset email
export const sendPasswordResetEmail = async (email, code, name) => {
  const subject = '🔑 Reset Your Riderr Password';
  const html = getEmailHTML(name, code, 'password_reset');
  const text = `Hello ${name},\n\nYou requested to reset your password. Your OTP is: ${code}\n\nThis code expires in 10 minutes.\n\n© ${new Date().getFullYear()} Riderr`;

  return sendEmail(email, subject, html, text);
};

export default {
  generateOTP,
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
};
