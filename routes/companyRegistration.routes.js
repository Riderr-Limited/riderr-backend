import express from "express";
import {
  getPendingCompanies,
  approveCompany,
  rejectCompany,
  getRegistrationStatus
} from "../controllers/companyRegistration.controller.js";
import authorize from "../middlewares/authorize.js";
import authorizeRole from "../middlewares/authorizeRole.js";

const router = express.Router();

// Admin routes for company approvals
router.get("/pending", authorize, authorizeRole(["admin"]), getPendingCompanies);
router.patch("/:companyId/approve", authorize, authorizeRole(["admin"]), approveCompany);
router.patch("/:companyId/reject", authorize, authorizeRole(["admin"]), rejectCompany);

// Company admin routes
router.get("/status", authorize, authorizeRole(["company_admin"]), getRegistrationStatus);

export default router;