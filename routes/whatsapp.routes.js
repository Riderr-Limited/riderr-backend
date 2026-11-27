// routes/whatsapp.routes.js
// Webhook for the WhatsApp Cloud API (Meta).
//
//   GET  /api/whatsapp/webhook  - one-time verification when the webhook is set up in Meta
//   POST /api/whatsapp/webhook  - incoming messages and delivery statuses
//
// Mounted in app.js BEFORE the global express.json() parser, because the
// signature check needs the raw request body.
import express from "express";
import WhatsAppInbound from "../models/whatsappInbound.model.js";
import { verifySignature } from "../services/whatsapp/client.js";
import { handleInbound } from "../services/whatsapp/bot.js";

const router = express.Router();

router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).type("text/plain").send(String(challenge));
  }
  return res.sendStatus(403);
});

router.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  if (!verifySignature(req.body, req.get("x-hub-signature-256"))) {
    console.warn(" WhatsApp webhook: invalid or missing signature");
    return res.sendStatus(401);
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.sendStatus(400);
  }

  // Acknowledge right away; Meta retries if we take too long.
  res.sendStatus(200);

  const app = req.app;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (value.metadata?.phone_number_id && value.metadata.phone_number_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) {
        continue; // another number on the same app
      }

      for (const status of value.statuses || []) {
        if (status.status === "failed") {
          console.warn(` WhatsApp message to ${status.recipient_id} failed:`, JSON.stringify(status.errors || []));
        }
      }

      const names = Object.fromEntries((value.contacts || []).map((c) => [c.wa_id, c.profile?.name]));

      for (const message of value.messages || []) {
        try {
          await WhatsAppInbound.create({ messageId: message.id });
        } catch (error) {
          if (error.code === 11000) continue; // already handled (Meta retry)
          console.error(" WhatsApp dedupe error:", error.message);
          continue;
        }

        handleInbound({ from: message.from, profileName: names[message.from], message, app });
      }
    }
  }
});

export default router;
