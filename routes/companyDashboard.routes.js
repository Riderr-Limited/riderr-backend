import express from "express";
import { authenticate, authorize } from "../middlewares/auth.middleware.js";
import {
  listRiders,
  addRider,
  approveRider,
  suspendRider,
  activateRider,
  getRiderDeliveries,
  getDashboardOverview,
  getAllDeliveries,
  createManualRecord,
  listManualRecords,
  getManualRecord,
  updateManualRecord,
  deleteManualRecord,
  getManualRecordsSummary,
} from "../controllers/companyDashboard.controller.js";

const router = express.Router();

router.use(authenticate, authorize("company_admin"));

// Dashboard overview
router.get("/overview", getDashboardOverview);

// Rider management
router.get("/riders", listRiders);
router.post("/riders", addRider);
router.patch("/riders/:driverId/approve", approveRider);
router.patch("/riders/:driverId/suspend", suspendRider);
router.patch("/riders/:driverId/activate", activateRider);
router.get("/riders/:driverId/deliveries", getRiderDeliveries);

// All Riderr deliveries for this company
router.get("/deliveries", getAllDeliveries);

// Manual records
router.get("/manual-records/summary", getManualRecordsSummary);
router.get("/manual-records", listManualRecords);
router.post("/manual-records", createManualRecord);
router.get("/manual-records/:recordId", getManualRecord);
router.patch("/manual-records/:recordId", updateManualRecord);
router.delete("/manual-records/:recordId", deleteManualRecord);

export default router;
