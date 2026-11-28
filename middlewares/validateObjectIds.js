// middlewares/validateObjectIds.js
// Rejects malformed IDs in URLs (e.g. /rides/abc) with a 400, instead of
// letting Mongoose throw a CastError that the handlers turn into a 500.
// Applied to every router with validateObjectIds(router).

// Route params that hold MongoDB ObjectIds. (callId, token, reference,
// referenceId, check and dataType are plain strings and are not listed.)
export const OBJECT_ID_PARAMS = [
  "deliveryId", "driverId", "companyId", "userId", "rideId", "paymentId", "errandId", "podId",
  "ticketId", "notificationId", "partnerId", "recordId", "guarantorId", "messageId", "customerId", "id",
];

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const validateObjectIds = (router) => {
  for (const name of OBJECT_ID_PARAMS) {
    router.param(name, (req, res, next, value) => {
      if (OBJECT_ID.test(String(value))) return next();
      return res.status(400).json({ success: false, message: `Invalid ${name}`, code: "INVALID_ID" });
    });
  }
  return router;
};
