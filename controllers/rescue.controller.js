import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { sendNotification } from "../utils/notification.js";

/**
 * UTILITY: Calculate distance between two coords (Haversine)
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER: Request Help (tire broke, accident, etc.)
// POST /api/deliveries/:deliveryId/request-help
// ─────────────────────────────────────────────────────────────────────────────
export const requestDriverHelp = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;
    const { reason, details, currentLat, currentLng } = req.body;

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can request help",
      });
    }

    if (!reason) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "A reason for the help request is required",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id })
      .populate("userId", "name phone")
      .populate("companyId", "name")
      .session(session);

    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id,
    }).session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found or not assigned to you",
      });
    }

    // Only allow help requests for active deliveries
    if (!["assigned", "picked_up"].includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot request help for delivery with status: ${delivery.status}`,
      });
    }

    // Prevent duplicate help requests
    if (delivery.rescueRequest?.status === "pending") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "A help request is already pending for this delivery",
      });
    }

    // Update driver's location if provided
    if (currentLat && currentLng) {
      driver.currentLocation = {
        ...driver.currentLocation,
        lat: parseFloat(currentLat),
        lng: parseFloat(currentLng),
        updatedAt: new Date(),
      };
      await driver.save({ session });
    }

    // Attach rescue request to delivery
    delivery.rescueRequest = {
      status: "pending",
      reason,
      details: details || "",
      requestedAt: new Date(),
      requestedByDriverId: driver._id,
      driverLocation: {
        lat: parseFloat(currentLat) || driver.currentLocation?.lat,
        lng: parseFloat(currentLng) || driver.currentLocation?.lng,
      },
    };

    // Mark delivery as needing rescue
    delivery.status = "rescue_requested";
    await delivery.save({ session });

    // ── Notify company ──────────────────────────────────────────────────────
    let companyNotified = false;
    if (driver.companyId) {
      // Find company admin user(s) to notify
      const companyAdmins = await User.find({
        companyId: driver.companyId._id,
        role: { $in: ["company", "company_admin"] },
      }).session(session);

      for (const admin of companyAdmins) {
        await sendNotification({
          userId: admin._id,
          title: "🚨 Driver Needs Help!",
          message: `${driver.userId.name} is stranded on delivery #${delivery.referenceId}. Reason: ${reason}`,
          data: {
            type: "rescue_requested",
            deliveryId: delivery._id,
            driverId: driver._id,
            driverName: driver.userId.name,
            driverPhone: driver.userId.phone,
            reason,
            details,
            driverLocation: delivery.rescueRequest.driverLocation,
            deliveryPickup: delivery.pickup,
            deliveryDropoff: delivery.dropoff,
            referenceId: delivery.referenceId,
          },
        });
      }
      companyNotified = companyAdmins.length > 0;
    }

    // ── Notify customer ─────────────────────────────────────────────────────
    await sendNotification({
      userId: delivery.customerId,
      title: "⚠️ Delivery Delayed",
      message:
        "Your driver has encountered an issue. We're working to get your package delivered as soon as possible.",
      data: {
        type: "delivery_delayed",
        deliveryId: delivery._id,
        reason: "Driver encountered an issue",
      },
    });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `🚨 Help requested for delivery ${deliveryId} by driver ${driver._id}. Reason: ${reason}`
    );

    res.status(200).json({
      success: true,
      message: "Help request sent successfully. Your company has been notified.",
      data: {
        deliveryId: delivery._id,
        rescueRequest: delivery.rescueRequest,
        companyNotified,
        nextSteps: [
          "Stay with the vehicle/package if safe to do so",
          "Wait for your company to contact you",
          "Keep your phone accessible",
        ],
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("❌ Request driver help error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send help request",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY: Get all pending rescue requests
// GET /api/company/rescue-requests
// ─────────────────────────────────────────────────────────────────────────────
export const getCompanyRescueRequests = async (req, res) => {
  try {
    const user = req.user;

    if (!["company_admin", "admin"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can view rescue requests",
      });
    }

    // Get all drivers belonging to this company
    const companyDrivers = await Driver.find({
      companyId: user.companyId,
    }).select("_id");

    if (!companyDrivers.length) {
      return res.status(200).json({ success: true, data: [], count: 0 });
    }

    const driverIds = companyDrivers.map((d) => d._id);

    const rescueDeliveries = await Delivery.find({
      driverId: { $in: driverIds },
      status: "rescue_requested",
      "rescueRequest.status": "pending",
    })
      .populate("customerId", "name phone")
      .populate("driverId")
      .sort({ "rescueRequest.requestedAt": -1 })
      .lean();

    // Enrich with driver user info
    const enriched = await Promise.all(
      rescueDeliveries.map(async (delivery) => {
        const driverDoc = await Driver.findById(delivery.driverId)
          .populate("userId", "name phone avatarUrl")
          .lean();

        return {
          ...delivery,
          driverInfo: driverDoc?.userId || null,
          driverVehicle: {
            type: driverDoc?.vehicleType,
            make: driverDoc?.vehicleMake,
            model: driverDoc?.vehicleModel,
            plateNumber: driverDoc?.plateNumber,
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length,
    });
  } catch (error) {
    console.error("❌ Get rescue requests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get rescue requests",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY: Reassign delivery to a new driver
// POST /api/company/deliveries/:deliveryId/reassign
// ─────────────────────────────────────────────────────────────────────────────
export const reassignDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { newDriverId, note } = req.body;

    if (!["company_admin", "admin"].includes(user.role)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only company administrators can reassign deliveries",
      });
    }

    if (!newDriverId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "newDriverId is required",
      });
    }

    // ── Fetch delivery ──────────────────────────────────────────────────────
    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Delivery not found" });
    }

    if (!["rescue_requested", "assigned", "picked_up"].includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot reassign delivery with status: ${delivery.status}`,
      });
    }

    // ── Fetch new driver (must belong to same company) ──────────────────────
    const newDriver = await Driver.findOne({
      _id: newDriverId,
      companyId: user.companyId,
      isOnline: true,
     })
      .populate("userId", "name phone avatarUrl rating")
      .session(session);

    if (!newDriver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message:
          "New driver not found or not available. Ensure they are online and available.",
      });
    }

    if (newDriver.currentDeliveryId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Selected driver already has an active delivery",
      });
    }

    // ── Free the old driver ─────────────────────────────────────────────────
    const oldDriverId = delivery.driverId;
    if (oldDriverId) {
      const oldDriver = await Driver.findById(oldDriverId).session(session);
      if (oldDriver) {
        oldDriver.currentDeliveryId = null;
        oldDriver.isAvailable = true;
        await oldDriver.save({ session });
      }
    }

    // ── Keep history of reassignment ────────────────────────────────────────
    if (!delivery.reassignmentHistory) delivery.reassignmentHistory = [];
    delivery.reassignmentHistory.push({
      previousDriverId: oldDriverId,
      newDriverId: newDriver._id,
      reassignedAt: new Date(),
      reassignedBy: user._id,
      reason: delivery.rescueRequest?.reason || "Manual reassignment",
      note: note || "",
    });

    // ── Build new driver details ────────────────────────────────────────────
    const newDriverDetails = {
      driverId: newDriver._id,
      userId: newDriver.userId._id,
      name: newDriver.userId.name || "Driver",
      phone: newDriver.userId.phone || "",
      avatarUrl: newDriver.userId.avatarUrl,
      rating: newDriver.userId.rating || 0,
      vehicle: {
        type: newDriver.vehicleType || "bike",
        make: newDriver.vehicleMake || "",
        model: newDriver.vehicleModel || "",
        plateNumber: newDriver.plateNumber || "",
      },
    };

    if (newDriver.currentLocation?.lat && newDriver.currentLocation?.lng) {
      newDriverDetails.currentLocation = {
        lat: newDriver.currentLocation.lat,
        lng: newDriver.currentLocation.lng,
        updatedAt: newDriver.currentLocation.updatedAt || new Date(),
      };
    }

    // ── Update delivery ─────────────────────────────────────────────────────
    delivery.driverId = newDriver._id;
    delivery.driverDetails = newDriverDetails;
    delivery.status = "assigned";            // reset to assigned
    delivery.assignedAt = new Date();
    delivery.estimatedPickupTime = new Date(Date.now() + 15 * 60 * 1000); // 15min ETA

    // Close the rescue request
    if (delivery.rescueRequest) {
      delivery.rescueRequest.status = "resolved";
      delivery.rescueRequest.resolvedAt = new Date();
      delivery.rescueRequest.resolvedBy = user._id;
      delivery.rescueRequest.resolution = "reassigned_to_new_driver";
    }

    await delivery.save({ session });

    // ── Update new driver ───────────────────────────────────────────────────
    newDriver.currentDeliveryId = delivery._id;
    newDriver.isAvailable = false;
    newDriver.totalRequests = (newDriver.totalRequests || 0) + 1;
    newDriver.acceptedRequests = (newDriver.acceptedRequests || 0) + 1;
    await newDriver.save({ session });

    await session.commitTransaction();
    session.endSession();

    // ── Notifications (outside transaction) ────────────────────────────────

    // Notify new driver
    await sendNotification({
      userId: newDriver.userId._id,
      title: "📦 New Delivery Assigned",
      message: `You've been assigned to take over delivery #${delivery.referenceId}. Please head to the ${delivery.status === "picked_up" ? "dropoff" : "pickup"} location.`,
      data: {
        type: "delivery_reassigned_to_you",
        deliveryId: delivery._id,
        referenceId: delivery.referenceId,
        pickup: delivery.pickup,
        dropoff: delivery.dropoff,
        fare: delivery.fare,
        isRescue: true,
      },
    });

    // Notify old driver their delivery was taken over
    if (oldDriverId) {
      const oldDriverDoc = await Driver.findById(oldDriverId).populate("userId", "_id");
      if (oldDriverDoc?.userId) {
        await sendNotification({
          userId: oldDriverDoc.userId._id,
          title: "✅ Help is on the way",
          message: `Delivery #${delivery.referenceId} has been reassigned to another driver. You're now free.`,
          data: {
            type: "delivery_taken_over",
            deliveryId: delivery._id,
          },
        });
      }
    }

    // Notify customer
    await sendNotification({
      userId: delivery.customerId,
      title: "🚗 New Driver Assigned",
      message: `${newDriver.userId.name} is now handling your delivery and is on the way!`,
      data: {
        type: "driver_reassigned",
        deliveryId: delivery._id,
        driverName: newDriver.userId.name,
        driverPhone: newDriver.userId.phone,
      },
    });

    console.log(
      `✅ Delivery ${deliveryId} reassigned from driver ${oldDriverId} to ${newDriver._id}`
    );

    res.status(200).json({
      success: true,
      message: `Delivery successfully reassigned to ${newDriver.userId.name}`,
      data: {
        delivery: {
          _id: delivery._id,
          referenceId: delivery.referenceId,
          status: delivery.status,
          assignedAt: delivery.assignedAt,
        },
        newDriver: newDriverDetails,
        rescueResolved: true,
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("❌ Reassign delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reassign delivery",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY: Get available drivers for reassignment
// GET /api/company/available-drivers?deliveryId=xxx
// ─────────────────────────────────────────────────────────────────────────────
export const getAvailableDriversForReassignment = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.query;

    if (!["company_admin", "admin"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Optionally get delivery to calculate proximity
    let pickupLat, pickupLng;
    if (deliveryId) {
      const delivery = await Delivery.findById(deliveryId).lean();
      if (delivery) {
        pickupLat = delivery.pickup?.lat;
        pickupLng = delivery.pickup?.lng;
      }
    }

    const drivers = await Driver.find({
      companyId: user.companyId,
      isOnline: true,
      isAvailable: true,
      currentDeliveryId: null,
    })
      .populate("userId", "name phone avatarUrl rating")
      .lean();

    const enriched = drivers.map((driver) => {
      let distance = null;
      let etaMinutes = null;

      const driverLat =
        driver.currentLocation?.lat ||
        (driver.location?.coordinates?.[1]);
      const driverLng =
        driver.currentLocation?.lng ||
        (driver.location?.coordinates?.[0]);

      if (pickupLat && pickupLng && driverLat && driverLng) {
        distance = parseFloat(
          calculateDistance(driverLat, driverLng, pickupLat, pickupLng).toFixed(2)
        );
        etaMinutes = Math.max(2, Math.ceil(distance * 3));
      }

      return {
        _id: driver._id,
        name: driver.userId?.name || "Driver",
        phone: driver.userId?.phone || "",
        avatarUrl: driver.userId?.avatarUrl,
        rating: driver.userId?.rating || 0,
        vehicle: {
          type: driver.vehicleType || "bike",
          make: driver.vehicleMake || "",
          model: driver.vehicleModel || "",
          plateNumber: driver.plateNumber || "",
        },
        currentLocation:
          driverLat && driverLng
            ? { lat: driverLat, lng: driverLng }
            : null,
        distanceFromPickup: distance,
        etaMinutes,
        distanceText: distance !== null ? `${distance.toFixed(1)} km away` : "Location unknown",
        etaText: etaMinutes ? `~${etaMinutes} min ETA` : "ETA unknown",
      };
    });

    // Sort closest first
    enriched.sort((a, b) => (a.distanceFromPickup ?? 999) - (b.distanceFromPickup ?? 999));

    res.status(200).json({
      success: true,
      data: enriched,
      count: enriched.length,
      message:
        enriched.length > 0
          ? `${enriched.length} available driver(s) found`
          : "No available drivers at the moment",
    });
  } catch (error) {
    console.error("❌ Get available drivers for reassignment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get available drivers",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY: Dismiss / close a rescue request without reassigning
// POST /api/company/deliveries/:deliveryId/dismiss-rescue
// ─────────────────────────────────────────────────────────────────────────────
export const dismissRescueRequest = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { note } = req.body;

    if (!["company_admin", "admin"].includes(user.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: "Delivery not found" });
    }

    if (delivery.rescueRequest?.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "No pending rescue request for this delivery",
      });
    }

    delivery.rescueRequest.status = "dismissed";
    delivery.rescueRequest.resolvedAt = new Date();
    delivery.rescueRequest.resolvedBy = user._id;
    delivery.rescueRequest.resolution = "dismissed";
    delivery.rescueRequest.note = note || "";

    // Restore the previous active status
    delivery.status = delivery.pickedUpAt ? "picked_up" : "assigned";
    await delivery.save();

    // Notify old driver that they should continue
    const driver = await Driver.findById(delivery.driverId).populate("userId", "_id name");
    if (driver?.userId) {
      await sendNotification({
        userId: driver.userId._id,
        title: "📋 Update from company",
        message: note
          ? `Your company says: "${note}". Please continue with the delivery.`
          : "Please continue with the delivery. Your company is aware of your situation.",
        data: { type: "rescue_dismissed", deliveryId: delivery._id },
      });
    }

    res.status(200).json({
      success: true,
      message: "Rescue request dismissed",
      data: { deliveryId, status: delivery.status },
    });
  } catch (error) {
    console.error("❌ Dismiss rescue request error:", error);
    res.status(500).json({ success: false, message: "Failed to dismiss rescue request" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER: Get status of own rescue request
// GET /api/deliveries/:deliveryId/rescue-status
// ─────────────────────────────────────────────────────────────────────────────
export const getRescueRequestStatus = async (req, res) => {
  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver profile not found" });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      driverId: driver._id,
    })
      .populate("customerId", "name phone")
      .lean();

    if (!delivery) {
      return res.status(404).json({ success: false, message: "Delivery not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        deliveryId: delivery._id,
        deliveryStatus: delivery.status,
        rescueRequest: delivery.rescueRequest || null,
        hasActiveRescue: delivery.rescueRequest?.status === "pending",
      },
    });
  } catch (error) {
    console.error("❌ Get rescue status error:", error);
    res.status(500).json({ success: false, message: "Failed to get rescue status" });
  }
};