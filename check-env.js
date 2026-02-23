 // ═══════════════════════════════════════════════════════════════════════════
// DELIVERY CANCELLATION WITH REFUND & NEARBY DRIVERS
// ═══════════════════════════════════════════════════════════════════════════
// This file contains:
// 1. Enhanced cancel delivery with automatic refund
// 2. Customer fetch nearby drivers at specific location
// 3. Refund processing via Paystack Refund API
// ═══════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════
// PART 1: Add Refund Function to utils/paystack.js
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initiate a refund via Paystack
 * Correct endpoint: POST /refund
 */
export const initiateRefund = async (refundData) => {
  try {
    console.log('💸 Initiating refund via Paystack');
    console.log('   Transaction:', refundData.transaction);
    console.log('   Amount:', refundData.amount);

    const response = await paystackAxios.post('/refund', {
      transaction: refundData.transaction, // Transaction reference or ID
      amount: refundData.amount ? Math.round(refundData.amount * 100) : undefined, // Optional: partial refund in kobo
      currency: 'NGN',
      customer_note: refundData.customer_note || 'Delivery cancelled - Refund processed',
      merchant_note: refundData.merchant_note || `Refund for delivery ${refundData.deliveryId}`,
    });

    if (response.data.status === true) {
      return {
        success: true,
        message: 'Refund initiated successfully',
        data: {
          refundId: response.data.data.id,
          transaction: response.data.data.transaction,
          amount: response.data.data.amount / 100,
          currency: response.data.data.currency,
          status: response.data.data.status,
          refundedAt: response.data.data.refunded_at,
          expectedAt: response.data.data.expected_at,
        },
      };
    }

    return {
      success: false,
      message: response.data.message || 'Refund initiation failed',
      error: response.data,
    };
  } catch (error) {
    console.error('❌ Paystack refund error:', error.response?.data);
    return {
      success: false,
      message: error.response?.data?.message || 'Refund failed',
      error: error.response?.data || error.message,
    };
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 2: Enhanced Cancel Delivery with Automatic Refund
// ═══════════════════════════════════════════════════════════════════════════
// Add to controllers/delivery.controller.js

import { initiateRefund } from '../utils/paystack.js'; 

/**
 * @desc    Cancel delivery with automatic refund
 * @route   POST /api/deliveries/:deliveryId/cancel
 * @access  Private (Customer, Driver, Admin)
 */
export const cancelDeliveryWithRefund = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required',
      });
    }

    console.log(`🚫 [CANCELLATION] User ${user._id} (${user.role}) cancelling delivery ${deliveryId}`);

    const delivery = await Delivery.findById(deliveryId)
      .populate('customerId', 'name email phone')
      .session(session);

    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Delivery not found',
      });
    }

    // Authorization check
    const isCustomer = user._id.toString() === delivery.customerId._id.toString();
    const isDriver = user.role === 'driver' && delivery.driverId?.toString() === user._id.toString();
    const isAdmin = user.role === 'admin';

    if (!isCustomer && !isDriver && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this delivery',
      });
    }

    // Check if delivery can be cancelled
    if (!['created', 'assigned', 'picked_up'].includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be cancelled from status: ${delivery.status}`,
        currentStatus: delivery.status,
        cancellableStatuses: ['created', 'assigned', 'picked_up'],
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // REFUND LOGIC
    // ═══════════════════════════════════════════════════════════════════
    let refundResult = null;
    let refundInfo = null;

    // Find payment for this delivery
    const payment = await Payment.findOne({
      deliveryId: delivery._id,
      status: 'successful',
    }).session(session);

    const isCashPayment = delivery.payment?.method === 'cash';

    if (payment && !isCashPayment) {
      console.log(`💰 Processing refund for payment: ${payment._id}`);
      console.log(`   Payment method: ${payment.paymentMethod}`);
      console.log(`   Amount: ₦${payment.amount}`);

      // Calculate refund amount based on cancellation stage
      let refundAmount = payment.amount;
      let cancellationFee = 0;

      if (delivery.status === 'picked_up') {
        // If driver already picked up, charge 20% cancellation fee
        cancellationFee = Math.round(payment.amount * 0.2);
        refundAmount = payment.amount - cancellationFee;
        console.log(`⚠️ Picked up - Applying 20% cancellation fee: ₦${cancellationFee}`);
      } else if (delivery.status === 'assigned') {
        // If driver assigned but not picked up, charge 10% cancellation fee
        cancellationFee = Math.round(payment.amount * 0.1);
        refundAmount = payment.amount - cancellationFee;
        console.log(`⚠️ Assigned - Applying 10% cancellation fee: ₦${cancellationFee}`);
      }
      // If 'created' (no driver assigned), full refund

      console.log(`💸 Refund amount: ₦${refundAmount}`);

      // Initiate refund via Paystack
      refundResult = await initiateRefund({
        transaction: payment.paystackReference,
        amount: refundAmount, // Partial or full refund
        deliveryId: delivery._id,
        customer_note: `Your delivery was cancelled. Refund of ₦${refundAmount.toLocaleString()} has been initiated.${cancellationFee > 0 ? ` Cancellation fee: ₦${cancellationFee.toLocaleString()}` : ''}`,
        merchant_note: `Delivery ${delivery.referenceId} cancelled by ${user.role}. Reason: ${reason}`,
      });

      if (refundResult.success) {
        console.log(`✅ Refund initiated successfully`);
        console.log(`   Refund ID: ${refundResult.data.refundId}`);

        // Update payment record
        payment.status = 'refunded';
        payment.metadata = {
          ...payment.metadata,
          refundStatus: 'processing',
          refundId: refundResult.data.refundId,
          refundAmount: refundAmount,
          cancellationFee: cancellationFee,
          refundInitiatedAt: new Date(),
          refundExpectedAt: refundResult.data.expectedAt,
          cancelledBy: user._id,
          cancellationReason: reason,
        };
        payment.markModified('metadata');
        
        payment.auditLog.push({
          action: 'refund_initiated',
          timestamp: new Date(),
          details: {
            refundId: refundResult.data.refundId,
            refundAmount,
            cancellationFee,
            reason,
          },
        });

        await payment.save({ session });

        refundInfo = {
          refunded: true,
          refundAmount,
          cancellationFee,
          refundId: refundResult.data.refundId,
          expectedAt: refundResult.data.expectedAt,
          message: cancellationFee > 0
            ? `Refund of ₦${refundAmount.toLocaleString()} initiated (₦${cancellationFee.toLocaleString()} cancellation fee deducted). Expect refund in 5-10 business days.`
            : `Full refund of ₦${refundAmount.toLocaleString()} initiated. Expect refund in 5-10 business days.`,
        };
      } else {
        console.error(`❌ Refund failed:`, refundResult.message);
        
        // Mark for manual refund
        payment.metadata = {
          ...payment.metadata,
          refundStatus: 'failed',
          refundError: refundResult.message,
          requiresManualRefund: true,
          cancelledBy: user._id,
          cancellationReason: reason,
        };
        payment.markModified('metadata');
        await payment.save({ session });

        refundInfo = {
          refunded: false,
          error: refundResult.message,
          requiresManualProcessing: true,
          message: 'Automatic refund failed. Our support team will process your refund manually within 24 hours.',
          supportContact: process.env.SUPPORT_EMAIL || 'support@riderr.com',
        };
      }
    } else if (isCashPayment) {
      console.log(`💵 Cash payment - No refund needed`);
      refundInfo = {
        refunded: false,
        cashPayment: true,
        message: 'Cash payment - No refund necessary',
      };
    } else {
      console.log(`⚠️ No payment found or payment not successful`);
      refundInfo = {
        refunded: false,
        noPayment: true,
        message: 'No payment to refund',
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    // UPDATE DELIVERY
    // ═══════════════════════════════════════════════════════════════════
    delivery.status = 'cancelled';
    delivery.cancelledAt = new Date();
    delivery.cancelledBy = {
      userId: user._id,
      role: user.role,
      reason: reason,
    };

    // Update payment status in delivery
    if (refundInfo?.refunded) {
      delivery.payment.status = 'refunded';
    } else if (delivery.payment.status === 'paid') {
      delivery.payment.status = 'cancelled';
    }

    await delivery.save({ session });

    // ═══════════════════════════════════════════════════════════════════
    // UPDATE DRIVER
    // ═══════════════════════════════════════════════════════════════════
    if (delivery.driverId) {
      const driver = await Driver.findById(delivery.driverId).session(session);
      if (driver) {
        driver.currentDeliveryId = null;
        driver.isAvailable = true;
        await driver.save({ session });

        const driverUser = await User.findById(driver.userId);
        if (driverUser) {
          await sendNotification({
            userId: driverUser._id,
            title: '🚫 Delivery Cancelled',
            message: `Delivery #${delivery.referenceId} has been cancelled by ${user.role === 'customer' ? 'customer' : 'admin'}. Reason: ${reason}`,
            data: {
              type: 'delivery_cancelled',
              deliveryId: delivery._id,
              reason: reason,
              cancelledBy: user.role,
            },
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // NOTIFY CUSTOMER
    // ═══════════════════════════════════════════════════════════════════
    if (user.role !== 'customer') {
      await sendNotification({
        userId: delivery.customerId._id,
        title: '🚫 Delivery Cancelled',
        message: refundInfo?.refunded
          ? `Your delivery has been cancelled. ${refundInfo.message}`
          : `Your delivery has been cancelled. Reason: ${reason}`,
        data: {
          type: 'delivery_cancelled',
          deliveryId: delivery._id,
          reason: reason,
          refundInfo: refundInfo,
        },
      });
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Delivery cancelled successfully`);

    res.status(200).json({
      success: true,
      message: 'Delivery cancelled successfully',
      data: {
        delivery: {
          _id: delivery._id,
          referenceId: delivery.referenceId,
          status: delivery.status,
          cancelledAt: delivery.cancelledAt,
          cancelledBy: delivery.cancelledBy,
        },
        refund: refundInfo,
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    
    console.error('❌ Cancel delivery with refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel delivery',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 3: Fetch Nearby Drivers for Customer at Specific Location
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @desc    Get nearby drivers for customer at specific pickup location
 * @route   GET /api/deliveries/nearby-drivers?lat=X&lng=Y&radius=Z
 * @access  Private (Customer)
 */
export const getCustomerNearbyDrivers = async (req, res) => {
  try {
    const customer = req.user;

    if (customer.role !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Only customers can view nearby drivers',
      });
    }

    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Pickup location (lat, lng) is required',
        example: {
          url: '/api/deliveries/nearby-drivers?lat=6.5244&lng=3.3792&radius=10',
          description: 'Get drivers within 10km of pickup location',
        },
      });
    }

    const pickupLat = parseFloat(lat);
    const pickupLng = parseFloat(lng);
    const searchRadius = parseFloat(radius);

    if (isNaN(pickupLat) || isNaN(pickupLng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided',
      });
    }

    console.log(`📍 Customer ${customer._id} searching for drivers near pickup: ${pickupLat}, ${pickupLng}`);
    console.log(`🔍 Search radius: ${searchRadius} km`);

    // Find all available drivers
    const drivers = await Driver.find({
      isOnline: true,
      isAvailable: true,
      isActive: true,
      approvalStatus: 'approved',
      $or: [
        { currentDeliveryId: { $exists: false } },
        { currentDeliveryId: null }
      ],
      $or: [
        { 'location.coordinates': { $exists: true, $ne: [0, 0] } },
        { 'currentLocation.lat': { $exists: true } },
      ],
    })
      .populate('userId', 'name phone avatarUrl rating')
      .populate('companyId', 'name logo rating contactPhone')
      .lean();

    console.log(`🚗 Total available drivers: ${drivers.length}`);

    const nearbyDrivers = [];

    for (const driver of drivers) {
      let driverLat, driverLng;

      // Get driver location
      if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
        driverLat = driver.currentLocation.lat;
        driverLng = driver.currentLocation.lng;
      } else if (driver.location?.coordinates && driver.location.coordinates.length >= 2) {
        driverLng = driver.location.coordinates[0];
        driverLat = driver.location.coordinates[1];
      } else {
        console.log(`⏭️ Driver ${driver._id} - No location data`);
        continue;
      }

      // Calculate distance from pickup location
      const distanceToPickup = calculateDistance(
        pickupLat,
        pickupLng,
        driverLat,
        driverLng
      );

      console.log(`📏 Driver ${driver._id} - Distance to pickup: ${distanceToPickup.toFixed(2)} km`);

      // Only include drivers within search radius
      if (distanceToPickup <= searchRadius) {
        const etaMinutes = Math.max(2, Math.ceil(distanceToPickup * 3));

        nearbyDrivers.push({
          _id: driver._id,
          driverId: driver._id,
          name: driver.userId?.name || 'Driver',
          phone: driver.userId?.phone || '',
          avatarUrl: driver.userId?.avatarUrl,
          rating: driver.userId?.rating || 0,
          totalRatings: driver.totalRatings || 0,
          
          company: driver.companyId ? {
            _id: driver.companyId._id,
            name: driver.companyId.name,
            logo: driver.companyId.logo,
            rating: driver.companyId.rating || 0,
            contactPhone: driver.companyId.contactPhone || '',
          } : null,
          
          vehicle: {
            type: driver.vehicleType || 'bike',
            make: driver.vehicleMake || '',
            model: driver.vehicleModel || '',
            plateNumber: driver.plateNumber || '',
            color: driver.vehicleColor || '',
          },
          
          currentLocation: {
            lat: driverLat,
            lng: driverLng,
            updatedAt: driver.currentLocation?.updatedAt || new Date(),
          },
          
          distanceFromPickup: parseFloat(distanceToPickup.toFixed(2)),
          distanceText: distanceToPickup < 0.1 ? 'Very close' : `${distanceToPickup.toFixed(1)} km away`,
          
          eta: {
            minutes: etaMinutes,
            text: etaMinutes < 5 ? 'Arriving soon' : `${etaMinutes} min`,
            formatted: `Approximately ${etaMinutes} minutes to pickup`,
          },
          
          availability: {
            isOnline: driver.isOnline,
            isAvailable: driver.isAvailable,
            status: 'available',
            canAcceptDelivery: true,
          },
          
          stats: {
            totalDeliveries: driver.totalDeliveries || 0,
            acceptanceRate: driver.totalRequests
              ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
              : 0,
          },
        });
      }
    }

    // Sort by distance (closest first)
    nearbyDrivers.sort((a, b) => a.distanceFromPickup - b.distanceFromPickup);

    console.log(`✅ Found ${nearbyDrivers.length} nearby drivers within ${searchRadius}km`);

    // Group drivers by distance ranges for better UX
    const groupedDrivers = {
      veryClose: nearbyDrivers.filter(d => d.distanceFromPickup < 1), // < 1km
      close: nearbyDrivers.filter(d => d.distanceFromPickup >= 1 && d.distanceFromPickup < 3), // 1-3km
      nearby: nearbyDrivers.filter(d => d.distanceFromPickup >= 3 && d.distanceFromPickup < 5), // 3-5km
      farther: nearbyDrivers.filter(d => d.distanceFromPickup >= 5), // > 5km
    };

    const response = {
      success: true,
      message: nearbyDrivers.length > 0
        ? `Found ${nearbyDrivers.length} available driver${nearbyDrivers.length !== 1 ? 's' : ''} near your pickup location`
        : 'No drivers currently available in your area',
      data: {
        pickupLocation: {
          lat: pickupLat,
          lng: pickupLng,
        },
        searchRadius: {
          km: searchRadius,
          formatted: `${searchRadius} km`,
        },
        drivers: nearbyDrivers,
        grouped: {
          veryClose: {
            count: groupedDrivers.veryClose.length,
            drivers: groupedDrivers.veryClose,
            label: 'Very Close (< 1km)',
          },
          close: {
            count: groupedDrivers.close.length,
            drivers: groupedDrivers.close,
            label: 'Close (1-3km)',
          },
          nearby: {
            count: groupedDrivers.nearby.length,
            drivers: groupedDrivers.nearby,
            label: 'Nearby (3-5km)',
          },
          farther: {
            count: groupedDrivers.farther.length,
            drivers: groupedDrivers.farther,
            label: 'Farther (5km+)',
          },
        },
        summary: {
          total: nearbyDrivers.length,
          closestDriver: nearbyDrivers[0] || null,
          averageDistance: nearbyDrivers.length > 0
            ? parseFloat((nearbyDrivers.reduce((sum, d) => sum + d.distanceFromPickup, 0) / nearbyDrivers.length).toFixed(2))
            : 0,
          averageETA: nearbyDrivers.length > 0
            ? Math.round(nearbyDrivers.reduce((sum, d) => sum + d.eta.minutes, 0) / nearbyDrivers.length)
            : 0,
        },
        availability: {
          hasDrivers: nearbyDrivers.length > 0,
          confidence: nearbyDrivers.length >= 3 ? 'high' : nearbyDrivers.length >= 1 ? 'medium' : 'low',
          recommendation: nearbyDrivers.length >= 3
            ? 'Great! Multiple drivers available. Your delivery will be picked up quickly.'
            : nearbyDrivers.length >= 1
            ? 'Good! Drivers are available in your area.'
            : 'Limited availability. Your request may take longer to be accepted.',
        },
        timestamp: new Date().toISOString(),
        refreshInterval: 30, // Suggest refresh every 30 seconds
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Get customer nearby drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find nearby drivers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 4: Update Routes in delivery.routes.js
// ═══════════════════════════════════════════════════════════════════════════

// Add these new routes to your delivery.routes.js:

import {
  cancelDeliveryWithRefund,
  getCustomerNearbyDrivers,
} from '../controllers/delivery.controller.js';

// Replace the old cancel route with new one
router.post('/:deliveryId/cancel', authenticate, cancelDeliveryWithRefund);

// Add new nearby drivers route for customers
router.get('/nearby-drivers', authenticate, getCustomerNearbyDrivers);


// ═══════════════════════════════════════════════════════════════════════════
// PART 5: Export the refund function from paystack.js
// ═══════════════════════════════════════════════════════════════════════════

// Add to your exports in utils/paystack.js:
export default {
  initializePayment,
  verifyPayment,
  chargeCardViaPaystack,
  submitOtpToPaystack,
  submitPinToPaystack,
  createDedicatedVirtualAccount,
  createSubaccount,
  updateSubaccount,
  getBankList,
  resolveAccountNumber,
  getPublicKey,
  isProduction,
  isUsingLiveKeys,
  initiateTransfer,
  createTransferRecipient,
  initiateRefund, // ← Add this
};


// ═══════════════════════════════════════════════════════════════════════════
// TESTING GUIDE
// ═══════════════════════════════════════════════════════════════════════════

/*
TEST 1: Get Nearby Drivers at Pickup Location
──────────────────────────────────────────────
GET /api/deliveries/nearby-drivers?lat=6.5244&lng=3.3792&radius=10

Headers:
{
  "Authorization": "Bearer <CUSTOMER_TOKEN>"
}

Expected Response:
{
  "success": true,
  "message": "Found 5 available drivers near your pickup location",
  "data": {
    "pickupLocation": { "lat": 6.5244, "lng": 3.3792 },
    "searchRadius": { "km": 10, "formatted": "10 km" },
    "drivers": [
      {
        "driverId": "...",
        "name": "John Driver",
        "rating": 4.8,
        "vehicle": { "type": "bike", "make": "Honda", "model": "CG125" },
        "distanceFromPickup": 0.8,
        "distanceText": "0.8 km away",
        "eta": {
          "minutes": 3,
          "text": "Arriving soon",
          "formatted": "Approximately 3 minutes to pickup"
        },
        "company": { "name": "Express Logistics", "rating": 4.9 }
      }
    ],
    "grouped": {
      "veryClose": { "count": 2, "label": "Very Close (< 1km)" },
      "close": { "count": 3, "label": "Close (1-3km)" }
    },
    "summary": {
      "total": 5,
      "closestDriver": {...},
      "averageDistance": 2.4,
      "averageETA": 7
    }
  }
}


TEST 2: Cancel Delivery with Refund (No Driver Assigned)
────────────────────────────────────────────────────────
POST /api/deliveries/:deliveryId/cancel

Headers:
{
  "Authorization": "Bearer <CUSTOMER_TOKEN>",
  "Content-Type": "application/json"
}

Body:
{
  "reason": "Changed my mind"
}

Expected Response (Full Refund):
{
  "success": true,
  "message": "Delivery cancelled successfully",
  "data": {
    "delivery": {
      "_id": "...",
      "status": "cancelled",
      "cancelledAt": "2026-02-19T..."
    },
    "refund": {
      "refunded": true,
      "refundAmount": 460,
      "cancellationFee": 0,
      "refundId": "RFD_...",
      "expectedAt": "2026-02-26T...",
      "message": "Full refund of ₦460 initiated. Expect refund in 5-10 business days."
    }
  }
}


TEST 3: Cancel After Driver Assigned (10% Fee)
──────────────────────────────────────────────
POST /api/deliveries/:deliveryId/cancel

Body:
{
  "reason": "Emergency came up"
}

Expected Response (Partial Refund):
{
  "success": true,
  "message": "Delivery cancelled successfully",
  "data": {
    "delivery": { "status": "cancelled" },
    "refund": {
      "refunded": true,
      "refundAmount": 414,
      "cancellationFee": 46,
      "message": "Refund of ₦414 initiated (₦46 cancellation fee deducted)"
    }
  }
}


TEST 4: Cancel After Pickup (20% Fee)
─────────────────────────────────────
POST /api/deliveries/:deliveryId/cancel

Expected Response:
{
  "refund": {
    "refunded": true,
    "refundAmount": 368,
    "cancellationFee": 92,
    "message": "Refund of ₦368 initiated (₦92 cancellation fee deducted)"
  }
}


TEST 5: Cancel Cash Delivery
────────────────────────────
POST /api/deliveries/:deliveryId/cancel

Expected Response:
{
  "refund": {
    "refunded": false,
    "cashPayment": true,
    "message": "Cash payment - No refund necessary"
  }
}
*/


// ═══════════════════════════════════════════════════════════════════════════
// REFUND POLICY SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

/*
CANCELLATION FEES:

1. Before Driver Assignment (status: "created")
   - Cancellation Fee: 0%
   - Refund: 100% (Full refund)
   - Example: ₦460 paid → ₦460 refunded

2. After Driver Assigned (status: "assigned")
   - Cancellation Fee: 10%
   - Refund: 90%
   - Example: ₦460 paid → ₦414 refunded (₦46 fee)

3. After Pickup (status: "picked_up")
   - Cancellation Fee: 20%
   - Refund: 80%
   - Example: ₦460 paid → ₦368 refunded (₦92 fee)

4. After Delivery (status: "delivered")
   - Cannot cancel
   - No refund

5. Cash Payments
   - No refund processing needed
   - Cancel anytime before delivery


REFUND TIMELINE:
- Initiated: Immediately upon cancellation
- Processing: Paystack processes refund
- Expected: 5-10 business days to customer's account
- Method: Same payment method used for original payment
*/


// ═══════════════════════════════════════════════════════════════════════════
// FRONTEND INTEGRATION GUIDE
// ═══════════════════════════════════════════════════════════════════════════

/*
1. NEARBY DRIVERS MAP VIEW
─────────────────────────────
// When customer selects pickup location, immediately fetch nearby drivers

const fetchNearbyDrivers = async (pickupLat, pickupLng) => {
  const response = await fetch(
    `/api/deliveries/nearby-drivers?lat=${pickupLat}&lng=${pickupLng}&radius=10`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  const data = await response.json();
  
  if (data.success) {
    // Show drivers on map
    data.data.drivers.forEach(driver => {
      addMarkerToMap(driver.currentLocation, driver);
    });
    
    // Show summary
    console.log(`${data.data.summary.total} drivers nearby`);
    console.log(`Closest: ${data.data.summary.closestDriver?.distanceText}`);
  }
};

// Auto-refresh every 30 seconds
setInterval(() => fetchNearbyDrivers(lat, lng), 30000);


2. CANCEL WITH REFUND CONFIRMATION
──────────────────────────────────
const cancelDelivery = async (deliveryId, reason) => {
  // Show warning based on delivery status
  const delivery = await getDeliveryDetails(deliveryId);
  
  let warningMessage = '';
  if (delivery.status === 'picked_up') {
    warningMessage = 'Driver has picked up your package. A 20% cancellation fee will apply.';
  } else if (delivery.status === 'assigned') {
    warningMessage = 'A driver is on the way. A 10% cancellation fee will apply.';
  } else {
    warningMessage = 'Full refund will be processed.';
  }
  
  if (confirm(`Cancel delivery? ${warningMessage}`)) {
    const response = await fetch(`/api/deliveries/${deliveryId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason })
    });
    
    const data = await response.json();
    
    if (data.success && data.data.refund?.refunded) {
      alert(`Delivery cancelled! ${data.data.refund.message}`);
    }
  }
};


