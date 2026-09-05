import express from "express";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import {
  createErrand,
  assignRiderToErrand,
  acceptErrand,
  startErrand,
  markAtPickup,
  recordExpense,
  completeErrand,
  confirmErrandCompletion,
  cancelErrand,
  raiseErrandDispute,
  getErrandDetails,
  listErrands,
} from "../controllers/errand.controller.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// List & create
router.get("/", listErrands);
router.post("/", authorize("customer"), createErrand);

// Single errand
router.get("/:errandId", getErrandDetails);

// Lifecycle
router.post("/:errandId/assign",             authorize("company_admin", "admin"), assignRiderToErrand);
router.patch("/:errandId/accept",            authorize("driver"), acceptErrand);
router.patch("/:errandId/start",             authorize("driver"), startErrand);
router.patch("/:errandId/at-pickup",         authorize("driver"), markAtPickup);
router.post("/:errandId/expense",            authorize("driver"), recordExpense);
router.patch("/:errandId/complete",          authorize("driver"), completeErrand);
router.patch("/:errandId/confirm-completion", authorize("customer", "admin"), confirmErrandCompletion);
router.patch("/:errandId/cancel",            cancelErrand); // customer / company_admin / admin — checked in controller
router.post("/:errandId/dispute",            authorize("customer", "admin"), raiseErrandDispute);

export default router;
