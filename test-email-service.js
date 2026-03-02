import dotenv from 'dotenv';
import { sendVerificationEmail, sendPasswordResetEmail } from './services/email.service.js';

dotenv.config();

const testEmail = async () => {
  console.log('\n🧪 Testing Email Configuration...\n');
  
  console.log('Environment Variables:');
  console.log('- EMAIL_HOST:', process.env.EMAIL_HOST);
  console.log('- EMAIL_PORT:', process.env.EMAIL_PORT);
  console.log('- EMAIL_USER:', process.env.EMAIL_USER);
  console.log('- EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '✓ Set' : '✗ Missing');
  console.log('- RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✓ Set' : '✗ Missing');
  console.log('');

  // Test email address (change this to your email)
  const testEmailAddress = process.env.EMAIL_USER || 'test@example.com';
  const testName = 'Test User';
  const testCode = '123456';

  console.log(`📧 Sending test verification email to: ${testEmailAddress}\n`);

  try {
    const result = await sendVerificationEmail(testEmailAddress, testCode, testName);
    
    if (result.success) {
      console.log('\n✅ SUCCESS! Email sent successfully');
      console.log('Method:', result.method || (result.devMode ? 'DEV MODE' : 'Unknown'));
      console.log('Message ID:', result.messageId || 'N/A');
    } else {
      console.log('\n❌ FAILED! Email could not be sent');
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test completed. Check your inbox!');
  console.log('='.repeat(60) + '\n');
};

testEmail();
