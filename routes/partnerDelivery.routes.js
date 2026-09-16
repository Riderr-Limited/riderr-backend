/**
 * @swagger
 * tags:
 *   name: Partner API
 *   description: External partner (ecommerce/marketplace) delivery integration, authenticated via X-API-Key/X-API-Secret
 */
import express from "express";
import rateLimit from "express-rate-limit";
import { apiKeyAuth } from "../middlewares/apiKeyAuth.middleware.js";
import {
  createPartnerDelivery,
  getPartnerDelivery,
  listPartnerDeliveries,
  cancelPartnerDelivery,
  listPartnerCompanies,
} from "../controllers/partnerDelivery.controller.js";

const router = express.Router();

const partnerRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

router.use(partnerRateLimit);
router.use(apiKeyAuth);

router.get("/companies", listPartnerCompanies);

router.post("/deliveries", createPartnerDelivery);
router.get("/deliveries", listPartnerDeliveries);
router.get("/deliveries/:deliveryId", getPartnerDelivery);
router.post("/deliveries/:deliveryId/cancel", cancelPartnerDelivery);

export default router;
