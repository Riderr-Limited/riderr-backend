import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import { calculateFare } from "../utils/fareCalculator.js";
import { sendNotification, NotificationTemplates } from "../utils/notification.js";
import crypto from "crypto";
import { smartReverseGeocode } from "../utils/geocoding.js";
import Payment from '../models/payments.models.js'
/**
 * UTILITY FUNCTIONS
 */

// Calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  // Handle null/undefined values
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return 0;
  }

  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * ✅ ENHANCED: Complete driver and company details population
 */
const populateDriverAndCompanyDetails = async (delivery) => {
  try {
    if (!delivery) return null;

    // Convert to plain object if it's a mongoose document
    const deliveryObj = delivery.toObject ? delivery.toObject() : { ...delivery };

    // If no driver assigned, return as is
    if (!deliveryObj.driverId) {
      console.log('ℹ️ No driver assigned to delivery');
      return deliveryObj;
    }

    console.log(`🔍 Populating driver and company for delivery: ${deliveryObj._id}`);

    // Fetch driver with populated user AND company
    const driver = await Driver.findById(deliveryObj.driverId)
      .populate('userId', 'name phone avatarUrl rating')
      .populate('companyId', 'name logo contactPhone address email rating')
      .lean();

    if (!driver) {
      console.log('❌ Driver not found');
      return deliveryObj;
    }

    // Build driver details
    if (driver.userId) {
      deliveryObj.driverDetails = {
        driverId: driver._id,
        userId: driver.userId._id,
        name: driver.userId.name || "Driver",
        phone: driver.userId.phone || "",
        avatarUrl: driver.userId.avatarUrl,
        rating: driver.userId.rating || 0,
        vehicle: {
          type: driver.vehicleType || "bike",
          make: driver.vehicleMake || "",
          model: driver.vehicleModel || "",
          plateNumber: driver.plateNumber || "",
        },
      };

      // Add current location if available
      if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        deliveryObj.driverDetails.currentLocation = {
          lat: driver.currentLocation.lat,
          lng: driver.currentLocation.lng,
          updatedAt: driver.currentLocation.updatedAt || new Date(),
        };
      } else if (driver.location?.coordinates && driver.location.coordinates.length >= 2) {
        deliveryObj.driverDetails.currentLocation = {
          lat: driver.location.coordinates[1],
          lng: driver.location.coordinates[0],
          updatedAt: new Date(),
        };
      }

      // Save to database if not already saved
      if (!delivery.driverDetails?.name) {
        await Delivery.findByIdAndUpdate(deliveryObj._id, {
          driverDetails: deliveryObj.driverDetails
        });
      }
    }

    // Build company details
    if (driver.companyId) {
      deliveryObj.companyDetails = {
        companyId: driver.companyId._id,
        name: driver.companyId.name || "Company",
        logo: driver.companyId.logo,
        contactPhone: driver.companyId.contactPhone || "",
        address: driver.companyId.address || "",
        email: driver.companyId.email || "",
        rating: driver.companyId.rating || 0,
      };

      // Also set companyId if not set
      if (!deliveryObj.companyId) {
        deliveryObj.companyId = driver.companyId._id;
        await Delivery.findByIdAndUpdate(deliveryObj._id, {
          companyId: driver.companyId._id,
          companyDetails: deliveryObj.companyDetails
        });
      }
    }

    console.log('✅ Driver and company details populated');
    return deliveryObj;

  } catch (error) {
    console.error('❌ Error populating driver and company details:', error);
    return delivery;
  }
};

/**
 * ✅ ENHANCED: Save driver and company details to delivery
 */
const saveDriverAndCompanyDetailsToDelivery = async (deliveryId, driver) => {
  try {
    console.log(`💾 Saving driver and company details for delivery: ${deliveryId}`);
    
    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      console.log('❌ Delivery not found');
      return false;
    }

    if (!driver) {
      console.log('❌ Driver not provided');
      return false;
    }

    // Get driver user info - handle both populated and unpopulated cases
    let driverUser;
    let driverUserId;
    
    if (typeof driver.userId === 'object' && driver.userId !== null) {
      driverUser = driver.userId;
      driverUserId = driver.userId._id;
    } else if (driver.userId) {
      driverUserId = driver.userId;
      driverUser = await User.findById(driver.userId)
        .select('name phone avatarUrl rating')
        .lean();
    }

    if (!driverUser) {
      console.log('❌ Driver user not found');
      return false;
    }

    // Build driver details
    const driverDetails = {
      driverId: driver._id,
      userId: driverUserId,
      name: driverUser.name || "Driver",
      phone: driverUser.phone || "",
      avatarUrl: driverUser.avatarUrl,
      rating: driverUser.rating || 0,
      vehicle: {
        type: driver.vehicleType || "bike",
        make: driver.vehicleMake || "",
        model: driver.vehicleModel || "",
        plateNumber: driver.plateNumber || "",
      },
    };

    // Add current location if available
    if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      driverDetails.currentLocation = {
        lat: driver.currentLocation.lat,
        lng: driver.currentLocation.lng,
        updatedAt: driver.currentLocation.updatedAt || new Date(),
      };
    }

    delivery.driverDetails = driverDetails;

    // Get and save company details
    if (driver.companyId) {
      let companyData;
      
      if (typeof driver.companyId === 'object' && driver.companyId !== null) {
        companyData = driver.companyId;
      } else {
        companyData = await Company.findById(driver.companyId)
          .select('name logo contactPhone address email rating')
          .lean();
      }

      if (companyData) {
        const companyDetails = {
          companyId: companyData._id,
          name: companyData.name || "Company",
          logo: companyData.logo,
          contactPhone: companyData.contactPhone || "",
          address: companyData.address || "",
          email: companyData.email || "",
          rating: companyData.rating || 0,
        };

        delivery.companyId = companyData._id;
        delivery.companyDetails = companyDetails;
      }
    }

    await delivery.save();
    console.log(`✅ Driver and company details saved for delivery ${deliveryId}`);
    return true;
    
  } catch (error) {
    console.error("❌ Error saving driver and company details:", error);
    return false;
  }
};

/**
 * CUSTOMER CONTROLLERS
 */

export const getNearbyDrivers = async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    const drivers = await Driver.find({
      isOnline: true,
      isActive: true,
      approvalStatus: "approved",
      $or: [
        { "location.coordinates": { $exists: true, $ne: [0, 0] } },
        { "currentLocation.lat": { $exists: true } },
      ],
    })
      .populate("userId", "name phone avatarUrl rating")
      .populate("companyId", "name logo rating contactPhone");

    const driversWithDistance = drivers
      .map((driver) => {
        let driverLat, driverLng;

        if (
          driver.location &&
          driver.location.coordinates &&
          driver.location.coordinates.length >= 2
        ) {
          driverLng = driver.location.coordinates[0];
          driverLat = driver.location.coordinates[1];
        } else if (
          driver.currentLocation &&
          driver.currentLocation.lat &&
          driver.currentLocation.lng
        ) {
          driverLat = driver.currentLocation.lat;
          driverLng = driver.currentLocation.lng;
        } else if (driver.lat && driver.lng) {
          driverLat = driver.lat;
          driverLng = driver.lng;
        } else {
          return null;
        }

        const distance = calculateDistance(
          latitude,
          longitude,
          driverLat,
          driverLng
        );

        return {
          ...driver.toObject(),
          distance: parseFloat(distance.toFixed(2)),
          distanceText: `${distance.toFixed(1)} km away`,
          estimatedArrival: Math.ceil(distance * 3),
        };
      })
      .filter(
        (driver) => driver !== null && driver.distance <= parseFloat(radius)
      )
      .sort((a, b) => a.distance - b.distance);

    res.status(200).json({
      success: true,
      message: `Found ${driversWithDistance.length} nearby drivers`,
      data: driversWithDistance,
    });
  } catch (error) {
    console.error("❌ Get nearby drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to find nearby drivers",
    });
  }
};

/**
 * ✅ FIXED: Get customer's deliveries with complete driver and company details
 */
