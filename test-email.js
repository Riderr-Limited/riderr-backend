import nodemailer from 'nodemailer';

async function sendTestEmail() {
  try {
    console.log('🚀 Testing Gmail configuration...');
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'auwaluizziddin2212@gmail.com',
        pass: 'vxbfyynayjbujcsw'  // NO SPACES
      }
    });

    console.log('✅ Transporter created');
    
    // Send test email
    const info = await transporter.sendMail({
      from: '"Riderr Test" <auwaluizziddin2212@gmail.com>',
      to: 'auwaluizziddin2212@gmail.com',  // Send to yourself
      subject: '✅ Test Email from Riderr',
      text: 'This is a test email from Riderr authentication system.',
      html: `
        <h1>Test Email Working! 🎉</h1>
        <p>This email confirms that your Gmail configuration is correct.</p>
        <p>Time: ${new Date().toLocaleString()}</p>
      `
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
    
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
    
    // Common error messages
    if (error.code === 'EAUTH') {
      console.error('Authentication failed. Check:');
      console.error('1. Email: auwaluizziddin2212@gmail.com');
      console.error('2. Password: vxbfyynayjbujcsw (no spaces)');
      console.error('3. Make sure 2FA is enabled and you used App Password');
    } else if (error.code === 'ECONNECTION') {
      console.error('Connection failed. Check internet/firewall.');
    } else {
      console.error('Full error:', error);
    }
  }
}

sendTestEmail();