import express from "express";
import { createSupportTicket } from "../controllers/supportTicket.controller.js";
import { createSupportTicketValidator } from "../middlewares/supportTicket.validator.js";
import authenticate from "../middlewares/authenticate.js";

const router = express.Router();

router.post(
  "/tickets",
  authenticate,
  createSupportTicketValidator,
  createSupportTicket,
);

export default router;
