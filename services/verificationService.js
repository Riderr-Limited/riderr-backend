import nodemailer from 'nodemailer';
import twilio from 'twilio';

class VerificationService {
  constructor() {
    // Initialize Twilio client
    this.twilioClient = null;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        this.twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        console.log('✅ Twilio client initialized');
      } catch (error) {
        console.error('❌ Twilio initialization failed:', error.message);
      }
    }

    // Initialize email transporter
    this.emailTransporter = null;
    this.initializeEmailTransporter();
  }

  async initializeEmailTransporter() {
    try {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.log('📧 Email credentials not configured');
        return;
      }

      this.emailTransporter = nodemailer.createTransporter({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
        tls: { rejectUnauthorized: false },
      });

      // Test the connection
      await this.emailTransporter.verify();
      console.log('✅ Email transporter initialized and verified');
    } catch (error) {
      console.error('❌ Email transporter initialization failed:', error.message);
      this.emailTransporter = null;
    }
  }

  generateVerificationCode(length = 6) {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendVerificationEmail(email, code, name) {
    try {
      if (!this.emailTransporter) {
        console.log(`📧 DEV MODE: Email verification code for ${email}: ${code}`);
        return { success: false, devMode: true, error: 'Email service not configured' };
      }

      const mailOptions = {
        from: `"Riderr" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your Riderr Verification Code',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #337bff, #5a95ff); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white; }
              .content { padding: 30px; background: #f8f9fa; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; }
              .code { background: #337bff; color: white; padding: 20px; border-radius: 10px; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; text-align: center; }
              .footer { margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Riderr</h1>
                <p style="margin: 10px 0 0 0;">Email Verification</p>
              </div>
              <div class="content">
                <h2>Hello ${name},</h2>
                <p>Your email verification code is:</p>
                <div class="code">${code}</div>
                <p>This code expires in 10 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
              </div>
              <div class="footer">
                <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log(`✅ Email sent to ${email} - MessageId: ${result.messageId}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error(`❌ Email error for ${email}:`, error.message);
      console.log(`📧 FALLBACK: Email verification code for ${email}: ${code}`);
      return { success: false, error: error.message, devMode: true };
    }
  }

  async sendPasswordResetEmail(email, otp, name) {
    try {
      if (!this.emailTransporter) {
        console.log(`📧 DEV MODE: Password reset OTP for ${email}: ${otp}`);
        return { success: false, devMode: true, error: 'Email service not configured' };
      }

      const mailOptions = {
        from: `"Riderr" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset OTP - Riderr',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #337bff, #5a95ff); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white; }
              .content { padding: 30px; background: #f8f9fa; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; }
              .code { background: #337bff; color: white; padding: 20px; border-radius: 10px; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; text-align: center; }
              .footer { margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
              .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Riderr</h1>
                <p style="margin: 10px 0 0 0;">Password Reset</p>
              </div>
              <div class="content">
                <h2>Hello ${name},</h2>
                <p>Your password reset OTP is:</p>
                <div class="code">${otp}</div>
                <div class="warning">
                  <strong>⚠️ Security Alert:</strong> This OTP expires in 10 minutes. If you didn't request this, please ignore this email and contact support immediately.
                </div>
                <p>For security reasons, do not share this OTP with anyone.</p>
              </div>
              <div class="footer">
                <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      };

      const result = await this.emailTransporter.sendMail(mailOptions);
      console.log(`✅ Password reset OTP sent to ${email} - MessageId: ${result.messageId}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error(`❌ Password reset email error for ${email}:`, error.message);
      console.log(`📧 FALLBACK: Password reset OTP for ${email}: ${otp}`);
      return { success: false, error: error.message, devMode: true };
    }
  }

  async sendSMSVerification(phone, code) {
    try {
      if (!this.twilioClient) {
        console.log(`📱 DEV MODE: SMS verification code for ${phone}: ${code}`);
        return { success: false, devMode: true, error: 'SMS service not configured' };
      }

      // Format phone number for international use
      let formattedPhone = phone;
      if (!phone.startsWith('+')) {
        // Default to Nigerian format if no country code
        formattedPhone = `+234${phone.replace(/^0/, '')}`;
      }

      const message = await this.twilioClient.messages.create({
        body: `Your Riderr verification code is: ${code}. This code expires in 10 minutes. Do not share this code with anyone.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
      });

      console.log(`✅ SMS sent to ${formattedPhone} - SID: ${message.sid}`);
      return { success: true, sid: message.sid };
    } catch (error) {
      console.error(`❌ SMS error for ${phone}:`, error.message);
      console.log(`📱 FALLBACK: SMS verification code for ${phone}: ${code}`);
      return { success: false, error: error.message, devMode: true };
    }
  }

  async sendPasswordResetSMS(phone, otp) {
    try {
      if (!this.twilioClient) {
        console.log(`📱 DEV MODE: Password reset OTP for ${phone}: ${otp}`);
        return { success: false, devMode: true, error: 'SMS service not configured' };
      }

      // Format phone number for international use
      let formattedPhone = phone;
      if (!phone.startsWith('+')) {
        // Default to Nigerian format if no country code
        formattedPhone = `+234${phone.replace(/^0/, '')}`;
      }

      const message = await this.twilioClient.messages.create({
        body: `Your Riderr password reset OTP is: ${otp}. This code expires in 10 minutes. If you didn't request this, please ignore this message.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
      });

      console.log(`✅ Password reset SMS sent to ${formattedPhone} - SID: ${message.sid}`);
      return { success: true, sid: message.sid };
    } catch (error) {
      console.error(`❌ Password reset SMS error for ${phone}:`, error.message);
      console.log(`📱 FALLBACK: Password reset OTP for ${phone}: ${otp}`);
      return { success: false, error: error.message, devMode: true };
    }
  }

  async sendDualVerification(email, phone, code, name) {
    const results = {
      email: { success: false },
      sms: { success: false },
      overallSuccess: false
    };

    // Send email verification
    if (email) {
      results.email = await this.sendVerificationEmail(email, code, name);
    }

    // Send SMS verification
    if (phone) {
      results.sms = await this.sendSMSVerification(phone, code);
    }

    // Consider successful if at least one method works
    results.overallSuccess = results.email.success || results.sms.success;

    return results;
  }

  async sendDualPasswordReset(email, phone, otp, name) {
    const results = {
      email: { success: false },
      sms: { success: false },
      overallSuccess: false
    };

    // Send email OTP
    if (email) {
      results.email = await this.sendPasswordResetEmail(email, otp, name);
    }

    // Send SMS OTP
    if (phone) {
      results.sms = await this.sendPasswordResetSMS(phone, otp);
    }

    // Consider successful if at least one method works
    results.overallSuccess = results.email.success || results.sms.success;

    return results;
  }

  getServiceStatus() {
    return {
      email: {
        configured: !!this.emailTransporter,
        host: process.env.EMAIL_HOST || 'Not configured',
        user: process.env.EMAIL_USER || 'Not configured'
      },
      sms: {
        configured: !!this.twilioClient,
        accountSid: process.env.TWILIO_ACCOUNT_SID ? 'Configured' : 'Not configured',
        phoneNumber: process.env.TWILIO_PHONE_NUMBER || 'Not configured'
      }
    };
  }
}

// Export singleton instance
export default new VerificationService();