export const getMyDeliveries = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const { status, page = 1, limit = 10 } = req.query;

    const query = { customerId: customer._id };
    if (status && status !== "all") query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const deliveries = await Delivery.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Delivery.countDocuments(query);

    // ✅ Populate driver and company details for each delivery
    const deliveriesWithDetails = await Promise.all(
      deliveries.map(async (delivery) => {
        return await populateDriverAndCompanyDetails(delivery);
      })
    );

    res.status(200).json({
      success: true,
      data: deliveriesWithDetails,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get my deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * DRIVER CONTROLLERS
 */

export const getNearbyDeliveryRequests = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can view delivery requests",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      return res.status(400).json({
        success: false,
        message: "You're not available to accept new deliveries right now",
        reasons: {
          offline: !driver.isOnline ? "You need to be online" : null,
          unavailable: !driver.isAvailable ? "You're marked as unavailable" : null,
          busy: driver.currentDeliveryId ? "You have an active delivery" : null,
        }
      });
    }

    const { lat, lng, maxDistance = 10 } = req.query;

    let latitude, longitude;

    if (lat && lng) {
      latitude = parseFloat(lat);
      longitude = parseFloat(lng);
    } else if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      latitude = driver.currentLocation.lat;
      longitude = driver.currentLocation.lng;
    } else {
      return res.status(400).json({
        success: false,
        message: "We couldn't find your location. Please enable location services and try again",
      });
    }

    // ✅ UPDATED: Only show deliveries that are either:
    // 1. Cash payments (payment.method === 'cash')
    // 2. Paid non-cash payments (payment.status === 'paid')
    const deliveries = await Delivery.find({
      status: "created",
      driverId: { $exists: false },
      $or: [
        { 
          'payment.method': 'cash' 
        },
        { 
          'payment.method': { $in: ['card', 'bank_transfer', 'bank'] },
          'payment.status': 'paid'
        }
      ]
    })
      .populate("customerId", "name phone avatarUrl rating")
      .sort({ createdAt: -1 })
      .limit(50);

    const nearbyDeliveries = [];

    for (const delivery of deliveries) {
      if (!delivery.pickup?.lat || !delivery.pickup?.lng) continue;

      const distance = calculateDistance(
        latitude,
        longitude,
        delivery.pickup.lat,
        delivery.pickup.lng
      );

      if (distance <= parseFloat(maxDistance)) {
        const pickupTimeMinutes = Math.ceil(distance * 3);

        const formattedDelivery = {
          _id: delivery._id,
          pickup: {
            address: delivery.pickup.address || "Address not specified",
            lat: delivery.pickup.lat,
            lng: delivery.pickup.lng,
            name: delivery.pickup.name || "Pickup Location",
            phone: delivery.pickup.phone || "Phone not specified",
            instructions: delivery.pickup.instructions || "",
          },
          dropoff: {
            address: delivery.dropoff.address || "Address not specified",
            lat: delivery.dropoff.lat,
            lng: delivery.dropoff.lng,
            name: delivery.dropoff.name || "Dropoff Location",
            phone: delivery.dropoff.phone || "Phone not specified",
            instructions: delivery.dropoff.instructions || "",
          },
          recipientName: delivery.recipientName,
          recipientPhone: delivery.recipientPhone,
          itemDetails: delivery.itemDetails,
          fare: delivery.fare,
          estimatedDistanceKm: delivery.estimatedDistanceKm || distance,
          estimatedDurationMin:
            delivery.estimatedDurationMin || Math.ceil(distance * 3),
          payment: {
            method: delivery.payment.method,
            status: delivery.payment.status,
            isPaid: delivery.payment.method === 'cash' ? false : delivery.payment.status === 'paid',
            cashOnDelivery: delivery.payment.method === 'cash',
          },
          customer: delivery.customerId,
          createdAt: delivery.createdAt,
          distanceFromDriver: parseFloat(distance.toFixed(2)),
          distanceText: `${distance.toFixed(1)} km away`,
          estimatedPickupTime: pickupTimeMinutes,
          estimatedPickupTimeText: `${pickupTimeMinutes} min`,
          canAccept: true,
        };

        nearbyDeliveries.push(formattedDelivery);
      }
    }

    nearbyDeliveries.sort(
      (a, b) => a.distanceFromDriver - b.distanceFromDriver
    );

    const message = nearbyDeliveries.length > 0
      ? `Found ${nearbyDeliveries.length} delivery ${nearbyDeliveries.length === 1 ? 'request' : 'requests'} near you`
      : "No delivery requests available in your area right now";

    res.status(200).json({
      success: true,
      message: message,
      data: {
        deliveries: nearbyDeliveries,
        driverLocation: { lat: latitude, lng: longitude },
        searchRadius: maxDistance,
        count: nearbyDeliveries.length,
      },
    });
  } catch (error) {
    console.error("❌ Get nearby deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while loading delivery requests. Please try again",
    });
  }
};


