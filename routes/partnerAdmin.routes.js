/**
 * @swagger
 * tags:
 *   name: Partner Admin
 *   description: Admin-only management of external Partner API credentials
 */
import express from "express";
import { authenticate, adminOnly } from "../middlewares/auth.middleware.js";
import {
  createPartner,
  listPartners,
  getPartner,
  suspendPartner,
  activatePartner,
  regeneratePartnerSecret,
} from "../controllers/partnerAdmin.controller.js";

const router = express.Router();

router.use(authenticate, adminOnly);

router.post("/", createPartner);
router.get("/", listPartners);
router.get("/:partnerId", getPartner);
router.patch("/:partnerId/suspend", suspendPartner);
router.patch("/:partnerId/activate", activatePartner);
router.post("/:partnerId/regenerate-secret", regeneratePartnerSecret);

export default router;
