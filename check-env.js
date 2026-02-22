// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION: Driver Accept Before Payment + Cancellation with Refund
// ═══════════════════════════════════════════════════════════════════════════
// This implements:
// 1. Driver can accept delivery BEFORE customer pays
// 2. Driver CANNOT start delivery until payment is confirmed
// 3. Customer/Driver can cancel delivery at any time
// 4. Automatic refund if payment was made
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: UPDATE acceptDelivery - Allow acceptance WITHOUT payment
// ═══════════════════════════════════════════════════════════════════════════

// In delivery.controller.js - REPLACE acceptDelivery function:

export const acceptDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`🚗 [ACCEPT] Driver ${driverUser._id} accepting delivery ${deliveryId}`);

    if (driverUser.role !== "driver") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only drivers can accept deliveries",
      });
    }

    const driver = await Driver.findOne({ userId: driverUser._id })
      .populate('userId', 'name phone avatarUrl rating')
      .populate('companyId', 'name logo contactPhone address email rating paystackSubaccountCode')
      .session(session);
      
    if (!driver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Your driver profile wasn't found",
      });
    }

    // Check driver availability
    if (!driver.isOnline || !driver.isAvailable || driver.currentDeliveryId) {
      await session.abortTransaction();
      session.endSession();
      
      let specificMessage = "You cannot accept new deliveries right now";
      
      if (!driver.isOnline) {
        specificMessage = "You need to be online to accept deliveries";
      } else if (driver.currentDeliveryId) {
        specificMessage = "You already have an active delivery";
      } else if (!driver.isAvailable) {
        specificMessage = "You're currently unavailable";
      }
      
      return res.status(400).json({
        success: false,
        message: specificMessage,
      });
    }

    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery request not found",
      });
    }

    // Check if delivery is available
    if (delivery.status !== "created" || delivery.driverId) {
      await session.abortTransaction();
      session.endSession();
      
      let specificMessage = "This delivery is no longer available";
      
      if (delivery.driverId) {
        specificMessage = "Another driver has already accepted this delivery";
      } else if (delivery.status === 'cancelled') {
        specificMessage = "This delivery has been cancelled";
      } else if (delivery.status !== 'created') {
        specificMessage = "This delivery is no longer available";
      }
      
      return res.status(400).json({
        success: false,
        message: specificMessage,
      });
    }

    // ✅ NEW: Allow acceptance regardless of payment status
    const isCashPayment = delivery.payment?.method === 'cash';
    const isPaid = delivery.payment?.status === 'paid';

    console.log(`💳 Payment Status: ${delivery.payment?.status}, Method: ${delivery.payment?.method}`);
    console.log(`✅ ACCEPTING delivery - Payment can happen later`);

    // Calculate distance to pickup
    let driverToPickupDistance = 5;
    if (driver.currentLocation?.lat && driver.currentLocation?.lng) {
      driverToPickupDistance = calculateDistance(
        driver.currentLocation.lat,
        driver.currentLocation.lng,
        delivery.pickup.lat,
        delivery.pickup.lng
      );
    }

    // Prepare driver details
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

    // Update delivery - mark as assigned
    delivery.driverId = driver._id;
    delivery.companyId = companyDetails?.companyId || null;
    delivery.status = "assigned";
    delivery.assignedAt = new Date();
    delivery.estimatedPickupTime = new Date(Date.now() + driverToPickupDistance * 3 * 60000);
    delivery.driverDetails = driverDetails;
    if (companyDetails) {
      delivery.companyDetails = companyDetails;
    }

    // ✅ NEW: Set waitingForPayment flag if not paid
    if (!isPaid && !isCashPayment) {
      delivery.waitingForPayment = true;
    }

    // Update driver
    driver.currentDeliveryId = delivery._id;
    driver.isAvailable = false;
    driver.totalRequests = (driver.totalRequests || 0) + 1;
    driver.acceptedRequests = (driver.acceptedRequests || 0) + 1;

    await delivery.save({ session });
    await driver.save({ session });

    // If payment exists, link driver and company
    let payment = null;
    if (!isCashPayment) {
      try {
        payment = await Payment.findOne({
          deliveryId: delivery._id,
        }).session(session);

        if (payment) {
          payment.driverId = driver._id;
          payment.companyId = driver.companyId?._id || driver.companyId;
          
          if (driver.companyId && driver.companyId.paystackSubaccountCode) {
            payment.metadata = {
              ...payment.metadata,
              companySubaccount: driver.companyId.paystackSubaccountCode,
              driverAssignedAt: new Date(),
            };
            payment.markModified('metadata');
          }
          
          await payment.save({ session });
        }
      } catch (error) {
        console.warn("⚠️ Payment update skipped:", error.message);
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Get customer for notification
    const customer = await User.findById(delivery.customerId);
    
    // Send notifications
    if (customer) {
      let notificationMessage;
      
      if (isCashPayment) {
        notificationMessage = `${driver.userId.name}${driver.companyId ? ` from ${driver.companyId.name}` : ''} has accepted your delivery. Cash payment on delivery: ₦${delivery.fare.totalFare.toLocaleString()}`;
      } else if (isPaid) {
        notificationMessage = `${driver.userId.name}${driver.companyId ? ` from ${driver.companyId.name}` : ''} has accepted your delivery. Payment secured!`;
      } else {
        notificationMessage = `${driver.userId.name}${driver.companyId ? ` from ${driver.companyId.name}` : ''} is waiting! Please complete payment to start delivery`;
      }
      
      await sendNotification({
        userId: customer._id,
        title: !isPaid && !isCashPayment ? '⏳ Driver Waiting for Payment' : '🚗 Driver Assigned!',
        message: notificationMessage,
        data: {
          type: 'driver_assigned',
          deliveryId: delivery._id,
          driverId: driver._id,
          driverName: driver.userId.name,
          companyName: driver.companyId?.name,
          paymentMethod: delivery.payment.method,
          paymentRequired: !isPaid && !isCashPayment,
          isCashPayment: isCashPayment,
        },
      });
    }

    let driverMessage;
    if (isCashPayment) {
      driverMessage = `You've accepted a cash delivery. Collect ₦${delivery.fare.totalFare.toLocaleString()} upon delivery`;
    } else if (isPaid) {
      driverMessage = `You've accepted a delivery. Payment secured. Head to pickup!`;
    } else {
      driverMessage = `You've accepted the delivery! Waiting for customer to complete payment before you can start`;
    }

    await sendNotification({
      userId: driverUser._id,
      title: '✅ Delivery Accepted',
      message: driverMessage,
      data: {
        type: 'delivery_accepted',
        deliveryId: delivery._id,
        paymentMethod: delivery.payment.method,
        paymentStatus: delivery.payment.status,
        waitingForPayment: !isPaid && !isCashPayment,
      },
    });

    const updatedDelivery = await Delivery.findById(delivery._id)
      .populate("customerId", "name phone avatarUrl rating")
      .lean();
    
    const deliveryWithDetails = await populateDriverAndCompanyDetails(updatedDelivery);

    res.status(200).json({
      success: true,
      message: !isPaid && !isCashPayment 
        ? "Delivery accepted! You'll be notified once customer completes payment"
        : isCashPayment
        ? "Delivery accepted! Remember to collect cash payment upon delivery"
        : "Delivery accepted! Payment secured. Head to pickup location",
      data: {
        delivery: deliveryWithDetails,
        driver: deliveryWithDetails.driverDetails,
        company: deliveryWithDetails.companyDetails,
        payment: {
          method: delivery.payment.method,
          status: delivery.payment.status,
          amount: delivery.fare.totalFare,
          waitingForPayment: !isPaid && !isCashPayment,
          message: !isPaid && !isCashPayment 
            ? 'Waiting for customer to complete payment'
            : isCashPayment 
            ? 'Cash to be collected upon delivery'
            : 'Payment secured',
          canStartDelivery: isPaid || isCashPayment,
        },
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    
    console.error("❌ Accept delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept delivery",
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 2: UPDATE startDelivery - Block if payment not confirmed
// ═══════════════════════════════════════════════════════════════════════════

// In delivery.controller.js - REPLACE startDelivery function:

export const startDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const driverUser = req.user;
    const { deliveryId } = req.params;

    console.log(`📦 [START] Driver ${driverUser._id} starting delivery ${deliveryId}`);

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
        message: "Delivery not found or not assigned to you",
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

    // ✅ NEW: Check payment status before allowing start
    const isCashPayment = delivery.payment?.method === 'cash';
    const isPaid = delivery.payment?.status === 'paid';

    console.log(`💳 Payment check: Method=${delivery.payment?.method}, Status=${delivery.payment?.status}`);

    // For non-cash payments, MUST be paid before starting
    if (!isCashPayment && !isPaid) {
      await session.abortTransaction();
      session.endSession();
      
      const paymentMethodName = delivery.payment?.method === 'card' ? 'card' : 'online';
      
      return res.status(403).json({
        success: false,
        message: `Cannot start delivery - customer hasn't completed ${paymentMethodName} payment yet`,
        data: {
          paymentStatus: delivery.payment?.status || 'pending',
          paymentMethod: delivery.payment?.method,
          requiresPayment: true,
          waitingForCustomer: true,
          nextAction: 'Wait for customer to complete payment',
        },
      });
    }

    // ✅ VERIFIED: Payment is confirmed or it's cash - allow start
    delivery.status = "picked_up";
    delivery.pickedUpAt = new Date();
    delivery.waitingForPayment = false; // Clear flag

    await delivery.save({ session });

    const customer = await User.findById(delivery.customerId);
    if (customer) {
      await sendNotification({
        userId: customer._id,
        title: '📦 Package Picked Up',
        message: `Driver has picked up your package and is heading to the destination${!isCashPayment ? '. Payment is secured' : ''}.`,
        data: {
          type: 'package_picked_up',
          deliveryId: delivery._id,
        },
      });
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Delivery started - Payment ${isPaid ? 'secured' : 'cash on delivery'}`);

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
          status: isPaid ? 'secured' : 'cash_on_delivery',
          message: isPaid 
            ? 'Payment held until customer confirms delivery'
            : `Collect ₦${delivery.fare.totalFare.toLocaleString()} cash upon delivery`,
          isCash: isCashPayment,
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


// ═══════════════════════════════════════════════════════════════════════════
// PART 3: NEW - Refund Payment Function
// ═══════════════════════════════════════════════════════════════════════════

// Add this NEW function to payment.controller.js:

/**
 * @desc    Refund payment to customer
 * @route   POST /api/payments/refund/:paymentId
 * @access  Private (Internal use - called from cancelDelivery)
 */
export const refundPayment = async (paymentId, reason = 'Delivery cancelled') => {
  try {
    console.log(`💸 [REFUND] Initiating refund for payment ${paymentId}`);

    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      console.error('❌ Payment not found for refund');
      return {
        success: false,
        error: 'Payment not found',
      };
    }

    // Check if already refunded
    if (payment.refund?.status === 'refunded') {
      console.log('⚠️ Payment already refunded');
      return {
        success: true,
        alreadyRefunded: true,
        refundId: payment.refund.refundId,
        refundedAt: payment.refund.refundedAt,
      };
    }

    // Check if payment can be refunded
    if (payment.status !== 'successful') {
      console.log(`⚠️ Payment status ${payment.status} - no refund needed`);
      return {
        success: true,
        noRefundNeeded: true,
        reason: 'Payment was not successful',
      };
    }

    // Check payment method
    if (payment.paymentMethod === 'cash') {
      console.log('💵 Cash payment - no refund needed');
      return {
        success: true,
        noRefundNeeded: true,
        reason: 'Cash payment - no refund needed',
      };
    }

    // ✅ Initiate Paystack refund
    try {
      const response = await paystackAxios.post('/refund', {
        transaction: payment.paystackReference,
        amount: Math.round(payment.amount * 100), // Convert to kobo
        currency: 'NGN',
        customer_note: reason,
        merchant_note: `Refund for delivery cancellation - ${reason}`,
      });

      if (response.data.status === true) {
        // Update payment with refund details
        payment.refund = {
          status: 'refunded',
          refundId: response.data.data.id || response.data.data.transaction?.id,
          amount: payment.amount,
          refundedAt: new Date(),
          reason: reason,
          paystackResponse: response.data.data,
        };

        payment.status = 'refunded';
        
        // Add to audit log
        payment.auditLog.push({
          action: 'refunded',
          timestamp: new Date(),
          details: {
            refundId: payment.refund.refundId,
            amount: payment.amount,
            reason: reason,
          },
        });

        payment.markModified('refund');
        await payment.save();

        console.log(`✅ Refund successful - Refund ID: ${payment.refund.refundId}`);

        return {
          success: true,
          refundId: payment.refund.refundId,
          amount: payment.amount,
          refundedAt: payment.refund.refundedAt,
        };
      } else {
        throw new Error(response.data.message || 'Refund failed');
      }
    } catch (refundError) {
      console.error('❌ Paystack refund error:', refundError.response?.data || refundError.message);

      // Mark as refund pending
      payment.refund = {
        status: 'pending',
        amount: payment.amount,
        requestedAt: new Date(),
        reason: reason,
        error: refundError.response?.data?.message || refundError.message,
      };
      payment.markModified('refund');
      await payment.save();

      return {
        success: false,
        error: refundError.response?.data?.message || 'Refund initiation failed',
        refundPending: true,
        requiresManualRefund: true,
      };
    }
  } catch (error) {
    console.error('❌ Refund error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 4: UPDATE cancelDelivery - Add automatic refund
// ═══════════════════════════════════════════════════════════════════════════

// In delivery.controller.js - REPLACE cancelDelivery function:

export const cancelDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const { deliveryId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Cancellation reason is required",
      });
    }

    const delivery = await Delivery.findById(deliveryId).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const isCustomer = user._id.toString() === delivery.customerId.toString();
    const isDriver = user.role === "driver" && delivery.driverId;
    const isAdmin = user.role === "admin";

    if (!isCustomer && !isDriver && !isAdmin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this delivery",
      });
    }

    // Check if delivery can be cancelled
    const cancellableStatuses = ['created', 'assigned', 'picked_up'];
    if (!cancellableStatuses.includes(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be cancelled from status: ${delivery.status}`,
        data: {
          currentStatus: delivery.status,
          canCancel: false,
          reason: delivery.status === 'delivered' 
            ? 'Delivery already completed'
            : delivery.status === 'cancelled'
            ? 'Delivery already cancelled'
            : 'Delivery is in final stage',
        },
      });
    }

    // ✅ NEW: Check for payment and initiate refund
    let refundResult = null;
    let payment = null;

    try {
      payment = await Payment.findOne({
        deliveryId: delivery._id,
        status: 'successful',
      }).session(session);

      if (payment) {
        console.log(`💰 Found payment ${payment._id} - Initiating refund`);
        
        // Commit current transaction before refund
        await session.commitTransaction();
        
        // Process refund (outside transaction)
        refundResult = await refundPayment(payment._id, reason);
        
        // Start new transaction for delivery update
        await session.startSession();
        await session.startTransaction();
      }
    } catch (paymentError) {
      console.warn('⚠️ Payment refund check failed:', paymentError.message);
    }

    // Update delivery status
    delivery.status = "cancelled";
    delivery.cancelledAt = new Date();
    delivery.cancelledBy = {
      userId: user._id,
      role: user.role,
      reason: reason,
    };

    // If driver was assigned, free them up
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
            message: `Delivery #${delivery.referenceId} has been cancelled. ${refundResult?.success ? 'Payment refunded to customer.' : ''}`,
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

    // Notify other party
    if (user.role === 'driver') {
      const customer = await User.findById(delivery.customerId);
      if (customer) {
        await sendNotification({
          userId: customer._id,
          title: '🚫 Delivery Cancelled by Driver',
          message: `Your delivery has been cancelled. ${refundResult?.success ? 'Full refund will be processed within 5-7 business days.' : reason}`,
          data: {
            type: 'delivery_cancelled',
            deliveryId: delivery._id,
            reason: reason,
            refunded: refundResult?.success || false,
          },
        });
      }
    } else if (user.role === 'customer' && delivery.driverId) {
      // Already notified driver above
    }

    await delivery.save({ session });
    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Delivery cancelled - Refund: ${refundResult?.success ? 'Success' : 'Not needed/Failed'}`);

    res.status(200).json({
      success: true,
      message: refundResult?.success 
        ? "Delivery cancelled and payment refunded successfully"
        : "Delivery cancelled successfully",
      data: {
        delivery: {
          _id: delivery._id,
          referenceId: delivery.referenceId,
          status: delivery.status,
          cancelledAt: delivery.cancelledAt,
          cancelledBy: {
            role: user.role,
            reason: reason,
          },
        },
        refund: refundResult ? {
          refunded: refundResult.success,
          refundId: refundResult.refundId,
          amount: refundResult.amount,
          refundedAt: refundResult.refundedAt,
          message: refundResult.success 
            ? 'Refund processed successfully. Amount will be credited within 5-7 business days'
            : refundResult.noRefundNeeded 
            ? 'No refund needed'
            : 'Refund pending - please contact support',
          requiresManualRefund: refundResult.requiresManualRefund || false,
        } : null,
      },
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    
    console.error("❌ Cancel delivery error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel delivery",
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 5: UPDATE Payment Schema - Add refund fields
// ═══════════════════════════════════════════════════════════════════════════

// In models/payments.models.js - ADD these fields to the schema:

const paymentSchema = new mongoose.Schema({
  // ... existing fields ...
  
  // ✅ NEW: Refund tracking
  refund: {
    status: {
      type: String,
      enum: ['none', 'pending', 'refunded', 'failed'],
      default: 'none',
    },
    refundId: String, // Paystack refund ID
    amount: Number,
    refundedAt: Date,
    requestedAt: Date,
    reason: String,
    error: String,
    paystackResponse: mongoose.Schema.Types.Mixed,
  },
  
  // ... rest of schema ...
});


// ═══════════════════════════════════════════════════════════════════════════
// PART 6: UPDATE Delivery Schema - Add waitingForPayment flag
// ═══════════════════════════════════════════════════════════════════════════

// In models/delivery.models.js - ADD this field:

const deliverySchema = new mongoose.Schema({
  // ... existing fields ...
  
  // ✅ NEW: Flag to indicate driver is waiting for payment
  waitingForPayment: {
    type: Boolean,
    default: false,
  },
  
  // ... rest of schema ...
});


// ═══════════════════════════════════════════════════════════════════════════
// PART 7: ADD Webhook Handler for Payment Completion
// ═══════════════════════════════════════════════════════════════════════════

// Add to payment.controller.js - UPDATE handlePaystackWebhook:

export const handlePaystackWebhook = async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature',
      });
    }

    const event = req.body;
    console.log('📨 Paystack webhook:', event.event);

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const payment = await Payment.findOne({ paystackReference: reference });

      if (payment && payment.status === 'pending') {
        payment.status = 'successful';
        payment.paidAt = new Date();
        payment.verifiedAt = new Date();
        payment.webhookData = event.data;
        payment.metadata = {
          ...payment.metadata,
          escrowStatus: 'held',
          escrowHeldAt: new Date(),
        };
        payment.markModified('metadata');
        
        await payment.save();

        // Update delivery
        const delivery = await Delivery.findById(payment.deliveryId);
        if (delivery) {
          delivery.payment.status = 'paid';
          delivery.payment.paidAt = new Date();
          delivery.waitingForPayment = false; // ✅ Clear waiting flag
          await delivery.save();
          
          // ✅ NEW: Notify driver that payment is complete
          if (delivery.driverId) {
            const driver = await Driver.findById(delivery.driverId).populate('userId');
            if (driver && driver.userId) {
              await sendNotification({
                userId: driver.userId._id,
                title: '✅ Payment Confirmed!',
                message: `Customer completed payment for delivery #${delivery.referenceId}. You can now start the delivery!`,
                data: {
                  type: 'payment_confirmed',
                  deliveryId: delivery._id,
                  paymentId: payment._id,
                  amount: payment.amount,
                  canStartDelivery: true,
                },
              });
            }
          }
        }

        console.log('✅ Payment updated via webhook:', reference);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed',
    });
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// PART 8: Add import for paystackAxios in payment.controller.js
// ═══════════════════════════════════════════════════════════════════════════

