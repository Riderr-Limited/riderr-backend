import Ride from "../models/ride.model.js";
import User from "../models/user.models.js";
import Driver from "../models/riders.models.js"; 
import Company from "../models/company.models.js";
import mongoose from "mongoose";

/**
 * Calculate fare based on distance and vehicle type
 */
const calculateFare = (distanceMeters, vehicleType) => {
  const distanceKm = distanceMeters / 1000;
  
  const rates = {
    bike: { base: 200, perKm: 100 },      // ₦200 base + ₦100/km
    car: { base: 500, perKm: 150 },       // ₦500 base + ₦150/km
    van: { base: 800, perKm: 200 },       // ₦800 base + ₦200/km
    truck: { base: 1500, perKm: 300 }     // ₦1500 base + ₦300/km
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

    // Calculate estimated fare
    const distance = estimatedDistance || 5000; // Default 5km if not provided
    const estimatedFare = calculateFare(distance, vehicleType);

    // Check if customer has active ride
    const activeRide = await Ride.findOne({
      customerId: customer._id,
      status: { $in: ['searching', 'accepted', 'arrived', 'started'] }
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

    res.status(201).json({
      success: true,
      message: "Ride request created successfully. Searching for nearby drivers...",
      data: ride
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
        status: { $in: ['searching', 'accepted', 'arrived', 'started'] }
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
        status: { $in: ['accepted', 'arrived', 'started'] }
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
 * @desc    Driver accepts assigned ride
 * @route   POST /api/rides/:rideId/accept
 * @access  Private (Driver)
 */
export const acceptRide = async (req, res) => {
  try {
    const driverUser = req.user;
    const { rideId } = req.params;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can accept rides"
      });
    }

    // Find driver profile
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
        message: "Ride not found or not assigned to you"
      });
    }

    ride.status = 'accepted';
    ride.acceptedAt = new Date();
    await ride.save();

    // Populate data
    await ride.populate([
      { path: 'customerId', select: 'name phone' },
      { path: 'companyId', select: 'name' }
    ]);

    res.status(200).json({
      success: true,
      message: "Ride accepted successfully",
      data: ride
    });

  } catch (error) {
    console.error("Accept ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
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

    ride.status = 'arrived';
    ride.arrivedAt = new Date();
    await ride.save();

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

    ride.status = 'started';
    ride.startedAt = new Date();
    await ride.save();

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

    // Complete the ride
    ride.status = 'completed';
    ride.completedAt = new Date();
    ride.actualDistance = actualDistance || ride.estimatedDistance;
    ride.actualFare = actualFare || ride.estimatedFare;
    await ride.save({ session });

    // Update driver stats and make available again
    driver.currentTripId = null;
    driver.isAvailable = true;
    driver.totalTrips = (driver.totalTrips || 0) + 1;
    driver.totalEarnings = (driver.totalEarnings || 0) + ride.actualFare;
    await driver.save({ session });

    await session.commitTransaction();

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
        cancellationFee = 200; // ₦200 cancellation fee
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
    ride.cancelledBy = cancelledBy;
    ride.cancellationReason = reason || 'No reason provided';
    ride.cancellationFee = cancellationFee;
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

    // Add rating to ride
    ride.rating = {
      score: rating,
      feedback: feedback || '',
      ratedAt: new Date()
    };
    await ride.save({ session });

    // Update driver rating
    if (ride.driverId) {
      const driver = await Driver.findById(ride.driverId).session(session);
      if (driver) {
        // Calculate new average rating
        const totalRatings = driver.ratingCount || 0;
        const currentRating = driver.averageRating || 0;
        const newRatingCount = totalRatings + 1;
        const newAverageRating = ((currentRating * totalRatings) + rating) / newRatingCount;
        
        driver.averageRating = parseFloat(newAverageRating.toFixed(1));
        driver.ratingCount = newRatingCount;
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