// ============================================
// SERVER SIDE: socket/deliverySocket.js
// ============================================
import DeliveryPerson from "../models/deliveryPerson.model.js";
import Delivery from "../models/delivery.models.js";
import ChatMessage from "../models/chat.model.js";
import User from "../models/user.models.js";

// Store online delivery persons with their socket IDs
const onlineDeliveryPersons = new Map(); // userId -> { socketId, location, services }
const deliveryRequests = new Map(); // deliveryId -> { customer data, timeout }

export const setupDeliverySocket = (io) => {
  io.on("connection", (socket) => {
    console.log("🔌 Client connected:", socket.id);

    // ==========================================
    // DELIVERY PERSON EVENTS
    // ==========================================

    /**
     * Delivery person goes online
     */
    socket.on("delivery_person:online", async (data) => {
      try {
        const { userId, location, services } = data;

        // Store online status
        onlineDeliveryPersons.set(userId, {
          socketId: socket.id,
          userId,
          location: {
            lat: location.lat,
            lng: location.lng,
          },
          services: services || { deliveries: true, rides: false },
          updatedAt: new Date(),
        });

        // Update database
        await DeliveryPerson.findOneAndUpdate(
          { userId },
          {
            isOnline: true,
            "currentLocation.lat": location.lat,
            "currentLocation.lng": location.lng,
          },
        );

        console.log(`✅ Delivery person ${userId} is online`);

        socket.emit("delivery_person:online_success", {
          success: true,
          message: "You are now online",
        });
      } catch (error) {
        console.error("Error setting delivery person online:", error);
        socket.emit("delivery_person:online_error", {
          success: false,
          message: error.message,
        });
      }
    });

    /**
     * Delivery person goes offline
     */
    socket.on("delivery_person:offline", async (data) => {
      try {
        const { userId } = data;

        // Remove from online map
        onlineDeliveryPersons.delete(userId);

        // Update database
        await DeliveryPerson.findOneAndUpdate({ userId }, { isOnline: false });

        console.log(`❌ Delivery person ${userId} is offline`);

        socket.emit("delivery_person:offline_success", {
          success: true,
          message: "You are now offline",
        });
      } catch (error) {
        console.error("Error setting delivery person offline:", error);
      }
    });

    /**
     * Update delivery person location
     */
    socket.on("delivery_person:location_update", async (data) => {
      try {
        const { userId, location } = data;

        // Update in-memory map
        const person = onlineDeliveryPersons.get(userId);
        if (person) {
          person.location = {
            lat: location.lat,
            lng: location.lng,
          };
          person.updatedAt = new Date();
          onlineDeliveryPersons.set(userId, person);
        }

        // Update database (debounced in real app)
        await DeliveryPerson.findOneAndUpdate(
          { userId },
          {
            "currentLocation.lat": location.lat,
            "currentLocation.lng": location.lng,
            "currentLocation.updatedAt": new Date(),
          },
        );
      } catch (error) {
        console.error("Error updating location:", error);
      }
    });

    /**
     * Delivery person accepts delivery
     */
    socket.on("delivery_person:accept_delivery", async (data) => {
      try {
        const { deliveryId, deliveryPersonId } = data;

        // Find delivery
        const delivery = await Delivery.findById(deliveryId);
        if (!delivery) {
          socket.emit("delivery:accept_error", {
            success: false,
            message: "Delivery not found",
          });
          return;
        }

        if (delivery.status !== "created") {
          socket.emit("delivery:accept_error", {
            success: false,
            message: "Delivery already assigned",
          });
          return;
        }

        // Assign delivery
        delivery.deliveryPersonId = deliveryPersonId;
        delivery.status = "assigned";
        delivery.assignedAt = new Date();
        await delivery.save();

        // Update delivery person
        await DeliveryPerson.findByIdAndUpdate(deliveryPersonId, {
          currentDeliveryId: deliveryId,
          isAvailable: false,
        });

        // Clear timeout for this delivery
        const request = deliveryRequests.get(deliveryId);
        if (request?.timeout) {
          clearTimeout(request.timeout);
        }
        deliveryRequests.delete(deliveryId);

        // Notify delivery person
        socket.emit("delivery:assigned_success", {
          success: true,
          message: "Delivery assigned to you",
          delivery,
        });

        // Notify customer
        const customerSocketId = request?.customerSocketId;
        if (customerSocketId) {
          io.to(customerSocketId).emit("delivery:assigned", {
            success: true,
            message: "Delivery person assigned!",
            delivery: await delivery.populate([
              {
                path: "deliveryPersonId",
                populate: { path: "userId", select: "name phone avatarUrl" },
              },
            ]),
          });
        }

        console.log(
          `✅ Delivery ${deliveryId} assigned to ${deliveryPersonId}`,
        );
      } catch (error) {
        console.error("Error accepting delivery:", error);
        socket.emit("delivery:accept_error", {
          success: false,
          message: error.message,
        });
      }
    });

    /**
     * Delivery person rejects delivery
     */
    socket.on("delivery_person:reject_delivery", async (data) => {
      try {
        const { deliveryId, reason } = data;

        console.log(`❌ Delivery ${deliveryId} rejected: ${reason}`);

        // Find next available delivery person
        await findAndNotifyNextDeliveryPerson(deliveryId, io);
      } catch (error) {
        console.error("Error rejecting delivery:", error);
      }
    });

    // ==========================================
    // CUSTOMER EVENTS
    // ==========================================

    /**
     * Customer creates delivery and searches for nearby delivery persons
     */
    socket.on("delivery:create_and_search", async (data) => {
      try {
        const { delivery, pickupLocation } = data;

        console.log(
          "📦 New delivery created, searching for delivery persons...",
        );

        // Find nearby online delivery persons
        const nearbyPersons = await findNearbyDeliveryPersons(
          pickupLocation.lat,
          pickupLocation.lng,
          10000, // 10km radius
        );

        if (nearbyPersons.length === 0) {
          socket.emit("delivery:no_persons_available", {
            success: false,
            message: "No delivery persons available in your area",
            delivery,
          });
          return;
        }

        // Store delivery request with customer socket ID
        deliveryRequests.set(delivery._id, {
          deliveryId: delivery._id,
          customerSocketId: socket.id,
          pickupLocation,
          nearbyPersons,
          notifiedPersons: [],
          createdAt: new Date(),
        });

        // Notify nearby delivery persons (one at a time)
        await notifyNextDeliveryPerson(delivery._id, io);

        // Set timeout for auto-cancellation (5 minutes)
        const timeout = setTimeout(
          async () => {
            const request = deliveryRequests.get(delivery._id);
            if (request) {
              await Delivery.findByIdAndUpdate(delivery._id, {
                status: "cancelled",
                cancellationReason:
                  "No delivery person accepted within time limit",
              });

              socket.emit("delivery:auto_cancelled", {
                success: false,
                message: "No delivery person available. Please try again.",
                deliveryId: delivery._id,
              });

              deliveryRequests.delete(delivery._id);
            }
          },
          5 * 60 * 1000,
        ); // 5 minutes

        deliveryRequests.get(delivery._id).timeout = timeout;

        // Notify customer
        socket.emit("delivery:searching", {
          success: true,
          message: `Searching for delivery persons... Found ${nearbyPersons.length} nearby`,
          nearbyCount: nearbyPersons.length,
        });
      } catch (error) {
        console.error("Error creating and searching delivery:", error);
        socket.emit("delivery:search_error", {
          success: false,
          message: error.message,
        });
      }
    });

    /**
     * Customer cancels delivery search
     */
    socket.on("delivery:cancel_search", async (data) => {
      try {
        const { deliveryId } = data;

        const request = deliveryRequests.get(deliveryId);
        if (request?.timeout) {
          clearTimeout(request.timeout);
        }
        deliveryRequests.delete(deliveryId);

        await Delivery.findByIdAndUpdate(deliveryId, {
          status: "cancelled",
          cancellationReason: "Cancelled by customer",
        });

        socket.emit("delivery:cancelled", {
          success: true,
          message: "Delivery search cancelled",
        });
      } catch (error) {
        console.error("Error cancelling delivery:", error);
      }
    });

    /**
     * Track delivery in real-time
     */
    socket.on("delivery:track", async (data) => {
      try {
        const { deliveryId } = data;

        const delivery = await Delivery.findById(deliveryId).populate({
          path: "deliveryPersonId",
          populate: { path: "userId", select: "name phone avatarUrl" },
        });

        if (!delivery) {
          socket.emit("delivery:track_error", {
            success: false,
            message: "Delivery not found",
          });
          return;
        }

        // Join room for this delivery
        socket.join(`delivery:${deliveryId}`);

        // Send current status
        socket.emit("delivery:status_update", {
          success: true,
          delivery,
        });
      } catch (error) {
        console.error("Error tracking delivery:", error);
      }
    });

    // ==========================================
    // DISCONNECT
    // ==========================================
    socket.on("disconnect", () => {
      console.log("🔌 Client disconnected:", socket.id);

      // Find and remove disconnected delivery person
      for (const [userId, person] of onlineDeliveryPersons.entries()) {
        if (person.socketId === socket.id) {
          onlineDeliveryPersons.delete(userId);

          // Update database
          DeliveryPerson.findOneAndUpdate(
            { userId },
            { isOnline: false },
          ).catch((err) =>
            console.error("Error updating offline status:", err),
          );

          console.log(`❌ Delivery person ${userId} went offline (disconnect)`);
          break;
        }
      }
    });
  });
};