export const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`🚗 [STEP 3] Driver ${driverUser._id} accepting delivery ${deliveryId}`);

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      await session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can accept deliveries",
      });
    }

    // Get driver with session
    const driver = await Driver.findOne({ userId: driverUser._id })
      .populate('userId', 'name phone avatarUrl rating')
      .populate('companyId', 'name logo contactPhone address email rating paystackSubaccountCode')
      .session(session);
      
    if (!driver) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(404).json({
        success: false,
        message: "Your driver profile wasn't found. Please contact support",
      });
    }

    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      await session.abortTransaction();
      await session.endSession();
      
      let specificMessage = "You cannot accept new deliveries right now";
      
      if (!driver.isOnline) {
        specificMessage = "You need to be online to accept deliveries. Please go online first";
      } else if (driver.currentDeliveryId) {
        specificMessage = "You already have an active delivery. Please complete it before accepting a new one";
      } else if (!driver.isAvailable) {
        specificMessage = "You're currently unavailable. Please mark yourself as available to accept deliveries";
      }
      
      return res.status(400).json({
        success: false,
        message: specificMessage,
      });
    }

    // Get delivery with session
    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      await session.endSession();
      return res.status(404).json({
        success: false,
        message: "This delivery request no longer exists or has been cancelled",
      });
    }

    // ✅ UPDATED: Check if payment is required based on payment method
    const isCashPayment = delivery.payment?.method === 'cash';
    
    // For non-cash payments (card, bank transfer, escrow), require payment to be completed
    if (!isCashPayment && delivery.payment.status !== 'paid') {
      await session.abortTransaction();
      await session.endSession();
      
      const paymentMethodName = delivery.payment.method === 'card' ? 'card' : 'bank transfer';
      
      return res.status(400).json({
        success: false,
        message: `Customer hasn't completed payment yet. This delivery requires ${paymentMethodName} payment before you can accept it`,
        data: {
          paymentStatus: delivery.payment.status,
          paymentMethod: delivery.payment.method,
          requiresPayment: true,
        },
      });
    }

    // For cash payments, we can proceed without upfront payment
    if (isCashPayment && delivery.payment.status !== 'pending') {
      console.log(`💰 Cash delivery - Payment status: ${delivery.payment.status}`);
      delivery.payment.status = 'pending';
    }

    if (delivery.status !== "created" || delivery.driverId) {
      await session.abortTransaction();
      await session.endSession();
      
      let specificMessage = "This delivery is no longer available";
      
      if (delivery.driverId) {
        specificMessage = "Another driver has already accepted this delivery";
      } else if (delivery.status === 'cancelled') {
        specificMessage = "This delivery has been cancelled by the customer";
      } else if (delivery.status !== 'created') {
        specificMessage = "This delivery is no longer available for acceptance";
      }
      
      return res.status(400).json({
        success: false,
        message: specificMessage,
      });
    }

    // Update payment with driver and company info (if Payment model exists and not cash)
    let payment = null;
    if (!isCashPayment) {
      try {
        payment = await Payment.findOne({
          deliveryId: delivery._id,
          status: 'successful',
        }).session(session);

        if (payment) {
          payment.driverId = driver._id;
          payment.companyId = driver.companyId?._id || driver.companyId;
          
          // Add company subaccount for settlement
          if (driver.companyId && driver.companyId.paystackSubaccountCode) {
            payment.metadata = {
              ...payment.metadata,
              companySubaccount: driver.companyId.paystackSubaccountCode,
              driverAssignedAt: new Date(),
            };
          }
          
          await payment.save({ session });
        }
      } catch (error) {
        console.warn("⚠️ Payment update skipped:", error.message);
      }
    } else {
      // For cash payments, create a payment record if it doesn't exist
      try {
        payment = await Payment.findOne({
          deliveryId: delivery._id,
        }).session(session);

        if (!payment) {
          payment = new Payment({
            deliveryId: delivery._id,
            customerId: delivery.customerId,
            driverId: driver._id,
            companyId: driver.companyId?._id || driver.companyId,
            amount: delivery.fare.totalFare,
            currency: 'NGN',
            status: 'pending',
            paymentMethod: 'cash',
            companyAmount: delivery.fare.totalFare,
            platformFee: 0,
            paymentType: 'cash_on_delivery',
            metadata: {
              paymentType: 'cash',
              requiresCashCollection: true,
              driverAssignedAt: new Date(),
              paymentStatus: 'to_be_collected',
            },
          });
          await payment.save({ session });
        }
      } catch (error) {
        console.warn("⚠️ Cash payment record creation skipped:", error.message);
      }
    }

    // Calculate distance from driver to pickup
    let driverToPickupDistance = 5; // default
    if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      driverToPickupDistance = calculateDistance(
        driver.currentLocation.lat,
        driver.currentLocation.lng,
        delivery.pickup.lat,
        delivery.pickup.lng
      );
    }

    // Prepare driver and company details
    const driverDetails = {
      driverId: driver._id,
      userId: driver.userId._id,
      name: driver.userId.name || "Driver",
      phone: driver.userId.phone || "",
      avatarUrl: driver.userId.avatarUrl,
      rating: driver.userId.rating || 0,
      vehicle: {
        type: driver.vehicleType || "bike",
        make: driver.vehicleMake || "",
        model: driver.vehicleModel || "",
        plateNumber: driver.plateNumber || "",
      },
    };

    if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      driverDetails.currentLocation = {
        lat: driver.currentLocation.lat,
        lng: driver.currentLocation.lng,
        updatedAt: driver.currentLocation.updatedAt || new Date(),
      };
    }

    const companyDetails = driver.companyId ? {
      companyId: driver.companyId._id,
      name: driver.companyId.name || "Company",
      logo: driver.companyId.logo,
      contactPhone: driver.companyId.contactPhone || "",
      address: driver.companyId.address || "",
      email: driver.companyId.email || "",
      rating: driver.companyId.rating || 0,
    } : null;

    // Update delivery
    delivery.driverId = driver._id;
    delivery.companyId = companyDetails?.companyId || null;
    delivery.status = "assigned";
    delivery.assignedAt = new Date();
    delivery.estimatedPickupTime = new Date(Date.now() + driverToPickupDistance * 3 * 60000);
    delivery.driverDetails = driverDetails;
    if (companyDetails) {
      delivery.companyDetails = companyDetails;
    }

    // Update driver
    driver.currentDeliveryId = delivery._id;
    driver.isAvailable = false;
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    driver.acceptedRequests = (driver.acceptedRequests || 0) + 1;

    await delivery.save({ session });
    await driver.save({ session });

    // Get customer for notification
    const customer = await User.findById(delivery.customerId);
    
    // Commit transaction first
    await session.commitTransaction();
    await session.endSession();

    // Send notifications (outside transaction)
    if (customer) {
      const paymentMessage = isCashPayment 
        ? `This is a cash-on-delivery payment. Please have ₦${delivery.fare.totalFare.toLocaleString()} ready when the driver arrives.`
        : 'Payment is held securely and will be released after delivery completion.';
      
      await sendNotification({
        userId: customer._id,
        title: '🚗 Driver Assigned!',
        message: `${driver.userId.name}${driver.companyId ? ` from ${driver.companyId.name}` : ''} has accepted your delivery. ${paymentMessage}`,
        data: {
          type: 'driver_assigned',
          deliveryId: delivery._id,
          driverId: driver._id,
          driverName: driver.userId.name,
          companyName: driver.companyId?.name,
          paymentMethod: delivery.payment.method,
          isCashPayment: isCashPayment,
        },
      });
    }

    const driverMessage = isCashPayment
      ? `You've accepted a cash delivery. Please collect ₦${delivery.fare.totalFare.toLocaleString()} from the customer upon delivery`
      : `You've accepted a delivery. Payment of ₦${delivery.fare.totalFare.toLocaleString()} is secured. Head to the pickup location`;

    await sendNotification({
      userId: driverUser._id,
      title: '✅ Delivery Accepted',
      message: driverMessage,
      data: {
        type: 'delivery_accepted',
        deliveryId: delivery._id,
        paymentMethod: delivery.payment.method,
        isCashPayment: isCashPayment,
        amountToCollect: isCashPayment ? delivery.fare.totalFare : null,
      },
    });

    // Fetch updated delivery with populated details
    const updatedDelivery = await Delivery.findById(delivery._id)
      .populate("customerId", "name phone avatarUrl rating")
      .lean();
    
    const deliveryWithDetails = await populateDriverAndCompanyDetails(updatedDelivery);

    console.log(`✅ Delivery accepted - Payment method: ${delivery.payment.method}`);

    res.status(200).json({
      success: true,
      message: isCashPayment 
        ? "Delivery accepted! Remember to collect cash payment upon delivery"
        : "Delivery accepted! Payment is secured. Head to the pickup location",
      data: {
        delivery: deliveryWithDetails,
        driver: deliveryWithDetails.driverDetails,
        company: deliveryWithDetails.companyDetails,
        payment: {
          method: delivery.payment.method,
          status: isCashPayment ? 'pending_cash_collection' : 'secured',
          amount: delivery.fare.totalFare,
          message: isCashPayment 
            ? 'Cash payment to be collected upon delivery'
            : 'Payment held securely until delivery completion',
          cashCollectionRequired: isCashPayment,
          amountToCollect: isCashPayment ? delivery.fare.totalFare : null,
        },
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    await session.endSession();
    
    console.error("❌ Accept delivery error:", error);
    
    if (error.code === 112) {
      return res.status(409).json({
        success: false,
        message: "Another driver just accepted this delivery. Please try another one",
      });
    }
    
    res.status(500).json({
      success: false,
      message: "Something went wrong while accepting the delivery. Please try again",
    });
  }
};

/**
 * ✅ UPDATED: Start delivery
  */
export const startDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`📦 [STEP 3b] Driver ${driverUser._id} starting delivery ${deliveryId}`);

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can start deliveries",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
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
        message: "Delivery not found or not assigned to this driver",
      });
    }

    if (delivery.status !== "assigned") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot start delivery from status: ${delivery.status}`,
      });
    }

    // Verify payment is still secured
    const payment = await Payment.findOne({
      deliveryId: delivery._id,
      status: 'successful',
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Payment not found or not confirmed",
      });
    }

    delivery.status = "picked_up";
    delivery.pickedUpAt = new Date();

    await delivery.save({ session });

    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: '📦 Package Picked Up',
        message: `Driver has picked up your package and is heading to the destination. Payment is secured.`,
        data: {
          type: 'package_picked_up',
          deliveryId: delivery._id,
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Delivery started - Payment still secured`);

    res.status(200).json({
      success: true,
      message: "Delivery started successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          pickedUpAt: delivery.pickedUpAt,
          nextStep: "Proceed to dropoff location",
        },
        payment: {
          status: 'secured',
          message: 'Payment held until customer confirms delivery',
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Start delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start delivery",
    });
  }
};



export const completeDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`✅ [STEP 4] Driver ${driverUser._id} completing delivery ${deliveryId}`);

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can complete deliveries",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
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
        message: "Delivery not found",
      });
    }

    if (delivery.status !== "picked_up") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Cannot complete delivery from status: ${delivery.status}`,
      });
    }

    // Mark as delivered (waiting for customer verification)
    delivery.status = "delivered";
    delivery.deliveredAt = new Date();

    // Driver becomes available for next delivery
    driver.currentDeliveryId = null;
    driver.isAvailable = true;

    await Promise.all([delivery.save({ session }), driver.save({ session })]);

    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: '✅ Package Delivered',
        message: `Your package has been delivered! Please verify the delivery to release payment.`,
        data: {
          type: 'delivery_completed',
          deliveryId: delivery._id,
          requiresVerification: true,
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Delivery completed - Waiting for customer verification`);

    res.status(200).json({
      success: true,
      message: "Delivery completed! Waiting for customer verification to release payment.",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          deliveredAt: delivery.deliveredAt,
          fare: delivery.fare,
        },
        driverAvailable: true,
        payment: {
          status: 'awaiting_verification',
          message: 'Payment will be released after customer verifies delivery',
          expectedAmount: delivery.fare.totalFare,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Complete delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete delivery",
    });
  }
};


