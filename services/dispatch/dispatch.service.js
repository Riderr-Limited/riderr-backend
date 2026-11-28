// services/dispatch/dispatch.service.js
// Priority dispatch for delivery AND ride requests.
//
// Instead of pinging every nearby rider at once (first tap wins), riders are
// ranked and offered the job in waves:
//   wave 1: the best DISPATCH_WAVE_SIZES[0] riders (default 3)
//   wave 2: the next DISPATCH_WAVE_SIZES[1] riders (default 5)
//   final : every remaining rider nearby, and the job is open to all
// A new wave starts after DISPATCH_WAVE_SECONDS (default 30s) with no accept,
// or straight away if everyone in the current wave declines.
//
// Rank = rating weighted by review count (50%) + distance (30%)
//        + reliability: completed vs. cancelled/failed jobs (20%).
// Ratings and reliability are calculated from real Delivery and Ride records,
// not the Driver.rating / Driver.stats counters (those were never kept up to date).
import mongoose from "mongoose";
import Delivery from "../../models/delivery.models.js";
import Ride from "../../models/ride.model.js";
import Driver from "../../models/riders.models.js";
import { sendNotification, NotificationTemplates } from "../../utils/notification.js";
import { refundRide } from "../payments/ridePayment.service.js";
import { pendingRefundMessage } from "../payments/refund.service.js";
import { underCommissionLimitFilter, payableRiderFilter } from "../payments/commission.service.js";

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

export const dispatchConfig = () => {
  const weights = {
    distance: num(process.env.DISPATCH_WEIGHT_DISTANCE, 0.3),
    rating: num(process.env.DISPATCH_WEIGHT_RATING, 0.5),
    reliability: num(process.env.DISPATCH_WEIGHT_RELIABILITY, 0.2)
  };
  const total = weights.distance + weights.rating + weights.reliability || 1;
  return {
    enabled: process.env.DISPATCH_PRIORITY_ENABLED !== "false",
    radiusKm: num(process.env.DISPATCH_RADIUS_KM, 10),
    waveSizes: String(process.env.DISPATCH_WAVE_SIZES || "3,5")
      .split(",")
      .map((n) => parseInt(n, 10))
      .filter((n) => n > 0),
    waveSeconds: num(process.env.DISPATCH_WAVE_SECONDS, 30),
    weights: {
      distance: weights.distance / total,
      rating: weights.rating / total,
      reliability: weights.reliability / total
    },
    // A new rider is treated as if they already had 10 ratings averaging 4.0.
    // They climb as real reviews come in, so one lucky 5-star doesn't beat
    // 200 ratings at 4.8, and a proven rider beats a newcomer who is a bit closer.
    ratingPrior: num(process.env.DISPATCH_RATING_PRIOR, 4.0),
    ratingPriorWeight: num(process.env.DISPATCH_RATING_PRIOR_WEIGHT, 10),
    reliabilityPrior: 0.9,
    reliabilityPriorWeight: 5,
    historyDays: num(process.env.DISPATCH_HISTORY_DAYS, 180),
    // Rides nobody accepts are cancelled after this long so the customer isn't left waiting.
    rideSearchTimeoutMinutes: num(process.env.RIDE_SEARCH_TIMEOUT_MINUTES, 5)
  };
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const distanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/** Same fallbacks the existing code uses: GeoJSON, then currentLocation, then lat/lng. */
export const driverCoords = (driver) => {
  const c = driver.location?.coordinates;
  if (Array.isArray(c) && c.length >= 2 && !(c[0] === 0 && c[1] === 0)) return { lat: c[1], lng: c[0] };
  if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
    return { lat: driver.currentLocation.lat, lng: driver.currentLocation.lng };
  }
  if (driver.lat && driver.lng) return { lat: driver.lat, lng: driver.lng };
  return null;
};

/** Riders who can take a job right now. Individual riders must be KYC-approved. */
const eligibleDriverQuery = (vehicleType) => ({
  isOnline: true,
  isActive: true,
  isAvailable: true,
  isSuspended: { $ne: true },
  approvalStatus: { $ne: "rejected" },
  ...(vehicleType ? { vehicleType } : {}),
  ...underCommissionLimitFilter(),
  $and: [
    { $or: [{ currentDeliveryId: { $exists: false } }, { currentDeliveryId: null }] },
    { $or: [{ currentTripId: { $exists: false } }, { currentTripId: null }] },
    { $or: [{ onboardingType: { $ne: "individual" } }, { "kyc.status": "approved" }] },
    payableRiderFilter(),
    {
      $or: [
        { "location.coordinates": { $exists: true, $ne: [0, 0] } },
        { "currentLocation.lat": { $exists: true } }
      ]
    }
  ]
});