3. SHOW NEARBY DRIVERS COUNT BEFORE CREATING DELIVERY
────────────────────────────────────────────────────────
const checkDriverAvailability = async (pickupLat, pickupLng) => {
  const response = await fetch(
    `/api/deliveries/nearby-drivers?lat=${pickupLat}&lng=${pickupLng}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await response.json();
  
  // Show availability indicator
  if (data.data.summary.total >= 5) {
    showMessage('🟢 Great! Many drivers available');
  } else if (data.data.summary.total >= 1) {
    showMessage('🟡 Limited drivers. May take longer');
  } else {
    showMessage('🔴 No drivers nearby. Try different location?');
  }
  
  return data.data.summary.total > 0;
};
*/


// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

/*
✅ FEATURES IMPLEMENTED:

1. AUTOMATIC REFUNDS
   - Full refund if cancelled before driver assignment
   - 10% fee if cancelled after driver assigned
   - 20% fee if cancelled after pickup
   - No refund needed for cash payments
   - Refunds processed via Paystack Refund API
   - 5-10 business days refund timeline

2. NEARBY DRIVERS FOR CUSTOMERS
   - Fetch drivers near pickup location
   - Real-time driver locations
   - Distance calculations
   - ETA estimates
   - Grouped by distance ranges
   - Company information included
   - Driver ratings and stats
   - Auto-refresh capability

3. ENHANCED CANCELLATION
   - Works for customers, drivers, and admins
   - Automatic fee calculation
   - Payment record updates
   - Driver availability updates
   - Push notifications
   - Audit trail in payment logs

4. INTEGRATION READY
   - Complete API endpoints
   - Detailed responses
   - Error handling
   - Frontend examples
   - Testing guide included
*/