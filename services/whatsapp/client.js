// services/whatsapp/client.js
// Thin wrapper around the WhatsApp Cloud API plus the hook that forwards
// regular app notifications to customers who use Riderr on WhatsApp.
import crypto from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import WhatsAppSession from "../../models/whatsappSession.model.js";
// Same model the delivery chat controller uses (chat.model.js must load before
// chatMessage.model.js, which reuses the registered "ChatMessage" model).
import ChatMessage from "../../models/chat.model.js";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v23.0";
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Set while the bot is handling a customer's message. Notifications created
 * for that same customer during the request are skipped, because the bot is
 * already replying to them in the chat.
 */
export const whatsappContext = new AsyncLocalStorage();

export const isWhatsAppConfigured = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

const clip = (value, max) => {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

async function callGraph(payload) {
  if (!isWhatsAppConfigured()) {
    console.warn(" WhatsApp is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID); message dropped");
    return null;
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `WhatsApp API error ${response.status}`);
    error.code = data?.error?.code;
    error.details = data?.error;
    throw error;
  }
  return data;
}

export const sendText = (to, body) =>
  callGraph({
    to,
    type: "text",
    text: { body: clip(body, 4096), preview_url: true },
  });

/** Up to 3 quick-reply buttons. buttons: [{ id, title }] */
export const sendButtons = (to, body, buttons, footer) =>
  callGraph({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: clip(body, 1024) },
      ...(footer && { footer: { text: clip(footer, 60) } }),
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: clip(b.title, 20) },
        })),
      },
    },
  });

/** A list picker with up to 10 rows. rows: [{ id, title, description? }] */
export const sendList = (to, body, buttonLabel, rows, { header, footer, sectionTitle } = {}) =>
  callGraph({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      ...(header && { header: { type: "text", text: clip(header, 60) } }),
      body: { text: clip(body, 4096) },
      ...(footer && { footer: { text: clip(footer, 60) } }),
      action: {
        button: clip(buttonLabel, 20),
        sections: [
          {
            title: clip(sectionTitle || "Options", 24),
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: clip(r.title, 24),
              ...(r.description && { description: clip(r.description, 72) }),
            })),
          },
        ],
      },
    },
  });

/** Shows a "Send location" button that opens WhatsApp's location picker. */
export const sendLocationRequest = (to, body) =>
  callGraph({
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: clip(body, 1024) },
      action: { name: "send_location" },
    },
  });

/** A message with a single link button (used for card payment links). */
export const sendLinkButton = (to, body, displayText, url) =>
  callGraph({
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: clip(body, 1024) },
      action: {
        name: "cta_url",
        parameters: { display_text: clip(displayText, 20), url },
      },
    },
  });

export const sendTemplate = (to, name, languageCode, bodyParams = []) =>
  callGraph({
    to,
    type: "template",
    template: {
      name,
      language: { code: languageCode },
      components: bodyParams.length
        ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
        : [],
    },
  });

export const markRead = (messageId) =>
  callGraph({ status: "read", message_id: messageId }).catch(() => null);

/**
 * Checks Meta's X-Hub-Signature-256 header against the raw request body.
 * Requests are rejected when WHATSAPP_APP_SECRET is not set.
 */
export function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !rawBody || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

// Template parameters may not contain newlines, tabs or 4+ consecutive spaces.
const templateSafe = (text, max = 900) =>
  clip(String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim() || "-", max);

const followUpHint = (data = {}, title = "") => {
  const t = `${data.type || ""} ${title}`.toLowerCase();
  if (data.senderName && data.deliveryId) return "\n\nReply *chat* to answer your rider.";
  if (t.includes("completed") || t.includes("delivered")) return "\n\nReply *rate* to rate your rider.";
  if (t.includes("assigned") || t.includes("picked up")) return "\n\nReply *track* for live tracking.";
  return "";
};

/**
 * Forwards a notification to the user's WhatsApp, if they use Riderr there and
 * haven't opted out. Called from utils/notification.js#sendNotification.
 * Never throws.
 */
export async function notifyUserOnWhatsApp(userId, { title, message, data = {} } = {}) {
  try {
    if (!isWhatsAppConfigured() || !userId) return;

    const ctx = whatsappContext.getStore();
    if (ctx?.userId && String(ctx.userId) === String(userId)) return;

    const session = await WhatsAppSession.findOne({ userId, optIn: true }).lean();
    if (!session) return;

    let body = String(message || "").trim();

    // Chat notifications only carry a 50-character preview; send the full message instead.
    if (data.senderName && data.deliveryId) {
      const latest = await ChatMessage.findOne({ deliveryId: data.deliveryId, receiverId: userId })
        .sort({ createdAt: -1 })
        .select("message messageType")
        .lean();
      if (latest?.messageType === "text" && latest.message) body = latest.message;
    }

    const cleanTitle = String(title || "Riderr update").trim();
    const inWindow =
      session.lastInboundAt &&
      Date.now() - new Date(session.lastInboundAt).getTime() < SESSION_WINDOW_MS - 60 * 1000;

    if (inWindow) {
      const heading = data.senderName && data.deliveryId ? `💬 *Message from your rider (${cleanTitle})*` : `*${cleanTitle}*`;
      await sendText(session.phone, `${heading}\n${body}${followUpHint(data, cleanTitle)}`);
      return;
    }

    // Outside the 24h window WhatsApp only allows pre-approved templates.
    const template = process.env.WHATSAPP_UPDATE_TEMPLATE;
    if (!template) return;
    await sendTemplate(session.phone, template, process.env.WHATSAPP_TEMPLATE_LANG || "en", [
      templateSafe(cleanTitle, 60),
      templateSafe(body),
    ]);
  } catch (error) {
    console.error(" WhatsApp notification error:", error.message);
  }
}
