import nodemailer from 'nodemailer';

// Simple email sender without complex templates
export const sendVerificationEmail = async (email, name, token) => {
  try {
    // Create test account if no email config
    let transporter;
    
    if (process.env.NODE_ENV === 'production' && process.env.EMAIL_HOST) {
      // Production email config
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD
        }
      });
    } else {
      // Development - use ethereal.email (fake SMTP)
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
    }
    
    const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${token}`;
    
    const mailOptions = {
      from: `"Riderr" <${process.env.EMAIL_FROM || 'noreply@riderr.com'}>`,
      to: email,
      subject: 'Verify Your Email Address',
      html: `
        <h2>Welcome to Riderr, ${name}!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${verificationLink}">Verify Email Address</a></p>
        <p>Or copy this link: ${verificationLink}</p>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't create an account, please ignore this email.</p>
      `
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('📧 Email sent:', info.messageId);
      console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    
    return true;
  } catch (error) {
    console.error('Email sending error:', error);
    return false;
  }
};