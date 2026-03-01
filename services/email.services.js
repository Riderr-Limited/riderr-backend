// ============================================================================
// PRODUCTION-READY NODEMAILER CONFIGURATION FOR OTP
// ============================================================================
// This configuration works with ANY SMTP provider (Gmail, SendGrid, Mailgun, 
// Amazon SES, Brevo/Sendinblue, SMTP2GO, etc.)
//
// Add these to your .env file:
// EMAIL_HOST=smtp.yourdomain.com (or smtp.gmail.com, smtp.sendgrid.net, etc.)
// EMAIL_PORT=587 (or 465 for SSL)
// EMAIL_USER=your-email@domain.com
// EMAIL_PASSWORD=your-app-password
// EMAIL_FROM_NAME=Riderr
// EMAIL_FROM_ADDRESS=noreply@riderr.com
// ============================================================================

import nodemailer from "nodemailer";

/**
 * Create email transporter - Works in PRODUCTION
 * No Google OAuth required - just username/password
 */
const createEmailTransporter = () => {
  try {
    // Validate required environment variables
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.error('❌ Missing email configuration. Required: EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD');
      return null;
    }

    const config = {
      host: process.env.EMAIL_HOST, // e.g., smtp.gmail.com, smtp.sendgrid.net
      port: parseInt(process.env.EMAIL_PORT) || 587, // 587 for TLS, 465 for SSL
      secure: parseInt(process.env.EMAIL_PORT) === 465, // true for port 465, false for others
      auth: {
        user: process.env.EMAIL_USER, // your email or SMTP username
        pass: process.env.EMAIL_PASSWORD, // your password or API key
      },
      // Connection settings for reliability
      connectionTimeout: 10000, // 10 seconds
      greetingTimeout: 10000,
      socketTimeout: 10000,
      // Disable certificate validation for development (optional)
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
      // Enable debugging in development
      debug: process.env.NODE_ENV === 'development',
      logger: process.env.NODE_ENV === 'development',
    };

    console.log('📧 Email Configuration:', {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.auth.user,
      hasPassword: !!config.auth.pass,
    });

    return nodemailer.createTransport(config);
  } catch (error) {
    console.error('❌ Email transporter creation error:', error);
    return null;
  }
};

/**
 * Send OTP Email - Production Ready
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @param {string} name - Recipient name
 * @param {string} purpose - 'verification' or 'password_reset'
 */
