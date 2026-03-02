import express from 'express';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.service.js';

const router = express.Router();

/**
 * @route   POST /api/test/send-email
 * @desc    Test email sending (for debugging in production)
 * @access  Public (remove in production or add auth)
 */
router.post('/send-email', async (req, res) => {
  try {
    const { email, type = 'verification' } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const testCode = '123456';
    const testName = 'Test User';

    let result;
    if (type === 'password_reset') {
      result = await sendPasswordResetEmail(email, testCode, testName);
    } else {
      result = await sendVerificationEmail(email, testCode, testName);
    }

    res.status(200).json({
      success: result.success,
      message: result.success 
        ? `Test ${type} email sent successfully!`
        : 'Email sending failed',
      data: {
        method: result.method || (result.devMode ? 'DEV_MODE' : 'UNKNOWN'),
        messageId: result.messageId,
        testCode,
        error: result.error,
      },
    });
  } catch (error) {
    console.error('❌ Test email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/test/email-config
 * @desc    Check email configuration status
 * @access  Public
 */
router.get('/email-config', (req, res) => {
  const smtpConfigured = !!(
    process.env.EMAIL_HOST &&
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASSWORD
  );

  const resendConfigured = !!process.env.RESEND_API_KEY;

  res.status(200).json({
    success: true,
    data: {
      smtp: {
        configured: smtpConfigured,
        host: process.env.EMAIL_HOST || 'Not set',
        port: process.env.EMAIL_PORT || 'Not set',
        user: process.env.EMAIL_USER || 'Not set',
        hasPassword: !!process.env.EMAIL_PASSWORD,
        fromName: process.env.EMAIL_FROM_NAME || 'Not set',
        fromAddress: process.env.EMAIL_FROM_ADDRESS || 'Not set',
      },
      resend: {
        configured: resendConfigured,
        hasApiKey: !!process.env.RESEND_API_KEY,
      },
      status: smtpConfigured || resendConfigured ? 'READY' : 'NOT_CONFIGURED',
      recommendation: !smtpConfigured && !resendConfigured
        ? 'Configure at least one email service (SMTP or Resend)'
        : smtpConfigured && resendConfigured
        ? 'Both services configured - optimal setup!'
        : smtpConfigured
        ? 'SMTP configured - Resend recommended as fallback'
        : 'Resend configured - works but SMTP recommended as primary',
    },
  });
});

export default router;