// At the top of payment.controller.js, add:

import axios from 'axios';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_live_d68be4ae85980a9c4c319edf02dc2db4aca8cbdd';

const paystackAxios = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});


// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY OF CHANGES
// ═══════════════════════════════════════════════════════════════════════════

/*
✅ WHAT'S IMPLEMENTED:

1. DRIVER CAN ACCEPT BEFORE PAYMENT:
   - acceptDelivery() now allows acceptance regardless of payment status
   - Sets waitingForPayment flag if payment not completed
   - Driver sees message "Waiting for customer to complete payment"

2. DRIVER CANNOT START WITHOUT PAYMENT:
   - startDelivery() blocks if payment not confirmed (for non-cash)
   - Returns clear error: "Customer hasn't completed payment yet"
   - Allows start only after payment confirmed or for cash deliveries

3. AUTOMATIC REFUND ON CANCELLATION:
   - cancelDelivery() checks for existing payment
   - Calls refundPayment() to initiate Paystack refund
   - Updates payment status to 'refunded'
   - Notifies customer about refund (5-7 business days)

4. PAYMENT CONFIRMATION NOTIFICATION:
   - Webhook notifies driver when payment completes
   - Driver can then start the delivery
   - waitingForPayment flag cleared

5. REFUND TRACKING:
   - Payment schema tracks refund status
   - Stores refund ID, amount, timestamp
   - Handles failed refunds (marked for manual processing)

DEPLOYMENT STEPS:
1. Update Delivery schema (add waitingForPayment)
2. Update Payment schema (add refund object)
3. Replace acceptDelivery function
4. Replace startDelivery function
5. Replace cancelDelivery function
6. Add refundPayment function
7. Update handlePaystackWebhook
8. Test flow thoroughly
*/