/**
 * ✅ FIXED: Get driver's active delivery with complete details
 */
export const getDriverActiveDelivery = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    if (!driver.currentDeliveryId) {
      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    const delivery = await Delivery.findById(driver.currentDeliveryId)
      .populate("customerId", "name phone avatarUrl rating")
      .lean();

    if (!delivery) {
      driver.currentDeliveryId = null;
      driver.isAvailable = true;
      await driver.save();

      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    // ✅ Populate complete details
    const deliveryWithDetails = await populateDriverAndCompanyDetails(delivery);

    let etaMinutes = null;
    if (delivery.status === "assigned") {
      if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        const distanceToPickup = calculateDistance(
          driver.currentLocation.lat,
          driver.currentLocation.lng,
          delivery.pickup.lat,
          delivery.pickup.lng
        );
        etaMinutes = Math.ceil(distanceToPickup * 3);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...deliveryWithDetails,
        etaMinutes,
        nextAction:
          delivery.status === "assigned"
            ? "Go to pickup location"
            : delivery.status === "picked_up"
            ? "Go to dropoff location"
            : "Wait for instructions",
      },
    });
  } catch (error) {
    console.error("❌ Get active delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get active delivery",
    });
  }
};

/**
 * ✅ FIXED: Get driver's deliveries with complete details
 */
export const getDriverDeliveries = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const { status, page = 1, limit = 10 } = req.query;

    const query = { driverId: driver._id };
    if (status && status !== "all") query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const deliveries = await Delivery.find(query)
      .populate("customerId", "name phone avatarUrl rating")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Delivery.countDocuments(query);

    // ✅ Populate complete details for each delivery
    const deliveriesWithDetails = await Promise.all(
      deliveries.map(async (delivery) => {
        return await populateDriverAndCompanyDetails(delivery);
      })
    );

    res.status(200).json({
      success: true,
      data: deliveriesWithDetails,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get driver deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries",
    });
  }
};

export const rejectDelivery = async (req, res) => {
  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Only drivers can reject deliveries",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    driver.totalRequests = (driver.totalRequests || 0) + 1;
    await driver.save();

    res.status(200).json({
      success: true,
      message: "Delivery request rejected",
    });
  } catch (error) {
    console.error("❌ Reject delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject delivery",
    });
  }
};

/**
 * SHARED CONTROLLERS
 */

/**
 * ✅ FIXED: Get delivery details with complete driver and company info
 */
export const getDeliveryDetails = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .populate("customerId", "name phone avatarUrl")
      .lean();

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const isCustomer = user._id.toString() === delivery.customerId._id.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // ✅ Populate complete details
    const deliveryWithDetails = await populateDriverAndCompanyDetails(delivery);

    res.status(200).json({
      success: true,
      data: deliveryWithDetails,
    });
  } catch (error) {
    console.error("❌ Get delivery details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery details",
    });
  }
};

/**
 * ✅ FIXED: Track delivery with complete driver and company info
 */
export const trackDelivery = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .select("status pickup dropoff driverId driverDetails companyDetails customerId estimatedPickupTime recipientName recipientPhone fare createdAt assignedAt pickedUpAt deliveredAt")
      .lean();

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver";
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // ✅ Populate complete details
    const deliveryWithDetails = await populateDriverAndCompanyDetails(delivery);

    let driverLocation = null;
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).select(
        "currentLocation"
      );

      if (driver && driver.currentLocation) {
        driverLocation = {
          lat: driver.currentLocation.lat,
          lng: driver.currentLocation.lng,
          updatedAt: driver.currentLocation.updatedAt,
        };
      }
    }

    const timeline = [];
    if (delivery.createdAt)
      timeline.push({
        event: "created",
        time: delivery.createdAt,
        description: "Delivery request created",
      });
    if (delivery.assignedAt)
      timeline.push({
        event: "assigned",
        time: delivery.assignedAt,
        description: "Driver assigned",
      });
    if (delivery.pickedUpAt)
      timeline.push({
        event: "picked_up",
        time: delivery.pickedUpAt,
        description: "Package picked up",
      });
    if (delivery.deliveredAt)
      timeline.push({
        event: "delivered",
        time: delivery.deliveredAt,
        description: "Package delivered",
      });

    res.status(200).json({
      success: true,
      data: {
        ...deliveryWithDetails,
        driverLocation: driverLocation,
        timeline: timeline.sort((a, b) => new Date(a.time) - new Date(b.time)),
        canTrack: ["assigned", "picked_up"].includes(delivery.status),
      },
    });
  } catch (error) {
    console.error("❌ Track delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to track delivery",
    });
  }
};

