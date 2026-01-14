// check-env.js
console.log('=== ENVIRONMENT VARIABLES CHECK ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PAYSTACK_SECRET_KEY exists:', !!process.env.PAYSTACK_SECRET_KEY);
console.log('PAYSTACK_SECRET_KEY length:', process.env.PAYSTACK_SECRET_KEY?.length || 0);
console.log('PAYSTACK_SECRET_KEY preview:', process.env.PAYSTACK_SECRET_KEY ? 
  `"${process.env.PAYSTACK_SECRET_KEY.substring(0, 20)}..."` : 'NOT SET');

 