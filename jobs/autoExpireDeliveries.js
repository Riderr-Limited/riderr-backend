import cron from 'node-cron';
import Delivery from '../models/delivery.models.js';
import { sendNotification } from '../utils/notification.js';

// Runs every minute — cancels deliveries where payment window has expired
const startAutoExpireJob = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const expired = await Delivery.find({
        status: 'created',
        'payment.status': 'pending_payment',
        paymentExpiresAt: { $lte: new Date() },
      });

      if (expired.length === 0) return;

      console.log(`⏰ Auto-cancelling ${expired.length} unpaid delivery(ies)...`);

      for (const delivery of expired) {
        delivery.status = 'cancelled';
        delivery.cancelledAt = new Date();
        delivery.cancelledBy = {
          userId: delivery.customerId,
          role: 'system',
          reason: 'Payment not completed within 5 minutes',
        };
        await delivery.save();

        await sendNotification({
          userId: delivery.customerId,
          title: '❌ Delivery Cancelled',
          message: 'Your delivery was cancelled because payment was not completed within 5 minutes.',
          data: {
            type: 'delivery_auto_cancelled',
            deliveryId: delivery._id,
            referenceId: delivery.referenceId,
          },
        });

        console.log(`  ✅ Cancelled delivery ${delivery.referenceId}`);
      }
    } catch (error) {
      console.error('❌ Auto-expire job error:', error.message);
    }
  });

  console.log('⏰ Auto-expire delivery job started (runs every minute)');
};

export default startAutoExpireJob;