export const cancelDelivery = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required",
      });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this delivery",
      });
    }

    if (delivery.status !== "created" && delivery.status !== "assigned") {
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be cancelled from status: ${delivery.status}`,
      });
    }

    delivery.status = "cancelled";
    delivery.cancelledAt = new Date();
    delivery.cancelledBy = {
      userId: user._id,
      role: user.role,
      reason: reason,
    };

    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        driver.currentDeliveryId = null;
        driver.isAvailable = true;
        await driver.save();

        const driverUser = await User.findById(driver.userId);
        if (driverUser) {
          await sendNotification({
            userId: driverUser._id,
            ...NotificationTemplates.CUSTOMER_CANCELLED(
              delivery._id,
              reason
            ),
          });
        }
      }
    }

    if (user.role === 'driver') {
      const customer = await User.findById(delivery.customerId);
      if (customer) {
        await sendNotification({
          userId: customer._id,
          ...NotificationTemplates.DELIVERY_CANCELLED(
            delivery._id,
            reason
          ),
        });
      }
    }

    await delivery.save();

    res.status(200).json({
      success: true,
      message: "Delivery cancelled successfully",
      data: {
        delivery: {
          _id: delivery._id,
          status: delivery.status,
          cancelledAt: delivery.cancelledAt,
        },
      },
    });
  } catch (error) {
    console.error("❌ Cancel delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel delivery",
    });
  }
};

export const rateDelivery = async (req, res) => {
  try {
    const customer = req.user;
    const { deliveryId } = req.params;
    const { rating, review, tip } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    const delivery = await Delivery.findOne({
      _id: deliveryId,
      customerId: customer._id,
      status: "delivered",
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found or cannot be rated",
      });
    }

    if (delivery.rating) {
      return res.status(400).json({
        success: false,
        message: "Delivery already rated",
      });
    }

    delivery.rating = rating;
    delivery.review = review;
    delivery.ratedAt = new Date();

    if (tip && tip > 0) {
      delivery.tip = {
        amount: tip,
        addedAt: new Date(),
      };
    }

    await delivery.save();

    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        const totalRatings = driver.totalRatings || 0;
        const currentRating = driver.rating || 0;
        const newTotalRatings = totalRatings + 1;
        const newRating =
          (currentRating * totalRatings + rating) / newTotalRatings;

        driver.rating = newRating;
        driver.totalRatings = newTotalRatings;

        if (tip && tip > 0) {
          driver.earnings = (driver.earnings || 0) + tip;
        }
 
        await driver.save();

        const driverUser = await User.findById(driver.userId);
        if (driverUser) {
          await sendNotification({
            userId: driverUser._id,
            ...NotificationTemplates.RATING_RECEIVED(
              delivery._id,
              rating,
              review
            ),
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Thank you for your rating!",
      data: { rating, review, tip },
    });
  } catch (error) {
    console.error("❌ Rate delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit rating",
    });
  }
};

const getDeliveryProgressPercentage = (status) => {
  const progressMap = {
    "created": 10,
    "assigned": 30,
    "picked_up": 60,
    "in_transit": 80,
    "delivered": 100,
    "cancelled": 0,
    "failed": 0,
  };
  return progressMap[status] || 10;
};

const getDeliveryStatusMessage = (status) => {
  const messages = {
    "created": "Looking for available drivers...",
    "assigned": "Driver assigned and heading to pickup",
    "picked_up": "Package picked up, heading to destination",
    "in_transit": "On the way to delivery location",
    "delivered": "Package delivered successfully",
    "cancelled": "Delivery cancelled",
    "failed": "Delivery failed",
  };
  return messages[status] || "Processing your delivery";
};

export const getDeliveryUpdates = async (req, res) => {
  try {
    const user = req.user;
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .select("status pickup dropoff driverId driverDetails tracking estimatedPickupTime pickedUpAt")
      .lean();

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    let driverLocation = null;
    let etaMinutes = null;

    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId)
        .select("currentLocation location");

      if (driver) {
        if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
          driverLocation = {
            lat: driver.currentLocation.lat,
            lng: driver.currentLocation.lng,
            updatedAt: driver.currentLocation.updatedAt,
          };
        } else if (driver.location?.coordinates && driver.location.coordinates.length >= 2) {
          driverLocation = {
            lat: driver.location.coordinates[1],
            lng: driver.location.coordinates[0],
            updatedAt: new Date(),
          };
        }

        if (driverLocation) {
          if (delivery.status === "picked_up" || delivery.status === "in_transit") {
            const distance = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              delivery.dropoff.lat,
              delivery.dropoff.lng
            );
            etaMinutes = Math.ceil(distance * 3);
          } else if (delivery.status === "assigned") {
            const distance = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              delivery.pickup.lat,
              delivery.pickup.lng
            );
            etaMinutes = Math.ceil(distance * 3);
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        deliveryId: delivery._id,
        status: delivery.status,
        driverLocation,
        etaMinutes,
        tracking: delivery.tracking || null,
        lastUpdate: new Date(),
        canTrack: ["assigned", "picked_up", "in_transit"].includes(delivery.status),
      },
    });
  } catch (error) {
    console.error("❌ Get delivery updates error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery updates",
    });
  }
};

export const getDriverDeliveryStats = async (req, res) => {
  try {
    const driverUser = req.user;

    if (driverUser.role !== "driver") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id });
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver profile not found",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [todayStats, weekStats, monthStats, allTimeStats] = await Promise.all([
      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: today },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            averageRating: { $avg: "$rating" },
          },
        },
      ]),

      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: weekAgo },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
          },
        },
      ]),

      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
            deliveredAt: { $gte: monthAgo },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
          },
        },
      ]),

      Delivery.aggregate([
        {
          $match: {
            driverId: driver._id,
            status: "delivered",
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            earnings: {
              $sum: {
                $add: ["$fare.totalFare", { $ifNull: ["$tip.amount", 0] }],
              },
            },
            averageRating: { $avg: "$rating" },
            averageEarning: { $avg: "$fare.totalFare" },
          },
        },
      ]),
    ]);

    const recentDeliveries = await Delivery.find({
      driverId: driver._id,
      status: "delivered",
    })
      .sort({ deliveredAt: -1 })
      .limit(5)
      .populate("customerId", "name avatarUrl")
      .select("deliveredAt fare.totalFare tip.amount rating pickup.address dropoff.address");

    res.status(200).json({
      success: true,
      data: {
        today: todayStats[0] || { count: 0, earnings: 0 },
        week: weekStats[0] || { count: 0, earnings: 0 },
        month: monthStats[0] || { count: 0, earnings: 0 },
        allTime: allTimeStats[0] || {
          count: 0,
          earnings: 0,
          averageRating: 0,
          averageEarning: 0,
        },
        recentDeliveries,
        acceptanceRate: driver.totalRequests
          ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
          : 0,
        onlineHours: driver.totalOnlineHours || 0,
        currentStatus: {
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          hasActiveDelivery: !!driver.currentDeliveryId,
        },
      },
    });
  } catch (error) {
    console.error("❌ Get driver delivery stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery statistics",
    });
  }
};

/**
 * ✅ FIXED: Get company deliveries with complete driver and company details
 */
export const getCompanyDeliveries = async (req, res) => {
  try {
    console.log('🔍 Fetching company deliveries...');
    
    const company = await Company.findById(req.user.companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const {
      status,
      startDate,
      endDate,
      driverId,
      page = 1,
      limit = 10,
    } = req.query;

    const companyDrivers = await Driver.find({ companyId: company._id })
      .select('_id')
      .lean();
    
    console.log(`🚗 Found ${companyDrivers.length} company drivers`);
    
    if (companyDrivers.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No drivers found for this company",
        data: [],
        pagination: {
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: 0,
        },
      });
    }

    const driverIds = companyDrivers.map(driver => driver._id);
    
    let query = { driverId: { $in: driverIds } };
    
    if (status && status !== "all") {
      query.status = status;
    }
    if (driverId) {
      query.driverId = driverId;
    }
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [deliveries, total] = await Promise.all([
      Delivery.find(query)
        .populate("customerId", "name phone email avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Delivery.countDocuments(query),
    ]);

    console.log(`📦 Found ${deliveries.length} deliveries for company`);

    // ✅ Populate complete driver and company details for each delivery
    const formattedDeliveries = await Promise.all(
      deliveries.map(async (delivery) => {
        const deliveryWithDetails = await populateDriverAndCompanyDetails(delivery);
        
        // Add customer info
        if (deliveryWithDetails.customerId) {
          deliveryWithDetails.customer = {
            _id: deliveryWithDetails.customerId._id,
            name: deliveryWithDetails.customerId.name || "Customer",
            phone: deliveryWithDetails.customerId.phone || "",
            email: deliveryWithDetails.customerId.email || "",
            avatarUrl: deliveryWithDetails.customerId.avatarUrl,
          };
        }
        
        // Ensure company details are present
        if (!deliveryWithDetails.companyDetails) {
          deliveryWithDetails.companyDetails = {
            companyId: company._id,
            name: company.name,
            logo: company.logo,
            contactPhone: company.contactPhone || "",
            address: company.address || "",
            email: company.email || "",
            rating: company.rating || 0,
          };
        }
        
        const statusDisplay = {
          "created": "Created",
          "assigned": "Assigned",
          "picked_up": "Picked Up",
          "delivered": "Delivered",
          "cancelled": "Cancelled",
          "failed": "Failed"
        };
        
        deliveryWithDetails.statusDisplay = statusDisplay[deliveryWithDetails.status] || deliveryWithDetails.status;
        
        return deliveryWithDetails;
      })
    );

    res.status(200).json({
      success: true,
      message: `Found ${formattedDeliveries.length} deliveries for ${company.name}`,
      data: formattedDeliveries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company deliveries error:", error);
    
    const errorInfo = {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      companyId: req.user?.companyId,
      userRole: req.user?.role
    };
    
    res.status(500).json({
      success: false,
      message: "Failed to get company deliveries",
      error: process.env.NODE_ENV === "development" ? errorInfo : undefined,
    });
  }
};

export const calculateDeliveryFare = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can calculate delivery fares",
      });
    }

    const {
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      itemType,
      itemWeight,
    } = req.body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff coordinates are required",
      });
    }

    const pickup = {
      lat: parseFloat(pickupLat),
      lng: parseFloat(pickupLng),
    };
    const dropoff = {
      lat: parseFloat(dropoffLat),
      lng: parseFloat(dropoffLng),
    };

    if (
      isNaN(pickup.lat) ||
      isNaN(pickup.lng) ||
      isNaN(dropoff.lat) ||
      isNaN(dropoff.lng)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates provided",
      });
    }

    if (
      pickup.lat < -90 ||
      pickup.lat > 90 ||
      pickup.lng < -180 ||
      pickup.lng > 180 ||
      dropoff.lat < -90 ||
      dropoff.lat > 90 ||
      dropoff.lng < -180 ||
      dropoff.lng > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Coordinates out of valid range",
      });
    }

    console.log(`📍 Resolving addresses for coordinates...`);

    const [pickupAddress, dropoffAddress] = await Promise.all([
      smartReverseGeocode(pickup.lat, pickup.lng),
      smartReverseGeocode(dropoff.lat, dropoff.lng),
    ]);

    console.log(`📍 Pickup: ${pickupAddress.formattedAddress}`);
    console.log(`📍 Dropoff: ${dropoffAddress.formattedAddress}`);

    const distance = calculateDistance(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng
    );

    console.log(`📏 Distance calculated: ${distance.toFixed(2)} km`);

    if (distance < 0.1) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff locations are too close (minimum 100m)",
      });
    }

    if (distance > 100) {
      return res.status(400).json({
        success: false,
        message: "Delivery distance exceeds maximum limit (100km)",
      });
    }

    const fareDetails = calculateFare({
      distance,
      itemWeight: parseFloat(itemWeight) || 1,
      itemType: itemType || "parcel",
    });

    const estimatedDurationMin = Math.ceil(distance * 3);

    let nearbyDriversCount = 0;
    let nearbyDriversInfo = [];
    try {
      const nearbyDrivers = await Driver.find({
        isOnline: true,
        isActive: true,
        isAvailable: true,
        approvalStatus: "approved",
        currentDeliveryId: { $exists: false },
        $or: [
          { "location.coordinates": { $exists: true, $ne: [0, 0] } },
          { "currentLocation.lat": { $exists: true } },
        ],
      })
        .select("currentLocation location vehicleType")
        .populate("userId", "name rating")
        .lean();

      nearbyDriversInfo = nearbyDrivers
        .map((driver) => {
          let driverLat, driverLng;

          if (
            driver.location?.coordinates &&
            driver.location.coordinates.length >= 2
          ) {
            driverLng = driver.location.coordinates[0];
            driverLat = driver.location.coordinates[1];
          } else if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
            driverLat = driver.currentLocation.lat;
            driverLng = driver.currentLocation.lng;
          } else {
            return null;
          }

          const distanceToPickup = calculateDistance(
            pickup.lat,
            pickup.lng,
            driverLat,
            driverLng
          );

          if (distanceToPickup <= 10) {
            return {
              _id: driver._id,
              distance: parseFloat(distanceToPickup.toFixed(2)),
              vehicleType: driver.vehicleType,
              rating: driver.userId?.rating || 0,
            };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);

      nearbyDriversCount = nearbyDriversInfo.length;
    } catch (error) {
      console.error("Error finding nearby drivers:", error);
    }

    const quoteId = `QUOTE-${Date.now()}-${crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;

    const response = {
      success: true,
      message: "Fare calculated successfully",
      data: {
        quoteId,
        fare: {
          baseFare: fareDetails.baseFare,
          distanceFare: fareDetails.distanceFare,
          itemWeightCharge: fareDetails.itemWeightCharge || 0,
          itemTypeCharge: fareDetails.itemTypeCharge || 0,
          subtotal: fareDetails.subtotal || fareDetails.totalFare,
          tax: fareDetails.tax || 0,
          totalFare: fareDetails.totalFare,
          currency: "NGN",
          formatted: `₦${fareDetails.totalFare.toLocaleString()}`,
        },
        distance: {
          km: parseFloat(distance.toFixed(2)),
          formatted: `${distance.toFixed(1)} km`,
        },
        estimatedDuration: {
          minutes: estimatedDurationMin,
          formatted: `${estimatedDurationMin} min`,
        },
        pickup: {
          lat: pickup.lat,
          lng: pickup.lng,
          address: pickupAddress.formattedAddress,
          addressComponents: pickupAddress.addressComponents,
          city: pickupAddress.addressComponents?.city || "",
          state: pickupAddress.addressComponents?.state || "",
        },
        dropoff: {
          lat: dropoff.lat,
          lng: dropoff.lng,
          address: dropoffAddress.formattedAddress,
          addressComponents: dropoffAddress.addressComponents,
          city: dropoffAddress.addressComponents?.city || "",
          state: dropoffAddress.addressComponents?.state || "",
        },
        itemDetails: {
          type: itemType || "parcel",
          weight: parseFloat(itemWeight) || 1,
        },
        availability: {
          nearbyDriversCount,
          estimatedPickupTime: nearbyDriversCount > 0 ? "5-15 min" : "15-30 min",
          hasDrivers: nearbyDriversCount > 0,
          driversInfo: nearbyDriversInfo.map(d => ({
            distance: `${d.distance.toFixed(1)} km away`,
            vehicleType: d.vehicleType,
            rating: d.rating,
          })),
        },
        fareBreakdown: [
          {
            label: "Base Fare",
            amount: fareDetails.baseFare,
            formatted: `₦${fareDetails.baseFare.toLocaleString()}`,
          },
          {
            label: "Distance Charge",
            amount: fareDetails.distanceFare,
            formatted: `₦${fareDetails.distanceFare.toLocaleString()}`,
            details: `${distance.toFixed(1)} km`,
          },
        ],
        recommendations: {
          canProceed: nearbyDriversCount > 0 && distance >= 0.1 && distance <= 100,
          message: nearbyDriversCount > 0 
            ? "Great! Drivers are available in your area."
            : "Limited drivers available. Your request may take longer to be accepted.",
        },
        nextSteps: [
          "Review the pickup and dropoff addresses",
          "Confirm fare and delivery details",
          "Provide recipient information",
          "Create delivery request",
        ],
      },
    };

    console.log(`💰 Fare calculated for customer ${customer._id}:`, {
      quoteId,
      distance: distance.toFixed(2),
      fare: fareDetails.totalFare,
      nearbyDrivers: nearbyDriversCount,
    });

    res.status(200).json(response);
  } catch (error) {
    console.error("❌ Calculate fare error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to calculate delivery fare",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const createDeliveryRequest = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can create deliveries",
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupName,
      pickupPhone,
      dropoffAddress,
      dropoffLat,
      dropoffLng,
      recipientName,
      recipientPhone,
      itemType,
      itemDescription,
      itemWeight,
      paymentMethod,
      quoteId,
      expectedFare,
    } = req.body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff coordinates are required",
      });
    }

    if (!recipientName || !recipientPhone) {
      return res.status(400).json({
        success: false,
        message: "Recipient name and phone are required",
      });
    }

    const pickup = {
      lat: parseFloat(pickupLat),
      lng: parseFloat(pickupLng),
    };
    const dropoff = {
      lat: parseFloat(dropoffLat),
      lng: parseFloat(dropoffLng),
    };

    let resolvedPickupAddress = pickupAddress;
    let resolvedDropoffAddress = dropoffAddress;

    if (!pickupAddress || !dropoffAddress) {
      console.log(`📍 Auto-resolving addresses...`);
      
      const [pickupGeo, dropoffGeo] = await Promise.all([
        !pickupAddress ? smartReverseGeocode(pickup.lat, pickup.lng) : null,
        !dropoffAddress ? smartReverseGeocode(dropoff.lat, dropoff.lng) : null,
      ]);

      if (pickupGeo) {
        resolvedPickupAddress = pickupGeo.formattedAddress;
        console.log(`📍 Auto-resolved pickup: ${resolvedPickupAddress}`);
      }
      
      if (dropoffGeo) {
        resolvedDropoffAddress = dropoffGeo.formattedAddress;
        console.log(`📍 Auto-resolved dropoff: ${resolvedDropoffAddress}`);
      }
    }

    const distance = calculateDistance(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng
    );

    if (distance < 0.1) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff locations are too close (minimum 100m)",
      });
    }

    if (distance > 100) {
      return res.status(400).json({
        success: false,
        message: "Delivery distance exceeds maximum limit (100km)",
      });
    }

    const fareDetails = calculateFare({
      distance,
      itemWeight: parseFloat(itemWeight) || 1,
      itemType: itemType || "parcel",
    });

    if (expectedFare && Math.abs(fareDetails.totalFare - expectedFare) > 50) {
      console.warn(`⚠️ Fare mismatch - Expected: ${expectedFare}, Actual: ${fareDetails.totalFare}`);
      return res.status(400).json({
        success: false,
        message: "Fare has changed. Please recalculate and try again.",
        data: {
          previousFare: expectedFare,
          currentFare: fareDetails.totalFare,
          difference: fareDetails.totalFare - expectedFare,
        },
      });
    }

    const referenceId = `RID-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;

    const deliveryData = {
      referenceId,
      customerId: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,
      companyId: null,

      pickup: {
        address: resolvedPickupAddress || `${pickup.lat}, ${pickup.lng}`,
        lat: pickup.lat,
        lng: pickup.lng,
        name: pickupName || "Pickup Location",
        phone: pickupPhone || customer.phone,
      },

      dropoff: {
        address: resolvedDropoffAddress || `${dropoff.lat}, ${dropoff.lng}`,
        lat: dropoff.lat,
        lng: dropoff.lng,
        name: recipientName,
        phone: recipientPhone,
      },

      recipientName: recipientName,
      recipientPhone: recipientPhone,

      itemDetails: {
        type: itemType || "parcel",
        description: itemDescription,
        weight: parseFloat(itemWeight) || 1,
      },

      fare: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.distanceFare,
        totalFare: fareDetails.totalFare,
        currency: "NGN",
        quoteId: quoteId || null,
      },

      estimatedDistanceKm: distance,
      estimatedDurationMin: Math.ceil(distance * 3),

      payment: {
        method: paymentMethod || "cash",
        status: paymentMethod === "cash" ? "pending" : "pending_payment",
      },

      status: "created",
    };

    const delivery = new Delivery(deliveryData);
    await delivery.save();

    console.log(`✅ Delivery created: ${delivery._id} (${delivery.referenceId})`);
    console.log(`📍 Pickup: ${resolvedPickupAddress}`);
    console.log(`📍 Dropoff: ${resolvedDropoffAddress}`);

    await sendNotification({
      userId: customer._id,
      ...NotificationTemplates.DELIVERY_CREATED(
        delivery._id,
        delivery.referenceId
      ),
    });

    const nearbyDrivers = await Driver.find({
      isOnline: true,
      isActive: true,
      approvalStatus: "approved",
      currentDeliveryId: { $exists: false },
      $or: [
        { "location.coordinates": { $exists: true, $ne: [0, 0] } },
        { "currentLocation.lat": { $exists: true } },
      ],
    }).populate("userId", "name phone avatarUrl");

    const driversNearPickup = nearbyDrivers.filter((driver) => {
      let driverLat, driverLng;

      if (
        driver.location &&
        driver.location.coordinates &&
        driver.location.coordinates.length >= 2
      ) {
        driverLng = driver.location.coordinates[0];
        driverLat = driver.location.coordinates[1];
      } else if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        driverLat = driver.currentLocation.lat;
        driverLng = driver.currentLocation.lng;
      } else if (driver.lat && driver.lng) {
        driverLat = driver.lat;
        driverLng = driver.lng;
      } else {
        return false;
      }

      const distanceToPickup = calculateDistance(
        pickup.lat,
        pickup.lng,
        driverLat,
        driverLng
      );
      return distanceToPickup <= 10;
    });

    console.log(`🚗 Notifying ${driversNearPickup.length} nearby drivers`);

    for (const driver of driversNearPickup) {
      let driverLat, driverLng;
      
      if (
        driver.location &&
        driver.location.coordinates &&
        driver.location.coordinates.length >= 2
      ) {
        driverLng = driver.location.coordinates[0];
        driverLat = driver.location.coordinates[1];
      } else if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        driverLat = driver.currentLocation.lat;
        driverLng = driver.currentLocation.lng;
      } else if (driver.lat && driver.lng) {
        driverLat = driver.lat;
        driverLng = driver.lng;
      }

      const distanceToPickup = calculateDistance(
        pickup.lat,
        pickup.lng,
        driverLat,
        driverLng
      );

      const template = NotificationTemplates.NEW_DELIVERY_REQUEST(
        delivery._id,
        distanceToPickup,
        delivery.fare.totalFare
      );
      
      await sendNotification({
        userId: driver.userId._id,
        ...template,
      });
    }

    res.status(201).json({
      success: true,
      message: "Delivery request created successfully",
      data: {
        delivery: {
          _id: delivery._id,
          referenceId: delivery.referenceId,
          status: delivery.status,
          pickup: delivery.pickup,
          dropoff: delivery.dropoff,
          recipientName: delivery.recipientName,
          fare: delivery.fare,
          estimatedDistanceKm: delivery.estimatedDistanceKm,
          estimatedDurationMin: delivery.estimatedDurationMin,
          createdAt: delivery.createdAt,
          nearbyDriversCount: driversNearPickup.length,
        },
        message: driversNearPickup.length > 0
          ? `${driversNearPickup.length} nearby driver${driversNearPickup.length !== 1 ? 's' : ''} notified!`
          : "Request created. Searching for available drivers...",
      },
    });
  } catch (error) {
    console.error("❌ Create delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create delivery request",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * ✅ FIXED: Get customer's active delivery with complete driver and company details
 */
export const getCustomerActiveDelivery = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const delivery = await Delivery.findOne({
      customerId: customer._id,
      status: { $in: ["created", "assigned", "picked_up", "in_transit"] }
    })
      .populate("customerId", "name phone")
      .lean();

    if (!delivery) {
      return res.status(200).json({
        success: true,
        message: "No active delivery",
        data: null,
      });
    }

    console.log('📦 Active Delivery ID:', delivery._id);
    console.log('📊 Status:', delivery.status);
    console.log('🚗 Driver ID:', delivery.driverId);

    // ✅ Populate complete driver and company details
    const deliveryWithDetails = await populateDriverAndCompanyDetails(delivery);

    let driverLocation = null;
    let etaMinutes = null;

    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId)
        .select("currentLocation location")
        .lean();

      if (driver) {
        if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
          driverLocation = {
            lat: driver.currentLocation.lat,
            lng: driver.currentLocation.lng,
            updatedAt: driver.currentLocation.updatedAt,
          };
        } else if (driver.location?.coordinates && driver.location.coordinates.length >= 2) {
          driverLocation = {
            lat: driver.location.coordinates[1],
            lng: driver.location.coordinates[0],
            updatedAt: new Date(),
          };
        }

        if (driverLocation) {
          if (delivery.status === "picked_up" || delivery.status === "in_transit") {
            const distance = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              delivery.dropoff.lat,
              delivery.dropoff.lng
            );
            etaMinutes = Math.ceil(distance * 3);
          } else if (delivery.status === "assigned") {
            const distance = calculateDistance(
              driverLocation.lat,
              driverLocation.lng,
              delivery.pickup.lat,
              delivery.pickup.lng
            );
            etaMinutes = Math.ceil(distance * 3);
          }
        }
      }
    }

    // Add driver location to driverDetails if it exists
    if (deliveryWithDetails.driverDetails && driverLocation) {
      deliveryWithDetails.driverDetails.currentLocation = driverLocation;
    }

    const timeline = [];
    if (delivery.createdAt)
      timeline.push({ event: "created", time: delivery.createdAt, description: "Order created", icon: "📝" });
    if (delivery.assignedAt)
      timeline.push({ event: "assigned", time: delivery.assignedAt, description: "Driver assigned", icon: "🚗" });
    if (delivery.pickedUpAt)
      timeline.push({ event: "picked_up", time: delivery.pickedUpAt, description: "Package picked up", icon: "📦" });

    let currentStep = "awaiting_driver";
    let nextStep = "";

    switch (delivery.status) {
      case "created":
        currentStep = "searching_driver";
        nextStep = "Searching for available drivers...";
        break;
      case "assigned":
        currentStep = "driver_assigned";
        nextStep = "Driver heading to pickup location";
        break;
      case "picked_up":
        currentStep = "package_picked_up";
        nextStep = "Driver heading to dropoff location";
        break;
      case "in_transit":
        currentStep = "in_transit";
        nextStep = "Driver on the way";
        break;
    }

    const response = {
      success: true,
      data: {
        _id: deliveryWithDetails._id,
        referenceId: deliveryWithDetails.referenceId,
        status: deliveryWithDetails.status,
        currentStep,
        nextStep,
        
        customer: delivery.customerId ? {
          name: delivery.customerId.name,
          phone: delivery.customerId.phone,
          _id: delivery.customerId._id
        } : {
          name: customer.name,
          phone: customer.phone,
          _id: customer._id
        },
        
        // ✅ Complete company details
        company: deliveryWithDetails.companyDetails,
        
        pickup: deliveryWithDetails.pickup,
        dropoff: deliveryWithDetails.dropoff,
        recipientName: deliveryWithDetails.recipientName,
        recipientPhone: deliveryWithDetails.recipientPhone,
        
        // ✅ Complete driver details with current location
        driver: deliveryWithDetails.driverDetails,
        driverDetails: deliveryWithDetails.driverDetails, // Alias for compatibility
        
        itemDetails: deliveryWithDetails.itemDetails,
        fare: deliveryWithDetails.fare,
        etaMinutes,
        estimatedDistanceKm: deliveryWithDetails.estimatedDistanceKm,
        estimatedDurationMin: deliveryWithDetails.estimatedDurationMin,
        timeline: timeline.sort((a, b) => new Date(a.time) - new Date(b.time)),
        progress: {
          step: currentStep,
          percentage: getDeliveryProgressPercentage(delivery.status),
          message: getDeliveryStatusMessage(delivery.status),
        },
        canTrack: ["assigned", "picked_up", "in_transit"].includes(delivery.status),
        tracking: deliveryWithDetails.tracking || null,
        payment: deliveryWithDetails.payment || { method: "cash", status: "pending" },
        createdAt: deliveryWithDetails.createdAt,
        updatedAt: deliveryWithDetails.updatedAt,
        assignedAt: deliveryWithDetails.assignedAt,
        pickedUpAt: deliveryWithDetails.pickedUpAt,
      },
    };

    console.log('✅ Sending response with complete details');
    console.log('  - Driver details:', deliveryWithDetails.driverDetails ? 'YES' : 'NO');
    console.log('  - Company details:', deliveryWithDetails.companyDetails ? 'YES' : 'NO');
    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ Get customer active delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get active delivery",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getNearbyAvailableDrivers = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Only customers can view nearby drivers",
      });
    }

    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const customerLat = parseFloat(lat);
    const customerLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    console.log(`📍 Searching for drivers near: ${customerLat}, ${customerLng}, Radius: ${searchRadius}km`);

    const drivers = await Driver.find({
      isOnline: true,
      isAvailable: true,
      isActive: true,
      approvalStatus: "approved",
      $or: [
        { currentDeliveryId: { $exists: false } },
        { currentDeliveryId: null }
      ]
    })
      .populate("userId", "name phone avatarUrl rating")
      .populate("companyId", "name logo rating")
      .lean();

    console.log(`🚗 Total available drivers found: ${drivers.length}`);

    const nearbyDrivers = [];
    
    for (const driver of drivers) {
      let driverLat, driverLng, driverLocation = null;

      if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        driverLat = driver.currentLocation.lat;
        driverLng = driver.currentLocation.lng;
        driverLocation = {
          lat: driverLat,
          lng: driverLng,
          updatedAt: driver.currentLocation.updatedAt || new Date(),
        };
        console.log(`✅ Driver ${driver._id} - currentLocation: ${driverLat}, ${driverLng}`);
      } else if (driver.location?.coordinates && driver.location.coordinates.length >= 2) {
        driverLng = driver.location.coordinates[0];
        driverLat = driver.location.coordinates[1];
        driverLocation = {
          lat: driverLat,
          lng: driverLng,
          updatedAt: new Date(),
        };
        console.log(`✅ Driver ${driver._id} - GeoJSON location: ${driverLat}, ${driverLng}`);
      } else {
        console.log(`❌ Driver ${driver._id} - No location data available`);
        continue;
      }

      const distance = calculateDistance(
        customerLat,
        customerLng,
        driverLat,
        driverLng
      );

      console.log(`📏 Driver ${driver._id} distance: ${distance.toFixed(2)} km`);

      if (distance <= searchRadius) {
        const etaMinutes = Math.max(2, Math.ceil(distance * 3));
        
        nearbyDrivers.push({
          _id: driver._id,
          userId: driver.userId?._id,
          driverId: driver._id,
          name: driver.userId?.name || "Driver",
          phone: driver.userId?.phone || "",
          avatarUrl: driver.userId?.avatarUrl,
          rating: driver.userId?.rating || 0,
          company: driver.companyId ? {
            _id: driver.companyId._id,
            name: driver.companyId.name,
            logo: driver.companyId.logo,
            rating: driver.companyId.rating || 0,
          } : null,
          vehicle: {
            type: driver.vehicleType || "bike",
            make: driver.vehicleMake || "",
            model: driver.vehicleModel || "",
            plateNumber: driver.plateNumber || "",
          },
          location: driverLocation,
          distance: parseFloat(distance.toFixed(2)),
          distanceText: distance < 0.1 ? "Nearby" : `${distance.toFixed(1)} km away`,
          etaMinutes,
          etaText: `${etaMinutes} min`,
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          status: "available",
        });
      }
    }

    nearbyDrivers.sort((a, b) => a.distance - b.distance);

    console.log(`✅ Found ${nearbyDrivers.length} nearby drivers within ${searchRadius}km`);

    res.status(200).json({
      success: true,
      message: nearbyDrivers.length > 0 
        ? `Found ${nearbyDrivers.length} nearby available drivers`
        : "No drivers available in your area at the moment",
      data: {
        drivers: nearbyDrivers,
        customerLocation: { lat: customerLat, lng: customerLng },
        searchRadius,
        count: nearbyDrivers.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("❌ Get nearby available drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to find nearby drivers",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};




/**
 * @desc    Driver confirms cash collection
 * @route   POST /api/deliveries/:deliveryId/confirm-cash
 * @access  Private (Driver)
 */
export const confirmCashCollection = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`💰 Driver ${driverUser._id} confirming cash collection for delivery ${deliveryId}`);

    if (driverUser.role !== 'driver') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Only drivers can confirm cash collection',
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id }).session(session);
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Driver profile not found',
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
        message: 'Delivery not found or not assigned to this driver',
      });
    }

    // Check if it's a cash payment
    if (delivery.payment.method !== 'cash') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'This is not a cash payment delivery',
      });
    }

    // Check if payment is already confirmed
    if (delivery.payment.status === 'paid') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Cash payment already confirmed',
      });
    }

    // Update delivery payment status
    delivery.payment.status = 'paid';
    delivery.payment.paidAt = new Date();

    // Create or update payment record
    let payment = await Payment.findOne({
      deliveryId: delivery._id,
    }).session(session);

    if (!payment) {
      payment = new Payment({
        deliveryId: delivery._id,
        customerId: delivery.customerId,
        driverId: driver._id,
        companyId: delivery.companyId,
        amount: delivery.fare.totalFare,
        currency: 'NGN',
        status: 'successful',
        paymentMethod: 'cash',
        companyAmount: delivery.fare.totalFare, // Full amount to company for now
        platformFee: 0,
        paymentType: 'cash_on_delivery',
        paidAt: new Date(),
        verifiedAt: new Date(),
        metadata: {
          cashCollectedAt: new Date(),
          collectedByDriverId: driver._id,
          requiresSettlement: true,
          isSettledToDriver: false,
        },
      });
    } else {
      payment.status = 'successful';
      payment.paidAt = new Date();
      payment.verifiedAt = new Date();
      payment.metadata = {
        ...payment.metadata,
        cashCollectedAt: new Date(),
        collectedByDriverId: driver._id,
        requiresSettlement: true,
        isSettledToDriver: false,
      };
    }

    // Save both
    await delivery.save({ session });
    await payment.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Notify customer
    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: '✅ Cash Payment Confirmed',
        message: `Driver has confirmed cash payment of ₦${delivery.fare.totalFare.toLocaleString()} for your delivery`,
        data: {
          type: 'cash_payment_confirmed',
          deliveryId: delivery._id,
          amount: delivery.fare.totalFare,
          driverName: driverUser.name,
        },
      });
    }

    // Notify company if exists
    if (delivery.companyId) {
      const company = await Company.findById(delivery.companyId);
      if (company) {
        const companyUser = await User.findOne({
          $or: [
            { _id: company.ownerId },
            { email: company.email }
          ]
        });

        if (companyUser) {
          await sendNotification({
            userId: companyUser._id,
            title: '💰 Cash Payment Collected',
            message: `Driver ${driverUser.name} has collected ₦${delivery.fare.totalFare.toLocaleString()} cash payment for delivery #${delivery.referenceId}`,
            data: {
              type: 'cash_payment_collected',
              deliveryId: delivery._id,
              paymentId: payment._id,
              amount: delivery.fare.totalFare,
              driverId: driver._id,
              driverName: driverUser.name,
            },
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Cash payment confirmed successfully',
      data: {
        delivery: {
          _id: delivery._id,
          referenceId: delivery.referenceId,
          payment: delivery.payment,
        },
        payment: {
          _id: payment._id,
          amount: payment.amount,
          status: payment.status,
          requiresSettlement: true,
          settlementStatus: 'pending',
        },
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    
    console.error('❌ Confirm cash collection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm cash collection',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};