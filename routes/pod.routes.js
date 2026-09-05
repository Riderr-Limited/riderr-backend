import express from "express";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import {
  createPOD,
  confirmPOD,
  markReadyForDelivery,
  assignDriverToPOD,
  markAwaitingCustomer,
  recordPODPayment,
  rejectPOD,
  settlePOD,
  cancelPOD,
  getPODDetails,
  listPODOrders,
} from "../controllers/pod.controller.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// List & create
router.get("/", listPODOrders);
router.post("/", authorize("customer"), createPOD);

// Single order
router.get("/:podId", getPODDetails);

// Lifecycle
router.patch("/:podId/confirm",  authorize("company_admin", "admin"), confirmPOD);
router.patch("/:podId/ready",    authorize("company_admin", "admin"), markReadyForDelivery);
router.post("/:podId/assign",    authorize("company_admin", "admin"), assignDriverToPOD);
router.patch("/:podId/awaiting", authorize("driver"), markAwaitingCustomer);
router.post("/:podId/payment",   authorize("driver"), recordPODPayment);
router.post("/:podId/reject",    authorize("customer", "admin"), rejectPOD);
router.patch("/:podId/settle",   authorize("admin", "company_admin"), settlePOD);
router.patch("/:podId/cancel",   cancelPOD); // customer / company_admin / admin — checked in controller

export default router;
