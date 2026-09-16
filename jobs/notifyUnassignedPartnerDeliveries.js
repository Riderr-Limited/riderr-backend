import cron from "node-cron";
import Delivery from "../models/delivery.models.js";
import User from "../models/user.models.js";
import { sendNotification } from "../utils/notification.js";

const ALERT_AFTER_MINUTES = Number(process.env.PARTNER_UNASSIGNED_ALERT_MINUTES) || 5;

/**
 * Runs every minute. Any delivery created through the Partner API that has
 * sat unassigned (no driver found automatically) for longer than the
 * threshold gets flagged to admins so they can manually assign a driver
 * from the existing admin dashboard (GET /api/admin/deliveries + PUT
 * /api/admin/deliveries/:id/assign-driver) — same manual-dispatch path
 * already used for normal app deliveries.
 */
const startNotifyUnassignedPartnerDeliveriesJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - ALERT_AFTER_MINUTES * 60 * 1000);

      const staleDeliveries = await Delivery.find({
        source: "partner_api",
        status: "created",
        createdAt: { $lte: cutoff },
        partnerUnassignedAlertSentAt: null,
      }).populate("partnerId", "businessName");

      if (staleDeliveries.length === 0) return;

      const admins = await User.find({
        role: "admin",
        isActive: true,
        isDeleted: false,
      }).select("_id");

      if (admins.length === 0) return;

      for (const delivery of staleDeliveries) {
        const partnerName = delivery.partnerId?.businessName || "Unknown partner";

        await Promise.all(
          admins.map((admin) =>
            sendNotification({
              userId: admin._id,
              type: "delivery",
              subType: "alert",
              title: "Partner order needs a driver",
              message: `${partnerName}'s delivery ${delivery.referenceId} has had no driver for over ${ALERT_AFTER_MINUTES} minutes. Please assign one manually.`,
              data: {
                deliveryId: delivery._id,
                referenceId: delivery.referenceId,
                partnerId: delivery.partnerId?._id,
                partnerName,
              },
              actionUrl: `/admin/deliveries/${delivery._id}`,
              actionLabel: "Assign Driver",
              priority: "high",
            })
          )
        );

        delivery.partnerUnassignedAlertSentAt = new Date();
        await delivery.save();
      }

      console.log(
        `Notified admins about ${staleDeliveries.length} unassigned partner delivery(ies)`
      );
    } catch (error) {
      console.error("Notify unassigned partner deliveries job error:", error.message);
    }
  });

  console.log(
    `Partner unassigned-delivery alert job started (threshold: ${ALERT_AFTER_MINUTES}m)`
  );
};

export default startNotifyUnassignedPartnerDeliveriesJob;
