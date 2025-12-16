// services/verification.services.js
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

class VerificationServices {
  constructor() {
    // Initialize Twilio client if credentials exist
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    }
  }

  static generateVerificationCode(length = 6) {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += digits[Math.floor(Math.random() * digits.length)];
    }
    return code;
  }

  async sendPhoneVerification(phoneNumber) {
    try {
      if (!this.twilioClient) {
        throw new Error('Twilio client not configured');
      }

      const verification = await this.twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verifications
        .create({ to: phoneNumber, channel: 'sms' });

      return {
        success: true,
        sid: verification.sid,
        status: verification.status
      };
    } catch (error) {
      console.error('Phone verification error:', error);
      throw new Error('Failed to send verification code');
    }
  }

  async verifyPhoneCode(phoneNumber, code) {
    try {
      if (!this.twilioClient) {
        throw new Error('Twilio client not configured');
      }

      const verificationCheck = await this.twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks
        .create({ to: phoneNumber, code: code });

      return {
        success: verificationCheck.status === 'approved',
        status: verificationCheck.status,
        valid: verificationCheck.valid
      };
    } catch (error) {
      console.error('Phone verification check error:', error);
      throw new Error('Verification failed');
    }
  }

  static generateEmailToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    return { token, hashedToken };
  }
}

export default new VerificationServices();