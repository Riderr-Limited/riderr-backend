import Ride from "../models/ride.model.js";
import User from "../models/user.models.js";
import Driver from "../models/riders.models.js"; 
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { sendNotification, NotificationTemplates } from "../utils/notification.js";
import {
  startRideDispatch,
  onRideRejected,
  visibleToDriverFilter,
  isOfferedTo,
  distanceKm,
  driverCoords,
  dispatchConfig,
} from "../services/dispatch/dispatch.service.js";

/**
 * Calculate fare based on distance and vehicle type
 */
const calculateFare = (distanceMeters, vehicleType) => {
  const distanceKm = distanceMeters / 1000;
  
  const rates = {
    bike: { base: 200, perKm: 100 },      // 200 base + 100/km
    car: { base: 500, perKm: 150 },       // 500 base + 150/km
    van: { base: 800, perKm: 200 },       // 800 base + 200/km
    truck: { base: 1500, perKm: 300 }     // 1500 base + 300/km
  };
  
  const rate = rates[vehicleType] || rates.car;
  const fare = rate.base + (distanceKm * rate.perKm);
  
  return Math.ceil(fare);
};

/**
 * @desc    Create a ride request (Customer only)
 * @route   POST /api/rides
 * @access  Private (Customer)
 */
export const createRide = async (req, res) => {
  try {
    const customer = req.user;
    
    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can create rides"
      });
    }

    const {
      pickupAddress, pickupLat, pickupLng, pickupLandmark, pickupInstructions,
      dropoffAddress, dropoffLat, dropoffLng, dropoffLandmark, dropoffInstructions,
      vehicleType, customerName, customerPhone,
      estimatedDistance, estimatedDuration,
      specialRequests, notes
    } = req.body;

    // Validate required fields
    if (!pickupAddress || !pickupLat || !pickupLng ||
        !dropoffAddress || !dropoffLat || !dropoffLng ||
        !vehicleType || !customerName || !customerPhone) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Validate vehicle type
    if (!['bike', 'car', 'van', 'truck'].includes(vehicleType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle type"
      });
    }

    const coords = [pickupLat, pickupLng, dropoffLat, dropoffLng].map(parseFloat);
    if (coords.some((c) => !Number.isFinite(c))) {
      return res.status(400).json({ success: false, message: "Invalid pickup or dropoff coordinates" });
    }

    // Calculate estimated fare. Distance is worked out on the server from the
    // coordinates (straight line), so a client can't send a tiny distance to
    // get a cheap ride. The app's own estimate is used if it's longer (roads).
    const straightLineMeters = Math.round(distanceKm(coords[0], coords[1], coords[2], coords[3]) * 1000);
    const distance = Math.max(straightLineMeters, Number(estimatedDistance) || 0);
    const estimatedFare = calculateFare(distance, vehicleType);

    // Check if customer has active ride
    const activeRide = await Ride.findOne({
      customerId: customer._id,
      status: { $in: ['searching', 'assigned', 'accepted', 'arrived', 'started'] }
    });
    
    if (activeRide) {
      return res.status(400).json({
        success: false,
        message: "You already have an active ride"
      });
    }

    // Create ride
    const ride = new Ride({
      customerId: customer._id,
      customerName,
      customerPhone,
      pickup: {
        address: pickupAddress,
        location: {
          type: 'Point',
          coordinates: [parseFloat(pickupLng), parseFloat(pickupLat)]
        },
        landmark: pickupLandmark,
        instructions: pickupInstructions
      },
      dropoff: {
        address: dropoffAddress,
        location: {
          type: 'Point',
          coordinates: [parseFloat(dropoffLng), parseFloat(dropoffLat)]
        },
        landmark: dropoffLandmark,
        instructions: dropoffInstructions
      },
      vehicleType,
      estimatedDistance: distance,
      estimatedDuration: estimatedDuration || 600, // Default 10 minutes
      estimatedFare,
      baseFare: calculateFare(0, vehicleType),
      distanceFare: estimatedFare - calculateFare(0, vehicleType),
      specialRequests: specialRequests || [],
      notes,
      status: 'searching',
      metadata: {
        platform: req.headers['x-platform'] || 'web',
        appVersion: req.headers['x-app-version'],
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    await ride.save();

    // Offer the ride to the best-ranked nearby riders with the right vehicle,
    // in waves (see services/dispatch/dispatch.service.js).
    const dispatchResult = await startRideDispatch(ride, req.app.get("io"));

    const fresh = await Ride.findById(ride._id);
    res.status(201).json({
      success: true,
      message:
        dispatchResult.candidateCount === 0
          ? "Ride request created. No riders are available nearby right now; we'll keep looking."
          : "Ride request created successfully. Searching for nearby drivers...",
      data: fresh || ride,
      dispatch: { ridersNearby: dispatchResult.candidateCount, notified: dispatchResult.notifiedCount }
    });

  } catch (error) {
    console.error("Create ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get my rides (Customer)
 * @route   GET /api/rides/my-rides
 * @access  Private (Customer)
 */
export const getMyRides = async (req, res) => {
  try {
    const customer = req.user;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const query = { customerId: customer._id };
    if (status) query.status = status;

    const [rides, total] = await Promise.all([
      Ride.find(query)
        .populate('companyId', 'name contactPhone')
        .populate({
          path: 'driverId',
          populate: { 
            path: 'userId', 
            select: 'name phone avatarUrl' 
          }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Ride.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: rides,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error("Get my rides error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get active ride (Customer/Driver)
 * @route   GET /api/rides/active
 * @access  Private
 */
export const getActiveRide = async (req, res) => {
  try {
    const user = req.user;
    let ride;

    if (user.role === 'customer') {
      ride = await Ride.findOne({
        customerId: user._id,
        status: { $in: ['searching', 'assigned', 'accepted', 'arrived', 'started'] }
      });
    } else if (user.role === 'driver') {
      const driver = await Driver.findOne({ userId: user._id });
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver profile not found"
        });
      }
      ride = await Ride.findOne({
        driverId: driver._id,
        status: { $in: ['assigned', 'accepted', 'arrived', 'started'] }
      });
    } else {
      return res.status(403).json({
        success: false,
        message: "Invalid user role"
      });
    }

    if (ride) {
      await ride.populate([
        { path: 'customerId', select: 'name phone avatarUrl' },
        { path: 'companyId', select: 'name contactPhone' },
        { 
          path: 'driverId',
          populate: { path: 'userId', select: 'name phone avatarUrl' }
        }
      ]);
    }

    res.status(200).json({
      success: true,
      data: ride
    });

  } catch (error) {
    console.error("Get active ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Find nearby drivers and assign ride
 * @route   POST /api/rides/:rideId/assign
 * @access  Private (System/Admin)
 */
export const assignRideToDriver = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { rideId } = req.params;
    const { driverId, companyId } = req.body;

    const ride = await Ride.findById(rideId).session(session);
    
    if (!ride) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    if (ride.status !== 'searching' && ride.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Ride already assigned or cannot be assigned"
      });
    }

    // Verify driver exists and is available
    const driver = await Driver.findById(driverId)
      .populate('userId')
      .session(session);

    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver not found"
      });
    }

    if (!driver.isAvailable) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Driver is not available"
      });
    }

    // Verify driver's vehicle type matches
    if (driver.vehicleType !== ride.vehicleType) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Driver vehicle type does not match ride requirement"
      });
    }

    // Assign ride
    ride.driverId = driverId;
    ride.companyId = companyId || driver.companyId;
    ride.status = 'accepted';
    await ride.save({ session });
    
    // Update driver status
    driver.currentTripId = ride._id;
    driver.isAvailable = false;
    await driver.save({ session });

    await session.commitTransaction();

    // Populate ride data
    await ride.populate([
      { path: 'customerId', select: 'name phone' },
      { 
        path: 'driverId',
        populate: { path: 'userId', select: 'name phone' }
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Ride assigned to driver successfully",
      data: ride
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Assign ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Rider gets nearby ride requests that have been offered to them
 * @route   GET /api/rides/driver/nearby
 * @access  Private (Driver)
 */
export const getNearbyRideRequests = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver profile not found" });
    }
    if (!driver.isKycCleared()) {
      return res.status(403).json({ success: false, message: "Complete identity verification first", code: "KYC_REQUIRED" });
    }
    if (!driver.isOnline || !driver.isAvailable || driver.currentTripId || driver.currentDeliveryId) {
      return res.status(400).json({ success: false, message: "Go online and finish any current job to see ride requests" });
    }

    let here = driverCoords(driver);
    if (req.query.lat && req.query.lng) here = { lat: parseFloat(req.query.lat), lng: parseFloat(req.query.lng) };
    if (!here || !Number.isFinite(here.lat) || !Number.isFinite(here.lng)) {
      return res.status(400).json({ success: false, message: "We couldn't find your location. Please enable location services" });
    }

    const { radiusKm } = dispatchConfig();
    const rides = await Ride.find({
      status: "searching",
      driverId: null,
      vehicleType: driver.vehicleType,
      "rejectedByDrivers.driverId": { $ne: driver._id },
      ...visibleToDriverFilter(driver._id),
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const nearby = rides
      .map((ride) => {
        const [lng, lat] = ride.pickup?.location?.coordinates || [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const d = distanceKm(here.lat, here.lng, lat, lng);
        if (d > radiusKm) return null;
        return {
          _id: ride._id,
          referenceId: ride.referenceId,
          pickup: ride.pickup,
          dropoff: ride.dropoff,
          vehicleType: ride.vehicleType,
          estimatedFare: ride.estimatedFare,
          estimatedDistance: ride.estimatedDistance,
          estimatedDuration: ride.estimatedDuration,
          payment: { method: ride.payment?.method },
          distanceToPickupKm: Math.round(d * 10) / 10,
          requestedAt: ride.requestedAt,
        };
      })
      .filter(Boolean)
      .sort((x, y) => x.distanceToPickupKm - y.distanceToPickupKm);

    res.status(200).json({ success: true, data: { rides: nearby, count: nearby.length } });
  } catch (error) {
    console.error("Nearby rides error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc    Rider accepts a ride: either one offered to them (searching) or
 *          one an admin/company assigned to them.
 * @route   POST /api/rides/:rideId/accept
 * @access  Private (Driver)
 */
export const acceptRide = async (req, res) => {
  try {
    const driverUser = req.user;
    const { rideId } = req.params;

    if (driverUser.role !== "driver") {
      return res.status(403).json({ success: false, message: "Only drivers can accept rides" });
    }
    if (!mongoose.Types.ObjectId.isValid(rideId)) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver profile not found" });
    }
    if (!driver.isKycCleared()) {
      return res.status(403).json({ success: false, message: "Complete identity verification first", code: "KYC_REQUIRED" });
    }

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    if (ride.driverId) {
      // Case 1: assigned to this rider by an admin/company -> confirm it.
      if (ride.driverId.toString() !== driver._id.toString()) {
        return res.status(409).json({ success: false, message: "This ride has already been taken by another rider", code: "RIDE_TAKEN" });
      }
      if (!["assigned", "accepted"].includes(ride.status)) {
        return res.status(400).json({ success: false, message: `Ride can't be accepted while ${ride.status}` });
      }
      if (ride.status === "assigned") {
        ride.status = "accepted";
        ride.acceptedAt = new Date();
        await ride.save();
      }
    } else {
      // Case 2: an open request -> claim it (first valid accept wins).
      if (ride.status !== "searching") {
        return res.status(400).json({ success: false, message: "This ride is no longer available" });
      }
      if (!driver.isOnline || !driver.isAvailable || driver.currentTripId || driver.currentDeliveryId) {
        return res.status(400).json({ success: false, message: "Go online and finish your current job before accepting rides" });
      }
      if (driver.vehicleType !== ride.vehicleType) {
        return res.status(400).json({ success: false, message: `This ride needs a ${ride.vehicleType}` });
      }
      if (!isOfferedTo(ride, driver._id)) {
        return res.status(403).json({
          success: false,
          message: "This request was offered to other riders first. It will open to you if they don't accept.",
          code: "NOT_OFFERED_YET",
        });
      }

      // Reserve the rider first so they can't take two jobs at once...
      const reserved = await Driver.findOneAndUpdate(
        {
          _id: driver._id,
          isAvailable: true,
          $and: [
            { $or: [{ currentTripId: null }, { currentTripId: { $exists: false } }] },
            { $or: [{ currentDeliveryId: null }, { currentDeliveryId: { $exists: false } }] },
          ],
        },
        { $set: { currentTripId: ride._id, isAvailable: false, currentStatus: "busy" } },
        { new: true }
      );
      if (!reserved) {
        return res.status(400).json({ success: false, message: "You already have an active job" });
      }

      // ...then claim the ride atomically, so two riders can't both get it.
      const now = new Date();
      const claimed = await Ride.findOneAndUpdate(
        { _id: ride._id, status: "searching", driverId: null },
        {
          $set: {
            driverId: driver._id,
            companyId: driver.companyId || null,
            status: "accepted",
            assignedAt: now,
            acceptedAt: now,
            "dispatch.nextWaveAt": null,
          },
        },
        { new: true }
      );
      if (!claimed) {
        await Driver.updateOne(
          { _id: driver._id, currentTripId: ride._id },
          { $set: { currentTripId: null, isAvailable: true, currentStatus: "online" } }
        );
        return res.status(409).json({ success: false, message: "Another rider accepted this ride first", code: "RIDE_TAKEN" });
      }
    }

    const accepted = await Ride.findById(ride._id).populate([
      { path: "customerId", select: "name phone" },
      { path: "companyId", select: "name" },
    ]);

    await sendNotification({
      userId: accepted.customerId._id,
      ...NotificationTemplates.RIDE_ACCEPTED(accepted._id, driverUser.name),
    });
    req.app.get("io")?.to(`user_${accepted.customerId._id}`).emit("ride:accepted", {
      rideId: accepted._id,
      driver: {
        id: driver._id,
        name: driverUser.name,
        phone: driverUser.phone,
        vehicleType: driver.vehicleType,
        plateNumber: driver.plateNumber,
        vehicleColor: driver.vehicleColor,
      },
    });

    res.status(200).json({ success: true, message: "Ride accepted successfully", data: accepted });
  } catch (error) {
    console.error("Accept ride error:", error);
    res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

/**
 * @desc    Rider declines a ride request
 * @route   POST /api/rides/:rideId/reject
 * @access  Private (Driver)
 */
export const rejectRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(rideId)) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }
    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver profile not found" });
    }
    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, status: "searching", driverId: null, "rejectedByDrivers.driverId": { $ne: driver._id } },
      {
        $push: {
          rejectedByDrivers: { driverId: driver._id, rejectedAt: new Date(), reason: req.body?.reason || "No reason provided" },
        },
      },
      { new: true }
    );
    if (!ride) {
      return res.status(400).json({ success: false, message: "This ride is no longer open, or you already declined it" });
    }
    await onRideRejected(ride._id);
    res.status(200).json({ success: true, message: "Ride declined" });
  } catch (error) {
    console.error("Reject ride error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc    Driver arrived at pickup location
 * @route   POST /api/rides/:rideId/arrive
 * @access  Private (Driver)
 */
export const arriveAtPickup = async (req, res) => {
  try {
    const driverUser = req.user;
    const { rideId } = req.params;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const ride = await Ride.findOne({
      _id: rideId,
      driverId: driver._id
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    if (ride.status !== 'accepted') {
      return res.status(400).json({ success: false, message: `Can't mark arrived while ride is ${ride.status}` });
    }

    ride.status = 'arrived';
    ride.arrivedAt = new Date();
    await ride.save();

    // Notify customer
    await sendNotification({
      userId: ride.customerId,
      ...NotificationTemplates.RIDE_ARRIVED(ride._id, driverUser.name),
    });

    res.status(200).json({
      success: true,
      message: "Driver arrived at pickup location",
      data: ride
    });

  } catch (error) {
    console.error("Arrive at pickup error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Start ride (customer picked up)
 * @route   POST /api/rides/:rideId/start
 * @access  Private (Driver)
 */
export const startRide = async (req, res) => {
  try {
    const driverUser = req.user;
    const { rideId } = req.params;

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const ride = await Ride.findOne({
      _id: rideId,
      driverId: driver._id
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    if (!['accepted', 'arrived'].includes(ride.status)) {
      return res.status(400).json({ success: false, message: `Can't start ride while it is ${ride.status}` });
    }

    ride.status = 'started';
    ride.startedAt = new Date();
    ride.pickedUpAt = ride.pickedUpAt || ride.startedAt;
    await ride.save();

    // Notify customer
    await sendNotification({
      userId: ride.customerId,
      ...NotificationTemplates.RIDE_STARTED(ride._id),
    });

    res.status(200).json({
      success: true,
      message: "Ride started",
      data: ride
    });

  } catch (error) {
    console.error("Start ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Complete ride
 * @route   POST /api/rides/:rideId/complete
 * @access  Private (Driver)
 */
export const completeRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { rideId } = req.params;
    const { actualDistance, actualFare } = req.body;

    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const ride = await Ride.findOne({
      _id: rideId,
      driverId: driver._id
    }).session(session);

    if (!ride) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    if (!['accepted', 'arrived', 'started'].includes(ride.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: `Can't complete ride while it is ${ride.status}` });
    }

    // Complete the ride
    ride.status = 'completed';
    ride.completedAt = new Date();
    ride.actualDistance = actualDistance || ride.estimatedDistance;
    ride.actualFare = actualFare || ride.estimatedFare;
    await ride.save({ session });

    // Update driver stats and make available again
    driver.currentTripId = null;
    driver.isAvailable = true;
    driver.currentStatus = driver.isOnline ? 'online' : 'offline';
    driver.stats.totalTrips = (driver.stats.totalTrips || 0) + 1;
    driver.stats.completedTrips = (driver.stats.completedTrips || 0) + 1;
    driver.stats.totalEarnings = (driver.stats.totalEarnings || 0) + (Number(ride.actualFare) || 0);
    await driver.save({ session });

    await session.commitTransaction();

    // Notify customer ride is complete
    await sendNotification({
      userId: ride.customerId,
      ...NotificationTemplates.RIDE_COMPLETED(ride._id, ride.actualFare),
    });

    // Populate data
    await ride.populate([
      { path: 'customerId', select: 'name phone' },
      { path: 'companyId', select: 'name' }
    ]);

    res.status(200).json({
      success: true,
      message: "Ride completed successfully",
      data: ride
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Complete ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Cancel ride
 * @route   POST /api/rides/:rideId/cancel
 * @access  Private (Customer/Driver)
 */
export const cancelRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { rideId } = req.params;
    const { reason } = req.body;

    const ride = await Ride.findById(rideId).session(session);

    if (!ride) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    if (['completed', 'cancelled'].includes(ride.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: `Ride is already ${ride.status}` });
    }

    // Verify user can cancel this ride
    let cancelledBy;
    let cancellationFee = 0;

    if (user.role === 'customer') {
      if (ride.customerId.toString() !== user._id.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: "Not authorized to cancel this ride"
        });
      }
      cancelledBy = 'customer';
      
      // Apply cancellation fee if driver already accepted
      if (['accepted', 'arrived'].includes(ride.status)) {
        cancellationFee = 200; // 200 cancellation fee
      }
    } else if (user.role === 'driver') {
      const driver = await Driver.findOne({ userId: user._id }).session(session);
      if (!driver || ride.driverId?.toString() !== driver._id.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: "Not authorized to cancel this ride"
        });
      }
      cancelledBy = 'driver';
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Invalid user role"
      });
    }

    // Cancel the ride
    ride.status = 'cancelled';
    ride.cancelledAt = new Date();
    // These live under ride.cancellation in the schema (writing them at the top
    // level was silently dropped before).
    ride.cancellation = {
      cancelledBy,
      reason: reason || 'No reason provided',
      cancellationFee,
    };
    await ride.save({ session });

    // If driver was assigned, make them available again
    if (ride.driverId) {
      const driver = await Driver.findById(ride.driverId).session(session);
      if (driver && driver.currentTripId?.toString() === ride._id.toString()) {
        driver.currentTripId = null;
        driver.isAvailable = true;
        await driver.save({ session });
      }
    }

    await session.commitTransaction();

    // Notify the other party about cancellation
    if (cancelledBy === 'customer' && ride.driverId) {
      const driver = await Driver.findById(ride.driverId).populate('userId', '_id');
      if (driver?.userId) {
        await sendNotification({
          userId: driver.userId._id,
          ...NotificationTemplates.RIDE_CANCELLED(ride._id, 'customer', reason),
        });
      }
    } else if (cancelledBy === 'driver') {
      await sendNotification({
        userId: ride.customerId,
        ...NotificationTemplates.RIDE_CANCELLED(ride._id, 'driver', reason),
      });
    }

    res.status(200).json({
      success: true,
      message: "Ride cancelled",
      data: {
        ride,
        cancellationFee
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Cancel ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Rate ride (Customer rates driver)
 * @route   POST /api/rides/:rideId/rate
 * @access  Private (Customer)
 */
export const rateRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const customer = req.user;
    const { rideId } = req.params;
    const { rating, feedback } = req.body;

    if (customer.role !== 'customer') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only customers can rate rides"
      });
    }

    if (!rating || rating < 1 || rating > 5) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5"
      });
    }

    const ride = await Ride.findOne({
      _id: rideId,
      customerId: customer._id
    }).session(session);

    if (!ride) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    if (ride.status !== 'completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "You can only rate a completed ride" });
    }
    if (ride.rating?.byCustomer?.score) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "You have already rated this ride" });
    }

    // Stored under rating.byCustomer (writing ride.rating.score was silently dropped before).
    ride.set('rating.byCustomer', {
      score: rating,
      feedback: feedback || '',
      ratedAt: new Date()
    });
    await ride.save({ session });

    // Update driver rating
    if (ride.driverId) {
      const driver = await Driver.findById(ride.driverId).session(session);
      if (driver) {
        // averageRating/ratingCount don't exist on Driver, so ratings were
        // silently dropped. Use the real rating fields.
        driver.applyRating(rating);
        await driver.save({ session });
      }
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Rating submitted successfully",
      data: ride
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Rate ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get company rides (Company Admin)
 * @route   GET /api/companies/:companyId/rides
 * @access  Private (Company Admin)
 */
export const getCompanyRides = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;
    
    if (admin.role !== "company_admin" && admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }
    
    if (admin.role === "company_admin" && admin.companyId?.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot access another company's rides"
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;

    const query = { companyId };
    if (status) query.status = status;

    const [rides, total] = await Promise.all([
      Ride.find(query)
        .populate('customerId', 'name phone')
        .populate({
          path: 'driverId',
          populate: { path: 'userId', select: 'name phone' }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Ride.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: rides,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get company rides error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get driver rides (Driver)
 * @route   GET /api/drivers/my-rides
 * @access  Private (Driver)
 */
export const getDriverRides = async (req, res) => {
  try {
    const driverUser = req.user;
    
    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found"
      });
    }

    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { driverId: driver._id };
    if (status) query.status = status;

    const [rides, total] = await Promise.all([
      Ride.find(query)
        .populate('customerId', 'name phone')
        .populate('companyId', 'name')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Ride.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: rides,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get driver rides error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get ride by ID
 * @route   GET /api/rides/:rideId
 * @access  Private
 */
export const getRideById = async (req, res) => {
  try {
    const user = req.user;
    const { rideId } = req.params;

    const ride = await Ride.findById(rideId)
      .populate('customerId', 'name phone email')
      .populate('companyId', 'name contactPhone')
      .populate({
        path: 'driverId',
        populate: { path: 'userId', select: 'name phone' }
      });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found"
      });
    }

    // Check access permissions
    let hasAccess = false;

    if (user.role === "admin") {
      hasAccess = true;
    } else if (user.role === "customer" && ride.customerId._id.toString() === user._id.toString()) {
      hasAccess = true;
    } else if (user.role === "driver") {
      const driver = await Driver.findOne({ userId: user._id });
      if (driver && ride.driverId?._id.toString() === driver._id.toString()) {
        hasAccess = true;
      }
    } else if (user.role === "company_admin" && ride.companyId?._id.toString() === user.companyId?.toString()) {
      hasAccess = true;
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    res.status(200).json({
      success: true,
      data: ride
    });

  } catch (error) {
    console.error("Get ride by ID error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get all rides (Admin only)
 * @route   GET /api/admin/rides
 * @access  Private (Admin)
 */
export const getAllRides = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required"
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status;
    const companyId = req.query.companyId;

    const query = {};
    if (status) query.status = status;
    if (companyId) query.companyId = companyId;

    const [rides, total] = await Promise.all([
      Ride.find(query)
        .populate('customerId', 'name phone')
        .populate('companyId', 'name')
        .populate({
          path: 'driverId',
          populate: { path: 'userId', select: 'name phone' }
        })
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Ride.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: rides,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error("Get all rides error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * @desc    Get ride statistics
 * @route   GET /api/rides/statistics
 * @access  Private
 */
export const getRideStatistics = async (req, res) => {
  try {
    const user = req.user;
    let filters = {};

    // Apply filters based on user role
    if (user.role === 'customer') {
      filters.customerId = user._id;
    } else if (user.role === 'driver') {
      const driver = await Driver.findOne({ userId: user._id });
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: "Driver profile not found"
        });
      }
      filters.driverId = driver._id;
    } else if (user.role === 'company_admin') {
      filters.companyId = user.companyId;
    } else if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    // Calculate statistics
    const stats = await Ride.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          completedRides: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
          },
          cancelledRides: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] }
          },
          totalEarnings: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$actualFare", 0] }
          },
          totalDistance: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$actualDistance", 0] }
          }
        }
      },
      {
        $project: {
          totalRides: 1,
          completedRides: 1,
          cancelledRides: 1,
          activeRides: { $subtract: ["$totalRides", { $add: ["$completedRides", "$cancelledRides"] }] },
          totalEarnings: 1,
          totalDistance: 1,
          averageEarnings: { $divide: ["$totalEarnings", { $max: ["$completedRides", 1] }] },
          completionRate: {
            $multiply: [
              { $divide: ["$completedRides", { $max: ["$totalRides", 1] }] },
              100
            ]
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalRides: 0,
      completedRides: 0,
      cancelledRides: 0,
      activeRides: 0,
      totalEarnings: 0,
      totalDistance: 0,
      averageEarnings: 0,
      completionRate: 0
    };

    res.status(200).json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error("Get ride statistics error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};