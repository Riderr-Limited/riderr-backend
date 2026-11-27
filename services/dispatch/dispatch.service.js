// services/dispatch/dispatch.service.js
// Priority dispatch for delivery requests.
//
// Instead of pinging every nearby rider at once (first tap wins), riders are
// ranked and offered the job in waves:
//   wave 1: the best DISPATCH_WAVE_SIZES[0] riders (default 3)
//   wave 2: the next DISPATCH_WAVE_SIZES[1] riders (default 5)
//   final : every remaining rider nearby, and the job is open to all
// A new wave starts after DISPATCH_WAVE_SECONDS (default 30s) with no accept,
// or straight away if everyone in the current wave declines.
//
// Rank = distance (closer is better) + rating (weighted by how many reviews)
//        + reliability (completed vs. cancelled/failed jobs).
// Ratings and reliability are calculated from real Delivery records, not the
// Driver.rating / Driver.stats counters (those were never kept up to date).
import mongoose from "mongoose";
import Delivery from "../../models/delivery.models.js";
import Driver from "../../models/riders.models.js";
import { sendNotification, NotificationTemplates } from "../../utils/notification.js";

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
    historyDays: num(process.env.DISPATCH_HISTORY_DAYS, 180)
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
const eligibleDriverQuery = () => ({
  isOnline: true,
  isActive: true,
  isAvailable: true,
  isSuspended: { $ne: true },
  approvalStatus: { $ne: "rejected" },
  $and: [
    { $or: [{ currentDeliveryId: { $exists: false } }, { currentDeliveryId: null }] },
    { $or: [{ onboardingType: { $ne: "individual" } }, { "kyc.status": "approved" }] },
    {
      $or: [
        { "location.coordinates": { $exists: true, $ne: [0, 0] } },
        { "currentLocation.lat": { $exists: true } }
      ]
    }
  ]
});

/**
 * Per-rider history from Delivery records: average customer rating, number
 * of ratings, and how often they finish what they accept.
 */
