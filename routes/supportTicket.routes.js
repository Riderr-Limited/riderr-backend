import express from "express";
import {
  createSupportTicket,
  getTickets,
  getTicketById,
  getTicketMessages,
  updateTicketStatus,
} from "../controllers/supportTicket.controller.js";
import { createSupportTicketValidator } from "../middlewares/supportTicket.validator.js";
import authenticate from "../middlewares/authenticate.js";

const router = express.Router();

router.post(
  "/tickets",
  authenticate,
  createSupportTicketValidator,
  createSupportTicket,
);

router.get("/tickets", authenticate, getTickets);

router.get("/tickets/:ticketId", authenticate, getTicketById);

router.get("/tickets/:ticketId/messages", authenticate, getTicketMessages);

router.patch("/tickets/:ticketId", authenticate, updateTicketStatus);

export default router;
