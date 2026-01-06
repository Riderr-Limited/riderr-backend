// middlewares/verifyPaystackWebhook.js
import crypto from 'crypto';

const verifyPaystackWebhook = (req, res, next) => {
  const signature = req.headers['x-paystack-signature'];
  
  if (!signature) {
    return res.status(401).json({
      success: false,
      message: 'Missing Paystack signature'
    });
  }

  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== signature) {
    console.warn('Invalid webhook signature:', {
      received: signature,
      computed: hash
    });
    return res.status(401).json({
      success: false,
      message: 'Invalid webhook signature'
    });
  }

  // Log webhook for debugging
  console.log('Valid webhook received:', {
    event: req.body.event,
    reference: req.body.data?.reference,
    timestamp: new Date().toISOString()
  });

  next();
};

export default verifyPaystackWebhook;