export const sendOTPEmail = async (email, otp, name, purpose = 'verification') => {
  try {
    const transporter = createEmailTransporter();

    if (!transporter) {
      console.error('❌ Email transporter not available');
      
      // In development, log the OTP
      if (process.env.NODE_ENV === 'development') {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📧 DEV MODE - OTP for ${email}: ${otp}`);
        console.log(`${'='.repeat(60)}\n`);
        return { success: true, devMode: true };
      }
      
      return { success: false, error: 'Email service not configured' };
    }

    // Email content based on purpose
    const isVerification = purpose === 'verification';
    const subject = isVerification 
      ? '🔐 Your Riderr Verification Code'
      : '🔑 Reset Your Riderr Password';
    
    const heading = isVerification 
      ? 'Email Verification'
      : 'Password Reset';
    
    const message = isVerification
      ? 'Welcome to Riderr! Please verify your email address with the code below:'
      : 'You requested to reset your password. Use the code below:';
    
    const expiryText = 'This code expires in 10 minutes';
    const securityNote = isVerification
      ? "If you didn't create a Riderr account, please ignore this email."
      : "If you didn't request this, please ignore this email and your password will remain unchanged.";

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || 'Riderr',
        address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER,
      },
      to: email,
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              margin: 0;
              padding: 0;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333333;
              background-color: #f5f5f5;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              padding: 40px 20px;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              color: #ffffff;
              font-size: 32px;
              font-weight: 700;
            }
            .header p {
              margin: 10px 0 0 0;
              color: #ffffff;
              font-size: 16px;
              opacity: 0.9;
            }
            .content {
              padding: 40px 30px;
            }
            .greeting {
              font-size: 18px;
              font-weight: 600;
              color: #333333;
              margin-bottom: 20px;
            }
            .message {
              font-size: 16px;
              color: #555555;
              margin-bottom: 30px;
            }
            .otp-container {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              border-radius: 12px;
              padding: 30px;
              text-align: center;
              margin: 30px 0;
              box-shadow: 0 4px 6px rgba(102, 126, 234, 0.2);
            }
            .otp-code {
              font-size: 42px;
              font-weight: 700;
              letter-spacing: 8px;
              color: #ffffff;
              margin: 0;
              text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            .expiry {
              font-size: 14px;
              color: #666666;
              margin: 20px 0;
              padding: 15px;
              background-color: #f8f9fa;
              border-radius: 8px;
              border-left: 4px solid #667eea;
            }
            .security-note {
              font-size: 14px;
              color: #888888;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eeeeee;
            }
            .footer {
              background-color: #f8f9fa;
              padding: 30px;
              text-align: center;
              border-top: 1px solid #eeeeee;
            }
            .footer p {
              margin: 5px 0;
              font-size: 13px;
              color: #999999;
            }
            .footer a {
              color: #667eea;
              text-decoration: none;
            }
            @media only screen and (max-width: 600px) {
              .content {
                padding: 30px 20px;
              }
              .otp-code {
                font-size: 36px;
                letter-spacing: 5px;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚗 Riderr</h1>
              <p>${heading}</p>
            </div>
            
            <div class="content">
              <div class="greeting">Hello ${name},</div>
              
              <div class="message">${message}</div>
              
              <div class="otp-container">
                <p class="otp-code">${otp}</p>
              </div>
              
              <div class="expiry">
                ⏰ ${expiryText}
              </div>
              
              <div class="security-note">
                🔒 <strong>Security Note:</strong><br>
                ${securityNote}
                ${!isVerification ? '<br><br>For your security, never share this code with anyone.' : ''}
              </div>
            </div>
            
            <div class="footer">
              <p><strong>Riderr - Fast & Reliable Delivery</strong></p>
              <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
              <p>Need help? Contact us at <a href="mailto:support@riderr.com">support@riderr.com</a></p>
            </div>
          </div>
        </body>
        </html>
      `,
      // Plain text fallback
      text: `
Hello ${name},

${message}

Your verification code is: ${otp}

${expiryText}

${securityNote}

---
Riderr - Fast & Reliable Delivery
© ${new Date().getFullYear()} Riderr. All rights reserved.
Need help? Contact: support@riderr.com
      `.trim(),
    };

    console.log(`📧 Sending ${purpose} email to ${email}...`);
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email sent successfully to ${email}`);
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}`);

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
    });

    // In development, still log the OTP even if email fails
    if (process.env.NODE_ENV === 'development') {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📧 EMAIL FAILED - But here's your OTP for testing:`);
      console.log(`   Email: ${email}`);
      console.log(`   OTP: ${otp}`);
      console.log(`${'='.repeat(60)}\n`);
    }

    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }
};

/**
 * Send Email Verification Code
 */
export const sendVerificationEmail = async (email, code, name) => {
  return sendOTPEmail(email, code, name, 'verification');
};

/**
 * Send Password Reset OTP
 */
export const sendPasswordResetEmail = async (email, otp, name) => {
  return sendOTPEmail(email, otp, name, 'password_reset');
};

/**
 * Verify email configuration (for testing)
 */
export const verifyEmailConfig = async () => {
  try {
    const transporter = createEmailTransporter();
    
    if (!transporter) {
      return {
        success: false,
        error: 'Email configuration missing',
      };
    }

    await transporter.verify();
    
    console.log('✅ Email configuration is valid and ready');
    return {
      success: true,
      message: 'Email service is ready',
    };
  } catch (error) {
    console.error('❌ Email configuration verification failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

export default {
  sendOTPEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  verifyEmailConfig,
};