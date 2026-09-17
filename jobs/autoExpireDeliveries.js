import cron from 'node-cron';
import Delivery from '../models/delivery.models.js';
import User from '../models/user.models.js';
import { sendNotification } from '../utils/notification.js';

const notifyAdmins = async (title, message, data = {}) => {
  try {
    const admins = await User.find({ role: "admin", isActive: true }).select("_id").lean();
    await Promise.all(admins.map((admin) =>
      sendNotification({ userId: admin._id, type: "delivery", subType: "alert", title, message, data, priority: "urgent" })
    ));
  } catch (err) {
    console.error("notifyAdmins error:", err.message);
  }
};

const startAutoExpireJob = () => {

  // ── Job 1: Auto-cancel unpaid deliveries ──────────────────────────────────
  cron.schedule('* * * * *', async () => {
    try {
      const expired = await Delivery.find({
        status: 'created',
        'payment.status': 'pending_payment',
        paymentExpiresAt: { $lte: new Date() },
      });

      if (expired.length === 0) return;

      console.log(` Auto-cancelling ${expired.length} unpaid delivery(ies)...`);

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
          title: 'Delivery Cancelled',
          message: 'Your delivery was cancelled because payment was not completed within 5 minutes.',
          data: {
            type: 'delivery_auto_cancelled',
            deliveryId: delivery._id,
            referenceId: delivery.referenceId,
          },
        });

        console.log(`   Cancelled delivery ${delivery.referenceId}`);
      }
    } catch (error) {
      console.error(' Auto-expire job error:', error.message);
    }
  });

  // ── Job 2: Re-alert admins every minute for unassigned deliveries ─────────
  cron.schedule('* * * * *', async () => {
    try {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

      // Deliveries that are still unassigned (no driverId) and were created at least 1 min ago
      const unassigned = await Delivery.find({
        status: 'created',
        driverId: { $exists: false },
        createdAt: { $lte: oneMinuteAgo },
        // Only alert once per minute — skip if already alerted in the last 55 seconds
        $or: [
          { lastAdminAlertAt: { $exists: false } },
          { lastAdminAlertAt: { $lte: new Date(Date.now() - 55 * 1000) } },
        ],
      }).lean();

      if (unassigned.length === 0) return;

      console.log(` ${unassigned.length} unassigned delivery(ies) — alerting admins...`);

      for (const delivery of unassigned) {
        await notifyAdmins(
          "Unassigned Delivery Alert",
          `Delivery #${delivery.referenceId} still has no driver assigned. Customer: ${delivery.customerName}. Pickup: ${delivery.pickup?.address || "N/A"}. Fare: ${delivery.fare?.totalFare?.toLocaleString() || "N/A"}`,
          { type: "unassigned_delivery", deliveryId: delivery._id, referenceId: delivery.referenceId, pickup: delivery.pickup, fare: delivery.fare }
        );

        // Stamp the alert time so we don't spam every second
        await Delivery.findByIdAndUpdate(delivery._id, { lastAdminAlertAt: new Date() });

        console.log(`   Alerted admins for unassigned delivery ${delivery.referenceId}`);
      }
    } catch (error) {
      console.error(' Unassigned delivery alert job error:', error.message);
    }
  });

  console.log(' Auto-expire + unassigned delivery alert jobs started (run every minute)');
};

export default startAutoExpireJob;