// ==========================================
// CHAT EVENTS
// ==========================================

/**
 * Join delivery chat room
 */
io.on("connection", (socket) => {
  socket.on("chat:join_delivery", async (data) => {
    try {
      const { deliveryId, userId } = data;

      // Verify user can access this delivery chat
      const delivery = await Delivery.findById(deliveryId)
        .select("customerId driverId status")
        .populate("driverId", "userId");

      if (!delivery) {
        socket.emit("chat:error", { message: "Delivery not found" });
        return;
      }

      const isCustomer = delivery.customerId.toString() === userId;
      const isDriver = delivery.driverId?.userId?.toString() === userId;

      if (!isCustomer && !isDriver) {
        socket.emit("chat:error", { message: "Access denied" });
        return;
      }

      // Join the delivery-specific room
      socket.join(`delivery_chat_${deliveryId}`);
      console.log(`User ${userId} joined delivery chat ${deliveryId}`);

      socket.emit("chat:joined", {
        deliveryId,
        success: true,
      });
    } catch (error) {
      console.error("Join delivery chat error:", error);
      socket.emit("chat:error", { message: "Failed to join chat" });
    }
  });

  /**
   * Leave delivery chat room
   */
  socket.on("chat:leave_delivery", (data) => {
    const { deliveryId } = data;
    socket.leave(`delivery_chat_${deliveryId}`);
    console.log(`User left delivery chat ${deliveryId}`);
  });

  /**
   * Send chat message
   */
  socket.on("chat:send_message", async (data) => {
    try {
      const {
        deliveryId,
        message,
        messageType = "text",
        location,
        imageUrl,
        userId,
      } = data;

      // Verify delivery and get receiver
      const delivery = await Delivery.findById(deliveryId)
        .select("customerId driverId")
        .populate("driverId", "userId");

      if (!delivery) {
        socket.emit("chat:error", { message: "Delivery not found" });
        return;
      }

      const isCustomer = delivery.customerId.toString() === userId;
      const isDriver = delivery.driverId?.userId?.toString() === userId;

      if (!isCustomer && !isDriver) {
        socket.emit("chat:error", { message: "Access denied" });
        return;
      }

      // Determine receiver
      const receiverId = isCustomer
        ? delivery.driverId.userId
        : delivery.customerId;

      // Save message to database
      const chatMessage = new ChatMessage({
        deliveryId,
        senderId: userId,
        receiverId,
        message,
        messageType,
        location,
        imageUrl,
      });

      await chatMessage.save();
      await chatMessage.populate("senderId", "name avatarUrl role");

      // Emit to all users in the delivery chat room
      io.to(`delivery_chat_${deliveryId}`).emit("chat:new_message", {
        message: chatMessage,
        deliveryId,
      });
    } catch (error) {
      console.error("Send chat message error:", error);
      socket.emit("chat:error", { message: "Failed to send message" });
    }
  });

  /**
   * Typing indicators
   */
  socket.on("chat:typing_start", (data) => {
    const { deliveryId, userId } = data;
    socket.to(`delivery_chat_${deliveryId}`).emit("chat:typing_start", {
      userId,
      deliveryId,
    });
  });

  socket.on("chat:typing_stop", (data) => {
    const { deliveryId, userId } = data;
    socket.to(`delivery_chat_${deliveryId}`).emit("chat:typing_stop", {
      userId,
      deliveryId,
    });
  });
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Calculate distance between two coordinates
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
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
}

/**
 * Find nearby online delivery persons
 */
async function findNearbyDeliveryPersons(lat, lng, maxDistance) {
  const nearby = [];

  for (const [userId, person] of onlineDeliveryPersons.entries()) {
    if (person.services?.deliveries) {
      const distance = calculateDistance(
        lat,
        lng,
        person.location.lat,
        person.location.lng,
      );

      if (distance <= maxDistance / 1000) {
        // Convert to km
        // Get full details from database
        const deliveryPerson = await DeliveryPerson.findOne({
          userId,
        }).populate("userId", "name phone avatarUrl");

        if (deliveryPerson && deliveryPerson.isAvailable) {
          nearby.push({
            ...deliveryPerson.toObject(),
            socketId: person.socketId,
            distance,
            distanceText: `${distance.toFixed(1)} km`,
          });
        }
      }
    }
  }

  // Sort by distance
  nearby.sort((a, b) => a.distance - b.distance);

  return nearby;
}

/**
 * Notify next available delivery person
 */
async function notifyNextDeliveryPerson(deliveryId, io) {
  const request = deliveryRequests.get(deliveryId);
  if (!request) return;

  const { nearbyPersons, notifiedPersons = [] } = request;

  // Find next person who hasn't been notified
  const nextPerson = nearbyPersons.find(
    (person) => !notifiedPersons.includes(person._id.toString()),
  );

  if (!nextPerson) {
    // No more persons to notify
    const customerSocketId = request.customerSocketId;
    if (customerSocketId) {
      io.to(customerSocketId).emit("delivery:no_persons_available", {
        success: false,
        message: "All nearby delivery persons are busy or declined",
      });
    }
    return;
  }

  // Mark as notified
  notifiedPersons.push(nextPerson._id.toString());
  request.notifiedPersons = notifiedPersons;
  deliveryRequests.set(deliveryId, request);

  // Get delivery details
  const delivery = await Delivery.findById(deliveryId).populate(
    "customerId",
    "name phone",
  );

  // Send notification to delivery person
  io.to(nextPerson.socketId).emit("delivery:new_request", {
    success: true,
    message: "New delivery request",
    delivery,
    distance: nextPerson.distanceText,
    expiresIn: 30, // seconds to respond
  });

  console.log(
    `📢 Notified delivery person ${nextPerson._id} about delivery ${deliveryId}`,
  );

  // Set timeout for this person to respond (30 seconds)
  setTimeout(async () => {
    const currentRequest = deliveryRequests.get(deliveryId);
    if (
      currentRequest &&
      currentRequest.notifiedPersons.includes(nextPerson._id.toString())
    ) {
      // Person didn't respond, notify next one
      await notifyNextDeliveryPerson(deliveryId, io);
    }
  }, 30000);
}

/**
 * Find and notify next delivery person after rejection
 */
async function findAndNotifyNextDeliveryPerson(deliveryId, io) {
  await notifyNextDeliveryPerson(deliveryId, io);
}

/**
 * Broadcast delivery status update
 */
export function broadcastDeliveryStatusUpdate(
  io,
  deliveryId,
  status,
  data = {},
) {
  io.to(`delivery:${deliveryId}`).emit("delivery:status_update", {
    success: true,
    deliveryId,
    status,
    ...data,
  });
}

/**
 * Notify delivery person location update to customer
 */
export function broadcastDeliveryPersonLocation(io, deliveryId, location) {
  io.to(`delivery:${deliveryId}`).emit("delivery_person:location_update", {
    success: true,
    location,
  });
}