export const getDriverHistory = async (driverIds) => {
  const { historyDays } = dispatchConfig();
  if (!driverIds.length) return new Map();
  const since = new Date(Date.now() - historyDays * 24 * 3600 * 1000);
  const rows = await Delivery.aggregate([
    { $match: { driverId: { $in: driverIds.map((id) => new mongoose.Types.ObjectId(String(id))) }, createdAt: { $gte: since } } },
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
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
};

/** Score one rider from 0 to 1. Exported so it can be unit-tested. */
export const scoreDriver = ({ distanceKm: d, ratingSum = 0, ratingCount = 0, completed = 0, failed = 0, driverCancelled = 0 }, cfg = dispatchConfig()) => {
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
export const rankDriversForPickup = async (pickup, { excludeDriverIds = [] } = {}) => {
  const cfg = dispatchConfig();
  const exclude = new Set(excludeDriverIds.map(String));
  const drivers = await Driver.find(eligibleDriverQuery())
    .select("userId location currentLocation lat lng onboardingType kyc.status")
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

const notifyDrivers = async (delivery, ranked, io) => {
  for (const r of ranked) {
    try {
      await sendNotification({
        userId: r.driver.userId._id,
        ...NotificationTemplates.NEW_DELIVERY_REQUEST(delivery._id, r.distanceKm, delivery.fare?.totalFare || 0)
      });
    } catch (e) {
      console.error("Dispatch notify failed:", e.message);
    }
    if (io) {
      io.to(`user_${r.driver.userId._id}`).emit("delivery:new_request", {
        deliveryId: delivery._id,
        referenceId: delivery.referenceId,
        pickup: delivery.pickup,
        dropoff: delivery.dropoff,
        fare: delivery.fare,
        payment: delivery.payment,
        itemDetails: delivery.itemDetails,
        distanceKm: Math.round(r.distanceKm * 10) / 10
      });
    }
  }
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

const isPayable = (delivery) => {
  const method = delivery.payment?.method;
  return !method || method === "cash" || delivery.payment?.status === "paid";
};

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Mongo filter so a rider only sees requests that have been offered to them.
 * Older deliveries (no dispatch.enabled) stay visible to everyone.
 */
export const visibleToDriverFilter = (driverId) => ({
  $or: [{ "dispatch.enabled": { $ne: true } }, { "dispatch.openToAll": true }, { "dispatch.notifiedDriverIds": driverId }]
});

/** Same rule for a delivery document already in memory. */
export const isOfferedTo = (delivery, driverId) => {
  const d = delivery.dispatch;
  if (!d?.enabled || d.openToAll) return true;
  return (d.notifiedDriverIds || []).some((id) => String(id) === String(driverId));
};

/**
 * Called when a delivery is created. Returns how many riders are nearby, and
 * how many were notified. Non-cash deliveries wait for payment; the dispatch
 * job starts them once they're paid.
 */
export const startDispatch = async (delivery, io) => {
  const cfg = dispatchConfig();
  const ranked = await rankDriversForPickup(delivery.pickup, {
    excludeDriverIds: (delivery.rejectedByDrivers || []).map((r) => r.driverId)
  });

  // Old behaviour: notify everyone nearby at once.
  if (!cfg.enabled) {
    if (isPayable(delivery)) await notifyDrivers(delivery, ranked, io);
    return { candidateCount: ranked.length, notifiedCount: isPayable(delivery) ? ranked.length : 0, deferred: false };
  }

  if (!isPayable(delivery)) {
    await Delivery.updateOne({ _id: delivery._id }, { $set: { "dispatch.enabled": true } });
    return { candidateCount: ranked.length, notifiedCount: 0, deferred: true };
  }

  const firstWave = cfg.waveSizes.length ? ranked.slice(0, cfg.waveSizes[0]) : ranked;
  const openToAll = cfg.waveSizes.length === 0;
  const now = new Date();
  // Claim it so the background job can't start the same delivery twice.
  const claimed = await Delivery.findOneAndUpdate(
    { _id: delivery._id, "dispatch.startedAt": null },
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

  await notifyDrivers(claimed, firstWave, io);
  return { candidateCount: ranked.length, notifiedCount: firstWave.length, deferred: false };
};

/** Offer an unaccepted delivery to the next wave. Safe to run on many servers at once. */
export const runNextWave = async (deliveryId, io) => {
  const cfg = dispatchConfig();
  const now = new Date();
  const delivery = await Delivery.findOneAndUpdate(
    {
      _id: deliveryId,
      status: "created",
      driverId: null,
      "dispatch.enabled": true,
      "dispatch.openToAll": false,
      "dispatch.startedAt": { $ne: null },
      "dispatch.nextWaveAt": { $lte: now }
    },
    { $set: { "dispatch.nextWaveAt": new Date(now.getTime() + cfg.waveSeconds * 1000) } },
    { new: true }
  );
  if (!delivery) return null;

  const already = [
    ...(delivery.dispatch.notifiedDriverIds || []),
    ...(delivery.rejectedByDrivers || []).map((r) => r.driverId)
  ];
  const ranked = await rankDriversForPickup(delivery.pickup, { excludeDriverIds: already });

  const waveIndex = delivery.dispatch.wave; // 0-based index of the wave about to go out
  const isFinal = waveIndex >= cfg.waveSizes.length;
  const wave = isFinal ? ranked : ranked.slice(0, cfg.waveSizes[waveIndex]);

  const updated = await Delivery.findOneAndUpdate(
    { _id: delivery._id, status: "created", driverId: null },
    {
      $set: {
        "dispatch.wave": waveIndex + 1,
        "dispatch.openToAll": isFinal,
        "dispatch.nextWaveAt": isFinal ? null : delivery.dispatch.nextWaveAt,
        "dispatch.lastRanking": rankingSnapshot(ranked, waveIndex + 1)
      },
      $addToSet: { "dispatch.notifiedDriverIds": { $each: wave.map((r) => r.driver._id) } }
    },
    { new: true }
  );
  if (!updated) return null; // accepted or cancelled in the meantime

  await notifyDrivers(updated, wave, io);
  return { wave: waveIndex + 1, notified: wave.length, openToAll: isFinal };
};

/** If every rider offered the job so far has declined it, move on now. */
export const onDriverRejected = async (deliveryId) => {
  try {
    const d = await Delivery.findById(deliveryId).select("status dispatch rejectedByDrivers").lean();
    if (!d?.dispatch?.enabled || d.dispatch.openToAll || d.status !== "created") return;
    const rejected = new Set((d.rejectedByDrivers || []).map((r) => String(r.driverId)));
    const offered = (d.dispatch.notifiedDriverIds || []).map(String);
    if (offered.length && offered.every((id) => rejected.has(id))) {
      await Delivery.updateOne({ _id: deliveryId, "dispatch.openToAll": false }, { $set: { "dispatch.nextWaveAt": new Date() } });
    }
  } catch (e) {
    console.error("Dispatch onDriverRejected failed:", e.message);
  }
};

/** Background tick: start paid deliveries and push due waves. */
export const processDispatchQueue = async (io) => {
  const cfg = dispatchConfig();
  if (!cfg.enabled) return { started: 0, waves: 0 };

  // 1. Card/transfer deliveries that have just been paid.
  const waiting = await Delivery.find({
    status: "created",
    driverId: null,
    "dispatch.enabled": true,
    "dispatch.startedAt": null,
    "payment.status": "paid"
  }).limit(50);
  let started = 0;
  for (const d of waiting) {
    const r = await startDispatch(d, io);
    if (r.notifiedCount || r.candidateCount === 0) started++;
  }

  // 2. Waves that are due.
  const due = await Delivery.find({
    status: "created",
    driverId: null,
    "dispatch.enabled": true,
    "dispatch.openToAll": false,
    "dispatch.startedAt": { $ne: null },
    "dispatch.nextWaveAt": { $lte: new Date() }
  })
    .select("_id")
    .limit(100)
    .lean();
  let waves = 0;
  for (const d of due) {
    if (await runNextWave(d._id, io)) waves++;
  }
  return { started, waves };
};
