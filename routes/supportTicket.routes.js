/**
 * @swagger
 * tags:
 *   name: Support
 *   description: Support ticket management
 */
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

/**
 * @swagger
 * /v1/support/tickets:
 *   post:
 *     tags: [Support]
 *     summary: Create a support ticket
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message, category]
 *             properties:
 *               subject: { type: string }
 *               message: { type: string }
 *               category: { type: string, enum: [delivery, payment, account, driver, other] }
 *               relatedId: { type: string }
 *     responses:
 *       201:
 *         description: Ticket created
 *   get:
 *     tags: [Support]
 *     summary: Get my support tickets
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, in_progress, resolved, closed] }
 *     responses:
 *       200:
 *         description: Tickets list
 */
router.post("/tickets", authenticate, createSupportTicketValidator, createSupportTicket);
router.get("/tickets", authenticate, getTickets);

/**
 * @swagger
 * /v1/support/tickets/{ticketId}:
 *   get:
 *     tags: [Support]
 *     summary: Get a support ticket by ID
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ticket details
 *   patch:
 *     tags: [Support]
 *     summary: Update ticket status
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [open, in_progress, resolved, closed] }
 *     responses:
 *       200:
 *         description: Ticket updated
 */
router.get("/tickets/:ticketId", authenticate, getTicketById);
router.get("/tickets/:ticketId/messages", authenticate, getTicketMessages);
router.patch("/tickets/:ticketId", authenticate, updateTicketStatus);

export default router;
