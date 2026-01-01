import Delivery from "../models/delivery.models.js";
import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Company from "../models/company.models.js";

// Helper function to calculate distance between two points (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in km
};

// Helper function to calculate fare
const calculateFare = (distanceKm, vehicleType) => {
  const baseFares = {
    bike: 500,
    car: 800,
    van: 1200,
    truck: 1500
  };
  
  const perKmRates = {
    bike: 100,
    car: 150,
    van: 200,
    truck: 250
  };

  const baseFare = baseFares[vehicleType] || baseFares.bike;
  const distanceFare = distanceKm * (perKmRates[vehicleType] || perKmRates.bike);
  const totalFare = baseFare + distanceFare;

  return {
    baseFare,
    distanceFare: Math.round(distanceFare),
    totalFare: Math.round(totalFare),
    currency: 'NGN'
  };
};

// Generate unique reference ID
const generateReferenceId = () => {
  const prefix = 'DEL';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

// ========== CREATE DELIVERY ==========

export const createDelivery = async (req, res) => {
  try {
    const {
      customerId,
      companyId,
      customerName,
      customerPhone,
      recipientName,
      recipientPhone,
      pickup,
      dropoff,
      itemDetails,
      vehicleType = 'bike',
      paymentMethod = 'cash'
    } = req.body;

    // Validate customer
    const customer = await User.findById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Calculate distance and fare
    const distanceKm = calculateDistance(
      pickup.lat,
      pickup.lng,
      dropoff.lat,
      dropoff.lng
    );

    const estimatedDurationMin = Math.round(distanceKm * 3); // Rough estimate: 3 min per km

    const fare = calculateFare(distanceKm, vehicleType);

    // Create delivery
    const delivery = new Delivery({
      referenceId: generateReferenceId(),
      customerId,
      companyId,
      customerName,
      customerPhone,
      recipientName,
      recipientPhone,
      pickup,
      dropoff,
      itemDetails: itemDetails || {
        type: 'parcel',
        description: 'Package',
        weight: 1,
        value: 0
      },
      fare,
      estimatedDistanceKm: Math.round(distanceKm * 10) / 10,
      estimatedDurationMin,
      payment: {
        method: paymentMethod,
        status: 'pending'
      },
      status: 'created'
    });

    await delivery.save();

    // Find nearest available driver
    try {
      const nearestDriver = await findAndAssignDriver(delivery, vehicleType);
      
      if (nearestDriver) {
        delivery.driverId = nearestDriver._id;
        delivery.driverDetails = {
          driverId: nearestDriver._id,
          userId: nearestDriver.userId._id,
          name: nearestDriver.userId.name,
          phone: nearestDriver.userId.phone,
          avatarUrl: nearestDriver.documents.find(d => d.type === 'profile_photo')?.url,
          vehicle: {
            type: nearestDriver.vehicleType,
            make: nearestDriver.vehicleMake,
            model: nearestDriver.vehicleModel,
            plateNumber: nearestDriver.plateNumber
          }
        };
        delivery.status = 'assigned';
        delivery.assignedAt = new Date();
        await delivery.save();

        // Update driver status
        await nearestDriver.assignTrip(delivery._id);

        // TODO: Send push notification to driver
        // await sendDriverNotification(nearestDriver._id, delivery);
      }
    } catch (error) {
      console.error('Error assigning driver:', error);
      // Delivery is still created but not assigned
    }

    res.status(201).json({
      success: true,
      message: delivery.status === 'assigned' 
        ? 'Delivery created and driver assigned' 
        : 'Delivery created. Looking for available drivers...',
      data: delivery
    });
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Helper function to find and assign nearest available driver
const findAndAssignDriver = async (delivery, vehicleType) => {
  try {
    // Find drivers that are:
    // 1. Online and available
    // 2. Verified and approved
    // 3. Not suspended
    // 4. Have no active delivery
    // 5. Match the vehicle type
    // 6. Are near the pickup location

    const availableDrivers = await Driver.find({
      companyId: delivery.companyId,
      isOnline: true,
      isAvailable: true,
      isActive: true,
      isVerified: true,
      approvalStatus: 'approved',
      isSuspended: false,
      currentTripId: null,
      currentStatus: 'online',
      vehicleType: vehicleType,
      'location.coordinates': { $exists: true }
    }).populate('userId', 'name phone');

    if (availableDrivers.length === 0) {
      return null;
    }

    // Calculate distance from each driver to pickup location
    const driversWithDistance = availableDrivers.map(driver => {
      const [driverLng, driverLat] = driver.location.coordinates;
      const distance = calculateDistance(
        driverLat,
        driverLng,
        delivery.pickup.lat,
        delivery.pickup.lng
      );
      return { driver, distance };
    });

    // Sort by distance and get the nearest driver
    driversWithDistance.sort((a, b) => a.distance - b.distance);
    
    return driversWithDistance[0].driver;
  } catch (error) {
    console.error('Find driver error:', error);
    return null;
  }
};

// ========== DRIVER ACTIONS ==========

// Driver accepts delivery
export const acceptDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { driverId } = req.body;

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    if (delivery.status !== 'assigned' && delivery.status !== 'created') {
      return res.status(400).json({ 
        success: false, 
        message: 'Delivery cannot be accepted in current status' 
      });
    }

    const driver = await Driver.findById(driverId).populate('userId', 'name phone');
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    if (!driver.canAcceptRides) {
      return res.status(400).json({ 
        success: false, 
        message: 'Driver cannot accept deliveries at this time' 
      });
    }

    // Update delivery
    delivery.driverId = driver._id;
    delivery.driverDetails = {
      driverId: driver._id,
      userId: driver.userId._id,
      name: driver.userId.name,
      phone: driver.userId.phone,
      avatarUrl: driver.documents.find(d => d.type === 'profile_photo')?.url,
      vehicle: {
        type: driver.vehicleType,
        make: driver.vehicleMake,
        model: driver.vehicleModel,
        plateNumber: driver.plateNumber
      }
    };
    delivery.status = 'assigned';
    delivery.assignedAt = new Date();
    await delivery.save();

    // Update driver status
    await driver.assignTrip(delivery._id);

    // TODO: Send notification to customer
    // await sendCustomerNotification(delivery.customerId, delivery);

    res.status(200).json({
      success: true,
      message: 'Delivery accepted successfully',
      data: delivery
    });
  } catch (error) {
    console.error('Accept delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Driver marks delivery as picked up
export const pickupDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { driverId } = req.body;

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    if (delivery.driverId.toString() !== driverId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: Not assigned to this delivery' 
      });
    }

    if (delivery.status !== 'assigned') {
      return res.status(400).json({ 
        success: false, 
        message: 'Delivery must be in assigned status to pickup' 
      });
    }

    delivery.status = 'picked_up';
    delivery.pickedUpAt = new Date();
    await delivery.save();

    // TODO: Send notification to customer and recipient
    // await sendPickupNotifications(delivery);

    res.status(200).json({
      success: true,
      message: 'Delivery marked as picked up',
      data: delivery
    });
  } catch (error) {
    console.error('Pickup delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Driver completes delivery
export const completeDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { driverId, proofOfDelivery } = req.body;

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    if (delivery.driverId.toString() !== driverId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized: Not assigned to this delivery' 
      });
    }

    if (delivery.status !== 'picked_up') {
      return res.status(400).json({ 
        success: false, 
        message: 'Delivery must be in picked_up status to complete' 
      });
    }

    delivery.status = 'delivered';
    delivery.deliveredAt = new Date();
    if (proofOfDelivery) {
      delivery.proofOfDelivery = proofOfDelivery;
    }

    // Handle payment based on method
    const company = await Company.findById(delivery.companyId);
    const platformFee = delivery.fare.totalFare * 0.10; // 10% platform fee
    const driverEarning = delivery.fare.totalFare - platformFee;

    if (delivery.payment.method === 'cash') {
      // Cash payment - becomes a loan for the company
      delivery.payment.status = 'pending'; // Company owes platform
      if (company) {
        company.outstandingBalance = (company.outstandingBalance || 0) + platformFee;
        await company.save();
      }
    } else if (delivery.payment.method === 'card' || delivery.payment.method === 'transfer') {
      // Digital payment - held in escrow
      delivery.payment.status = 'held_in_escrow';
      delivery.payment.escrowDetails = {
        totalAmount: delivery.fare.totalFare,
        platformFee: platformFee,
        driverEarning: driverEarning,
        releaseDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // Release after 24 hours
      };
    }

    await delivery.save();

    // Update driver statistics
    const driver = await Driver.findById(driverId);
    if (driver) {
      await driver.completeTrip();
      await driver.addEarnings(driverEarning);
    }

    // TODO: Send completion notifications
    // await sendCompletionNotifications(delivery);

    res.status(200).json({
      success: true,
      message: 'Delivery completed successfully',
      data: delivery,
      earnings: {
        totalFare: delivery.fare.totalFare,
        platformFee,
        driverEarning
      }
    });
  } catch (error) {
    console.error('Complete delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel delivery
export const cancelDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { cancelledBy, reason } = req.body; // 'customer' or 'driver'

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    if (['delivered', 'cancelled'].includes(delivery.status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot cancel delivery in current status' 
      });
    }

    const previousStatus = delivery.status;
    delivery.status = 'cancelled';
    delivery.cancelledAt = new Date();
    delivery.cancellationReason = reason;
    delivery.cancelledBy = cancelledBy;
    await delivery.save();

    // Update driver if assigned
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver && previousStatus === 'assigned') {
        await driver.cancelTrip();
      }
    }

    // Handle refund for digital payments
    if (delivery.payment.method !== 'cash' && delivery.payment.status === 'held_in_escrow') {
      delivery.payment.status = 'refunded';
      await delivery.save();
      // TODO: Process actual refund through payment gateway
    }

    res.status(200).json({
      success: true,
      message: 'Delivery cancelled successfully',
      data: delivery
    });
  } catch (error) {
    console.error('Cancel delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== TRACKING & QUERIES ==========

// Track delivery (for customer)
export const trackDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .populate('customerId', 'name phone')
      .populate('driverId');

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    let driverLocation = null;
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver && driver.location) {
        driverLocation = {
          lat: driver.location.coordinates[1],
          lng: driver.location.coordinates[0],
          lastUpdated: driver.location.lastUpdated
        };
      }
    }

    res.status(200).json({
      success: true,
      data: {
        delivery,
        driverLocation,
        timeline: {
          created: delivery.createdAt,
          assigned: delivery.assignedAt,
          pickedUp: delivery.pickedUpAt,
          delivered: delivery.deliveredAt,
          cancelled: delivery.cancelledAt
        }
      }
    });
  } catch (error) {
    console.error('Track delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get delivery by reference ID
export const getDeliveryByReference = async (req, res) => {
  try {
    const { referenceId } = req.params;

    const delivery = await Delivery.findOne({ referenceId })
      .populate('customerId', 'name phone')
      .populate('driverId');

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    res.status(200).json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Get delivery by reference error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get customer deliveries
export const getCustomerDeliveries = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, limit = 50, page = 1 } = req.query;

    const query = { customerId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const deliveries = await Delivery.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate('driverId', 'userId vehicleType plateNumber rating');

    const total = await Delivery.countDocuments(query);

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get customer deliveries error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get active delivery for driver
export const getDriverActiveDelivery = async (req, res) => {
  try {
    const { driverId } = req.params;

    const delivery = await Delivery.findOne({
      driverId,
      status: { $in: ['assigned', 'picked_up'] }
    }).populate('customerId', 'name phone');

    if (!delivery) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active delivery found' 
      });
    }

    res.status(200).json({
      success: true,
      data: delivery
    });
  } catch (error) {
    console.error('Get driver active delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== RATING & REVIEW ==========

// Rate delivery
export const rateDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { rating, review } = req.body;

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ 
        success: false, 
        message: 'Rating must be between 1 and 5' 
      });
    }

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    if (delivery.status !== 'delivered') {
      return res.status(400).json({ 
        success: false, 
        message: 'Can only rate completed deliveries' 
      });
    }

    if (delivery.rating) {
      return res.status(400).json({ 
        success: false, 
        message: 'Delivery already rated' 
      });
    }

    delivery.rating = rating;
    delivery.review = review;
    delivery.ratedAt = new Date();
    await delivery.save();

    // Update driver rating
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        await driver.addRating(rating);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Delivery rated successfully',
      data: delivery
    });
  } catch (error) {
    console.error('Rate delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add tip to delivery
export const addTip = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { amount } = req.body;

    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Delivery not found' });
    }

    if (delivery.status !== 'delivered') {
      return res.status(400).json({ 
        success: false, 
        message: 'Can only tip completed deliveries' 
      });
    }

    delivery.tip = {
      amount,
      addedAt: new Date()
    };
    await delivery.save();

    // Add tip to driver earnings
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId);
      if (driver) {
        await driver.addEarnings(amount);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Tip added successfully',
      data: delivery
    });
  } catch (error) {
    console.error('Add tip error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};