import crypto from "crypto";
import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import { calculateFare } from "../utils/fareCalculator.js";

const haversineKm = (lat1, lon1, lat2, lon2) => {
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

const generateReferenceId = () =>
  `PTN-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

// Finds/creates a lightweight guest User to satisfy Delivery.customerId,
// without ever exposing a real Riderr login to the partner's end-customer.
const getOrCreateGuestCustomer = async (partner, { name, phone, email }) => {
  const existing = await User.findOne({ phone });
  if (existing) return existing;

  const guestEmail =
    email || `guest.${phone.replace(/\D/g, "")}@partners.riderr.ng`;

  const guest = new User({
    role: "customer",
    name,
    email: guestEmail,
    phone,
    password: crypto.randomBytes(16).toString("hex"),
    isVerified: true,
    isGuest: true,
    guestSourcePartnerId: partner._id,
  });

  await guest.save();
  return guest;
};

const findNearestAvailableDriver = async (companyId, vehicleType, pickup) => {
  const availableDrivers = await Driver.find({
    companyId,
    isOnline: true,
    isAvailable: true,
    isActive: true,
    isVerified: true,
    approvalStatus: "approved",
    isSuspended: false,
    currentTripId: null,
    currentStatus: "online",
    vehicleType,
    "location.coordinates": { $exists: true },
  }).populate("userId", "name phone");

  if (availableDrivers.length === 0) return null;

  const withDistance = availableDrivers.map((driver) => {
    const [driverLng, driverLat] = driver.location.coordinates;
    return {
      driver,
      distance: haversineKm(driverLat, driverLng, pickup.lat, pickup.lng),
    };
  });

  withDistance.sort((a, b) => a.distance - b.distance);
  return withDistance[0].driver;
};

/**
 * POST /api/partner/v1/deliveries
 * Partner creates a delivery request for one of its own customers.
 */
export const createPartnerDelivery = async (req, res) => {
  try {
    const {
      companyId,
      customerName,
      customerPhone,
      customerEmail,
      recipientName,
      recipientPhone,
      pickup,
      dropoff,
      itemDetails,
      vehicleType = "bike",
      paymentMethod = "cash",
      partnerOrderRef,
    } = req.body;

    if (!companyId || !customerName || !customerPhone || !recipientName || !recipientPhone) {
      return res.status(400).json({
        success: false,
        message:
          "companyId, customerName, customerPhone, recipientName, and recipientPhone are required",
      });
    }

    if (!pickup?.address || pickup.lat == null || pickup.lng == null) {
      return res.status(400).json({
        success: false,
        message: "pickup.address, pickup.lat, and pickup.lng are required",
      });
    }

    if (!dropoff?.address || dropoff.lat == null || dropoff.lng == null) {
      return res.status(400).json({
        success: false,
        message: "dropoff.address, dropoff.lat, and dropoff.lng are required",
      });
    }

    const partner = req.partner;

    if (
      partner.allowedCompanyIds.length > 0 &&
      !partner.allowedCompanyIds.some((id) => id.toString() === companyId)
    ) {
      return res.status(403).json({
        success: false,
        message: "This partner account is not permitted to use this company",
      });
    }

    const company = await Company.findById(companyId);
    if (!company || !company.canOperate()) {
      return res.status(404).json({
        success: false,
        message: "Company not found or not currently active",
      });
    }

    const customer = await getOrCreateGuestCustomer(partner, {
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
    });

    const distanceKm = haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
    const estimatedDurationMin = Math.round(distanceKm * 3);

    const fare = calculateFare({
      distance: distanceKm,
      itemWeight: itemDetails?.weight || 1,
      itemType: itemDetails?.type || "parcel",
      vehicleType,
      isFragile: !!itemDetails?.isFragile,
      itemValue: itemDetails?.value || 0,
    });

    const delivery = new Delivery({
      referenceId: generateReferenceId(),
      source: "partner_api",
      partnerId: partner._id,
      partnerOrderRef: partnerOrderRef || null,
      customerId: customer._id,
      companyId: company._id,
      companyDetails: {
        companyId: company._id,
        name: company.name,
        logo: company.logoUrl,
        contactPhone: company.contactPhone,
        address: company.address,
      },
      customerName,
      customerPhone,
      recipientName,
      recipientPhone,
      pickup,
      dropoff,
      itemDetails: itemDetails || { type: "parcel", description: "Package", weight: 1, value: 0 },
      fare: {
        baseFare: fare.baseFare,
        distanceFare: fare.distanceFare,
        totalFare: fare.totalFare,
        currency: fare.currency,
      },
      estimatedDistanceKm: Math.round(distanceKm * 10) / 10,
      estimatedDurationMin,
      payment: { method: paymentMethod, status: "pending" },
      status: "created",
    });

    await delivery.save();

    try {
      const nearestDriver = await findNearestAvailableDriver(company._id, vehicleType, pickup);
      if (nearestDriver) {
        delivery.driverId = nearestDriver._id;
        delivery.driverDetails = {
          driverId: nearestDriver._id,
          userId: nearestDriver.userId._id,
          name: nearestDriver.userId.name,
          phone: nearestDriver.userId.phone,
          vehicle: {
            type: nearestDriver.vehicleType,
            make: nearestDriver.vehicleMake,
            model: nearestDriver.vehicleModel,
            plateNumber: nearestDriver.plateNumber,
          },
        };
        delivery.status = "assigned";
        delivery.assignedAt = new Date();
        await delivery.save();
        await nearestDriver.assignTrip(delivery._id);
      }
    } catch (assignError) {
      console.error("Partner delivery driver assignment error:", assignError);
      // Delivery still stands; it just remains unassigned for now.
    }

    res.status(201).json({
      success: true,
      message:
        delivery.status === "assigned"
          ? "Delivery created and driver assigned"
          : "Delivery created. Looking for an available rider...",
      data: {
        deliveryId: delivery._id,
        referenceId: delivery.referenceId,
        partnerOrderRef: delivery.partnerOrderRef,
        status: delivery.status,
        fare: delivery.fare,
        estimatedDistanceKm: delivery.estimatedDistanceKm,
        estimatedDurationMin: delivery.estimatedDurationMin,
        driver: delivery.driverDetails?.name
          ? {
              name: delivery.driverDetails.name,
              phone: delivery.driverDetails.phone,
              vehicle: delivery.driverDetails.vehicle,
            }
          : null,
        createdAt: delivery.createdAt,
      },
    });
  } catch (error) {
    console.error("Create partner delivery error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const scopedDeliveryOrNotFound = async (req, res) => {
  const delivery = await Delivery.findOne({
    _id: req.params.deliveryId,
    partnerId: req.partner._id,
  });
  if (!delivery) {
    res.status(404).json({ success: false, message: "Delivery not found" });
    return null;
  }
  return delivery;
};

const publicDeliveryView = (delivery) => ({
  deliveryId: delivery._id,
  referenceId: delivery.referenceId,
  partnerOrderRef: delivery.partnerOrderRef,
  status: delivery.status,
  fare: delivery.fare,
  pickup: delivery.pickup,
  dropoff: delivery.dropoff,
  driver: delivery.driverDetails?.name
    ? {
        name: delivery.driverDetails.name,
        phone: delivery.driverDetails.phone,
        vehicle: delivery.driverDetails.vehicle,
        currentLocation: delivery.driverDetails.currentLocation,
      }
    : null,
  assignedAt: delivery.assignedAt,
  pickedUpAt: delivery.pickedUpAt,
  deliveredAt: delivery.deliveredAt,
  completedAt: delivery.completedAt,
  cancelledAt: delivery.cancelledAt,
  createdAt: delivery.createdAt,
  updatedAt: delivery.updatedAt,
});

/**
 * GET /api/partner/v1/deliveries/:deliveryId
 * Poll a single delivery's status. Scoped to the authenticated partner only.
 */
export const getPartnerDelivery = async (req, res) => {
  try {
    const delivery = await scopedDeliveryOrNotFound(req, res);
    if (!delivery) return;

    res.status(200).json({ success: true, data: publicDeliveryView(delivery) });
  } catch (error) {
    console.error("Get partner delivery error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/partner/v1/deliveries
 * List this partner's deliveries, newest first.
 */
export const listPartnerDeliveries = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = { partnerId: req.partner._id };
    if (status && status !== "all") query.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [deliveries, total] = await Promise.all([
      Delivery.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Delivery.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: deliveries.map(publicDeliveryView),
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("List partner deliveries error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/partner/v1/deliveries/:deliveryId/cancel
 */
export const cancelPartnerDelivery = async (req, res) => {
  try {
    const delivery = await scopedDeliveryOrNotFound(req, res);
    if (!delivery) return;

    if (!["created", "assigned"].includes(delivery.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a delivery in status "${delivery.status}"`,
      });
    }

    delivery.status = "cancelled";
    delivery.cancelledAt = new Date();
    delivery.cancelledBy = { role: "partner_api", reason: req.body?.reason || "Cancelled by partner" };
    await delivery.save();

    res.status(200).json({ success: true, message: "Delivery cancelled", data: publicDeliveryView(delivery) });
  } catch (error) {
    console.error("Cancel partner delivery error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/partner/v1/companies
 * Active delivery companies a partner can dispatch through.
 */
export const listPartnerCompanies = async (req, res) => {
  try {
    const partner = req.partner;
    const query = { status: "active", isActive: true, isDeleted: false };
    if (partner.allowedCompanyIds.length > 0) {
      query._id = { $in: partner.allowedCompanyIds };
    }

    const companies = await Company.find(query).select("name city state lga logoUrl");
    res.status(200).json({ success: true, data: companies });
  } catch (error) {
    console.error("List partner companies error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