/**
 * Per-rider history from Delivery and Ride records: customer ratings, and how
 * often they finish what they accept.
 */
export const getDriverHistory = async (driverIds) => {
  const { historyDays } = dispatchConfig();
  if (!driverIds.length) return new Map();
  const since = new Date(Date.now() - historyDays * 24 * 3600 * 1000);
  const ids = driverIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  const [deliveries, rides] = await Promise.all([
    Delivery.aggregate([
      { $match: { driverId: { $in: ids }, createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$driverId",
          ratingSum: { $sum: { $cond: [{ $gte: ["$rating", 1] }, "$rating", 0] } },
          ratingCount: { $sum: { $cond: [{ $gte: ["$rating", 1] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $in: ["$status", ["delivered", "completed"]] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          driverCancelled: {
            $sum: { $cond: [{ $and: [{ $eq: ["$status", "cancelled"] }, { $eq: ["$cancelledBy.role", "driver"] }] }, 1, 0] }
          }
        }
      }
    ]),
    Ride.aggregate([
      { $match: { driverId: { $in: ids }, createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$driverId",
          ratingSum: { $sum: { $cond: [{ $gte: ["$rating.byCustomer.score", 1] }, "$rating.byCustomer.score", 0] } },
          ratingCount: { $sum: { $cond: [{ $gte: ["$rating.byCustomer.score", 1] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          failed: { $sum: 0 },
          driverCancelled: {
            $sum: {
              $cond: [{ $and: [{ $eq: ["$status", "cancelled"] }, { $eq: ["$cancellation.cancelledBy", "driver"] }] }, 1, 0]
            }
          }
        }
      }
    ]),
  ]);

  // Rides a rider accepted and then cancelled (the ride itself went to someone else).
  const rideCancels = await Ride.aggregate([
    { $match: { "driverCancellations.driverId": { $in: ids }, createdAt: { $gte: since } } },
    { $unwind: "$driverCancellations" },
    { $match: { "driverCancellations.driverId": { $in: ids } } },
    { $group: { _id: "$driverCancellations.driverId", driverCancelled: { $sum: 1 } } }
  ]);

  const merged = new Map();
  for (const row of [...deliveries, ...rides, ...rideCancels]) {
    const key = String(row._id);
    const cur = merged.get(key) || { ratingSum: 0, ratingCount: 0, completed: 0, failed: 0, driverCancelled: 0 };
    for (const f of Object.keys(cur)) cur[f] += row[f] || 0;
    merged.set(key, cur);
  }
  return merged;
};

/** Score one rider from 0 to 1. Exported so it can be unit-tested. */
export const scoreDriver = (
  { distanceKm: d, ratingSum = 0, ratingCount = 0, completed = 0, failed = 0, driverCancelled = 0 },
  cfg = dispatchConfig()
) => {
  const distanceScore = Math.max(0, 1 - d / cfg.radiusKm);

  // Bayesian average: few ratings pull toward the prior, many ratings speak for themselves.
  const rating = (cfg.ratingPrior * cfg.ratingPriorWeight + ratingSum) / (cfg.ratingPriorWeight + ratingCount);
  const ratingScore = (rating - 1) / 4;

  const finished = completed + failed + driverCancelled;
  const reliability =
    (cfg.reliabilityPrior * cfg.reliabilityPriorWeight + completed) / (cfg.reliabilityPriorWeight + finished);

  const score =
    cfg.weights.distance * distanceScore + cfg.weights.rating * ratingScore + cfg.weights.reliability * reliability;

  return {
    score: Math.round(score * 1000) / 1000,
    rating: Math.round(rating * 100) / 100,
    ratingCount,
    reliability: Math.round(reliability * 100) / 100
  };
};

/** Eligible riders near the pickup, best first. */
export const rankDriversForPickup = async (pickup, { excludeDriverIds = [], vehicleType } = {}) => {
  const cfg = dispatchConfig();
  const exclude = new Set(excludeDriverIds.map(String));
  const drivers = await Driver.find(eligibleDriverQuery(vehicleType))
    .select("userId location currentLocation lat lng onboardingType kyc.status vehicleType")
    .populate("userId", "_id name")
    .lean();

  const nearby = [];
  for (const driver of drivers) {
    if (!driver.userId || exclude.has(String(driver._id))) continue;
    const at = driverCoords(driver);
    if (!at) continue;
    const d = distanceKm(pickup.lat, pickup.lng, at.lat, at.lng);
    if (d <= cfg.radiusKm) nearby.push({ driver, distanceKm: d });
  }

  const history = await getDriverHistory(nearby.map((n) => n.driver._id));
  return nearby
    .map((n) => {
      const h = history.get(String(n.driver._id)) || {};
      return { ...n, ...scoreDriver({ distanceKm: n.distanceKm, ...h }, cfg) };
    })
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
};

const rankingSnapshot = (ranked, wave) =>
  ranked.slice(0, 20).map((r) => ({
    driverId: r.driver._id,
    score: r.score,
    distanceKm: Math.round(r.distanceKm * 100) / 100,
    rating: r.rating,
    ratingCount: r.ratingCount,
    reliability: r.reliability,
    wave
  }));

// ---------------------------------------------------------------------------
// job kinds: what differs between deliveries and rides
// ---------------------------------------------------------------------------

const safeNotify = async (payload) => {
  try {
    await sendNotification(payload);
  } catch (e) {
    console.error("Dispatch notify failed:", e.message);
  }
};

const KINDS = {
  delivery: {
    Model: Delivery,
    open: { status: "created", driverId: null },
    pickupOf: (d) => ({ lat: d.pickup?.lat, lng: d.pickup?.lng }),
    vehicleTypeOf: () => undefined,
    isPayable: (d) => {
      const method = d.payment?.method;
      return !method || method === "cash" || d.payment?.status === "paid";
    },
    notify: async (d, r, io) => {
      await safeNotify({
        userId: r.driver.userId._id,
        ...NotificationTemplates.NEW_DELIVERY_REQUEST(d._id, r.distanceKm, d.fare?.totalFare || 0)
      });
      io?.to(`user_${r.driver.userId._id}`).emit("delivery:new_request", {
        deliveryId: d._id,
        referenceId: d.referenceId,
        pickup: d.pickup,
        dropoff: d.dropoff,
        fare: d.fare,
        payment: d.payment,
        itemDetails: d.itemDetails,
        distanceKm: Math.round(r.distanceKm * 10) / 10
      });
    }
  },
  ride: {
    Model: Ride,
    open: { status: "searching", driverId: null },
    pickupOf: (r) => {
      const c = r.pickup?.location?.coordinates || [];
      return { lat: c[1], lng: c[0] };
    },
    vehicleTypeOf: (r) => r.vehicleType,
    // Card/transfer rides go out once paid; cash rides (if enabled) straight away.
    isPayable: (r) => r.payment?.method === "cash" || r.payment?.status === "paid",
    notify: async (ride, r, io) => {
      await safeNotify({
        userId: r.driver.userId._id,
        ...NotificationTemplates.NEW_RIDE_REQUEST(ride._id, ride.pickup?.address),
        data: { rideId: ride._id, distanceKm: Math.round(r.distanceKm * 10) / 10, fare: ride.estimatedFare }
      });
      io?.to(`user_${r.driver.userId._id}`).emit("ride:new_request", {
        rideId: ride._id,
        referenceId: ride.referenceId,
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        vehicleType: ride.vehicleType,
        estimatedFare: ride.estimatedFare,
        estimatedDistance: ride.estimatedDistance,
        payment: ride.payment,
        distanceKm: Math.round(r.distanceKm * 10) / 10
      });
    }
  }
};

const rankFor = (kind, doc, excludeDriverIds) =>
  rankDriversForPickup(kind.pickupOf(doc), { excludeDriverIds, vehicleType: kind.vehicleTypeOf(doc) });

const rejectedIds = (doc) => (doc.rejectedByDrivers || []).map((r) => r.driverId);

const start = async (kind, doc, io) => {
  const cfg = dispatchConfig();
  const ranked = await rankFor(kind, doc, rejectedIds(doc));

  // Old behaviour: notify everyone nearby at once.
  if (!cfg.enabled) {
    const payable = kind.isPayable(doc);
    if (payable) for (const r of ranked) await kind.notify(doc, r, io);
    return { candidateCount: ranked.length, notifiedCount: payable ? ranked.length : 0, deferred: false };
  }

  if (!kind.isPayable(doc)) {
    await kind.Model.updateOne({ _id: doc._id }, { $set: { "dispatch.enabled": true } });
    return { candidateCount: ranked.length, notifiedCount: 0, deferred: true };
  }

  const firstWave = cfg.waveSizes.length ? ranked.slice(0, cfg.waveSizes[0]) : ranked;
  const openToAll = cfg.waveSizes.length === 0;
  const now = new Date();
  // Claim it so the background job can't start the same job twice.
  const claimed = await kind.Model.findOneAndUpdate(
    { _id: doc._id, "dispatch.startedAt": null },
    {
      $set: {
        "dispatch.enabled": true,
        "dispatch.startedAt": now,
        "dispatch.wave": 1,
        "dispatch.openToAll": openToAll,
        "dispatch.nextWaveAt": openToAll ? null : new Date(now.getTime() + cfg.waveSeconds * 1000),
        "dispatch.lastRanking": rankingSnapshot(ranked, 1)
      },
      $addToSet: { "dispatch.notifiedDriverIds": { $each: firstWave.map((r) => r.driver._id) } }
    },
    { new: true }
  );
  if (!claimed) return { candidateCount: ranked.length, notifiedCount: 0, deferred: false };

  for (const r of firstWave) await kind.notify(claimed, r, io);
  return { candidateCount: ranked.length, notifiedCount: firstWave.length, deferred: false };
};

const nextWave = async (kind, id, io) => {
  const cfg = dispatchConfig();
  const now = new Date();
  const doc = await kind.Model.findOneAndUpdate(
    {
      _id: id,
      ...kind.open,
      "dispatch.enabled": true,
      "dispatch.openToAll": false,
      "dispatch.startedAt": { $ne: null },
      "dispatch.nextWaveAt": { $lte: now }
    },
    { $set: { "dispatch.nextWaveAt": new Date(now.getTime() + cfg.waveSeconds * 1000) } },
    { new: true }
  );
  if (!doc) return null;

  const ranked = await rankFor(kind, doc, [...(doc.dispatch.notifiedDriverIds || []), ...rejectedIds(doc)]);
  const waveIndex = doc.dispatch.wave; // 0-based index of the wave about to go out
  const isFinal = waveIndex >= cfg.waveSizes.length;
  const wave = isFinal ? ranked : ranked.slice(0, cfg.waveSizes[waveIndex]);

  const updated = await kind.Model.findOneAndUpdate(
    { _id: doc._id, ...kind.open },
    {
      $set: {
        "dispatch.wave": waveIndex + 1,
        "dispatch.openToAll": isFinal,
        "dispatch.nextWaveAt": isFinal ? null : doc.dispatch.nextWaveAt,
        "dispatch.lastRanking": rankingSnapshot(ranked, waveIndex + 1)
      },
      $addToSet: { "dispatch.notifiedDriverIds": { $each: wave.map((r) => r.driver._id) } }
    },
    { new: true }
  );
  if (!updated) return null; // accepted or cancelled in the meantime

  for (const r of wave) await kind.notify(updated, r, io);
  return { wave: waveIndex + 1, notified: wave.length, openToAll: isFinal };
};

const onRejected = async (kind, id) => {
  try {
    const d = await kind.Model.findById(id).select("status driverId dispatch rejectedByDrivers").lean();
    if (!d?.dispatch?.enabled || d.dispatch.openToAll || d.status !== kind.open.status || d.driverId) return;
    const rejected = new Set(rejectedIds(d).map(String));
    const offered = (d.dispatch.notifiedDriverIds || []).map(String);
    if (offered.length && offered.every((x) => rejected.has(x))) {
      await kind.Model.updateOne({ _id: id, "dispatch.openToAll": false }, { $set: { "dispatch.nextWaveAt": new Date() } });
    }
  } catch (e) {
    console.error("Dispatch onRejected failed:", e.message);
  }
};

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Mongo filter so a rider only sees requests that have been offered to them.
 * Older records (no dispatch.enabled) stay visible to everyone.
 */
export const visibleToDriverFilter = (driverId) => ({
  $or: [{ "dispatch.enabled": { $ne: true } }, { "dispatch.openToAll": true }, { "dispatch.notifiedDriverIds": driverId }]
});

/** Same rule for a document already in memory. */
export const isOfferedTo = (doc, driverId) => {
  const d = doc.dispatch;
  if (!d?.enabled || d.openToAll) return true;
  return (d.notifiedDriverIds || []).some((id) => String(id) === String(driverId));
};

// Deliveries
export const startDispatch = (delivery, io) => start(KINDS.delivery, delivery, io);
export const runNextWave = (deliveryId, io) => nextWave(KINDS.delivery, deliveryId, io);
export const onDriverRejected = (deliveryId) => onRejected(KINDS.delivery, deliveryId);

// Rides
export const startRideDispatch = (ride, io) => start(KINDS.ride, ride, io);
export const runNextRideWave = (rideId, io) => nextWave(KINDS.ride, rideId, io);
export const onRideRejected = (rideId) => onRejected(KINDS.ride, rideId);

/** Cancel rides nobody accepted in time, and tell the customer. */
const expireUnacceptedRides = async (io) => {
  const { rideSearchTimeoutMinutes } = dispatchConfig();
  const cutoff = new Date(Date.now() - rideSearchTimeoutMinutes * 60 * 1000);
  const stale = await Ride.find({
    status: "searching",
    driverId: null,
    "dispatch.enabled": true,
    "dispatch.startedAt": { $lte: cutoff }
  })
    .select("_id")
    .limit(100)
    .lean();
  let expired = 0;
  for (const { _id } of stale) {
    const ride = await Ride.findOneAndUpdate(
      { _id, status: "searching", driverId: null },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          "cancellation.cancelledBy": "system",
          "cancellation.reason": "No rider accepted the request"
        }
      },
      { new: true }
    );
    if (!ride) continue;
    expired++;
    let refundNote = "";
    if (ride.payment?.status === "paid") {
      const refund = await refundRide(ride._id, "No rider accepted the ride");
      refundNote = refund.refundPending ? ` ${pendingRefundMessage(refund.refundAmount)}` : "";
    }
    await safeNotify({
      userId: ride.customerId,
      ...NotificationTemplates.RIDE_CANCELLED(ride._id, "system", `No rider was available nearby. Please try again.${refundNote}`)
    });
    io?.to(`user_${ride.customerId}`).emit("ride:no_driver", { rideId: ride._id });
  }
  return expired;
};

/** Cancel card/transfer rides the customer didn't pay for in time. */
const expireUnpaidRides = async (io) => {
  const stale = await Ride.find({
    status: "searching",
    driverId: null,
    "payment.method": { $ne: "cash" },
    "payment.status": { $nin: ["paid", "refunded"] },
    paymentExpiresAt: { $ne: null, $lte: new Date() }
  })
    .select("_id")
    .limit(100)
    .lean();
  let expired = 0;
  for (const { _id } of stale) {
    const ride = await Ride.findOneAndUpdate(
      { _id, status: "searching", driverId: null, "payment.status": { $nin: ["paid", "refunded"] } },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          "cancellation.cancelledBy": "system",
          "cancellation.reason": "Payment not completed in time"
        }
      },
      { new: true }
    );
    if (!ride) continue;
    expired++;
    await safeNotify({
      userId: ride.customerId,
      ...NotificationTemplates.RIDE_CANCELLED(ride._id, "system", "Payment wasn't completed in time, so the ride was cancelled.")
    });
    io?.to(`user_${ride.customerId}`).emit("ride:cancelled", { rideId: ride._id, reason: "payment_timeout" });
  }
  return expired;
};

/** Put a ride back out to riders after the assigned rider cancels. */
export const redispatchRide = async (rideId, io) => {
  const ride = await Ride.findById(rideId);
  if (!ride) return null;
  return start(KINDS.ride, ride, io);
};

/** Background tick: start paid jobs, push due waves, expire stale rides. */
export const processDispatchQueue = async (io) => {
  const cfg = dispatchConfig();
  if (!cfg.enabled) return { started: 0, waves: 0, expiredRides: 0 };

  // 1. Card/transfer deliveries and rides that have just been paid.
  let started = 0;
  for (const [kind, paidFilter] of [
    [KINDS.delivery, { "payment.status": "paid" }],
    [KINDS.ride, { "payment.status": "paid" }]
  ]) {
    const waiting = await kind.Model.find({
      ...kind.open,
      ...paidFilter,
      "dispatch.enabled": true,
      "dispatch.startedAt": null
    }).limit(50);
    for (const d of waiting) {
      const r = await start(kind, d, io);
      if (r.notifiedCount || r.candidateCount === 0) started++;
    }
  }

  // 2. Waves that are due, for both kinds.
  let waves = 0;
  for (const kind of Object.values(KINDS)) {
    const due = await kind.Model.find({
      ...kind.open,
      "dispatch.enabled": true,
      "dispatch.openToAll": false,
      "dispatch.startedAt": { $ne: null },
      "dispatch.nextWaveAt": { $lte: new Date() }
    })
      .select("_id")
      .limit(100)
      .lean();
    for (const d of due) if (await nextWave(kind, d._id, io)) waves++;
  }

  // 3. Rides nobody took, and card/transfer rides never paid for.
  const expiredRides = (await expireUnacceptedRides(io)) + (await expireUnpaidRides(io));

  return { started, waves, expiredRides };
};
