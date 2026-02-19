import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

async function testEmail() {
  console.log('🧪 Testing email configuration...\n');
  
  console.log('📧 Email Config:');
  console.log('- Host:', process.env.EMAIL_HOST);
  console.log('- Port:', process.env.EMAIL_PORT);
  console.log('- User:', process.env.EMAIL_USER);
  console.log('- Password:', process.env.EMAIL_PASSWORD ? '✓ Set' : '✗ Not set');
  console.log('');

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: { 
        rejectUnauthorized: false 
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
    });

    console.log('✅ Transporter created');
    console.log('🔍 Verifying connection...\n');

    await transporter.verify();
    console.log('✅ SMTP connection verified successfully!\n');

    console.log('📨 Sending test email...');
    const info = await transporter.sendMail({
      from: `"Riderr Test" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: 'Test Email - Riderr Backend',
      html: `
        <h2>Email Configuration Test</h2>
        <p>If you're reading this, your email configuration is working correctly!</p>
        <p>Timestamp: ${new Date().toISOString()}</p>
      `,
    });

    console.log('✅ Test email sent successfully!');
    console.log('📬 Message ID:', info.messageId);
    console.log('\n🎉 Email configuration is working properly!');
    
  } catch (error) {
    console.error('❌ Email test failed:', error.message);
    console.error('\n🔧 Troubleshooting:');
    console.error('1. Verify your Gmail App Password is correct');
    console.error('2. Make sure 2-Step Verification is enabled on your Google account');
    console.error('3. Generate a new App Password at: https://myaccount.google.com/apppasswords');
    console.error('4. Check if "Less secure app access" is enabled (if not using App Password)');
    console.error('\nError details:', error);
  }
}

testEmail();
