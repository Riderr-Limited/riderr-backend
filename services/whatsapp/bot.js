// services/whatsapp/bot.js
// Conversation logic for the Riderr customer WhatsApp bot.
//
// Every action goes through the same controllers the mobile app calls (via
// runRoute), so fares, driver matching, payments, refunds and notifications
// behave exactly as they do in the app.
import bcrypt from "bcryptjs";
import crypto from "crypto";
import validator from "validator";

import User from "../../models/user.models.js";
import Payment from "../../models/payments.models.js";
import WhatsAppSession from "../../models/whatsappSession.model.js";
import * as wa from "./client.js";
import { runRoute } from "./invoke.js";

import {
  calculateDeliveryFare,
  createDeliveryRequest,
  getCustomerActiveDelivery,
  getMyDeliveries,
  cancelDeliveryWithRefund,
  rateDelivery,
} from "../../controllers/delivery.controller.js";
import { initializeDeliveryPayment, checkPaymentStatus } from "../../controllers/payment.controller.js";
import { createSupportTicket } from "../../controllers/supportTicket.controller.js";
import { createSupportTicketValidator } from "../../middlewares/supportTicket.validator.js";
import { sendMessage as sendChatMessage } from "../../controllers/chat.controller.js";
import { canAccessDeliveryChat } from "../../middlewares/auth.middleware.js";
import { initializePayment as createCheckoutLink } from "../../utils/paymentGateway.js";
import { forwardGeocode } from "../../utils/geocoding.js";

// ───────────────────────────── constants ─────────────────────────────

const MENU_ROWS = [
  { id: "book", title: "📦 Send a package", description: "Get a quote and book a rider" },
  { id: "track", title: "📍 Track delivery", description: "Status, rider details and live location" },
  { id: "history", title: "🧾 My deliveries", description: "Your 5 most recent deliveries" },
  { id: "chat", title: "💬 Message rider", description: "Send a message to your rider" },
  { id: "pay_status", title: "💳 Payment", description: "Check or finish paying for a delivery" },
  { id: "cancel_delivery", title: "❌ Cancel delivery", description: "Cancel your active delivery" },
  { id: "rate", title: "⭐ Rate a delivery", description: "Rate your last completed delivery" },
  { id: "support", title: "🆘 Get help", description: "Open a ticket with our support team" },
];

const KEYWORDS = {
  book: ["book", "send", "send package", "new delivery", "deliver", "1"],
  track: ["track", "status", "where", "2"],
  history: ["history", "orders", "deliveries", "my deliveries", "3"],
  chat: ["chat", "message rider", "message driver", "4"],
  pay_status: ["pay", "payment", "5"],
  cancel_delivery: ["cancel delivery", "6"],
  rate: ["rate", "7"],
  support: ["help", "support", "8"],
};

const ITEM_TYPES = [
  { id: "parcel", title: "Parcel / package" },
  { id: "document", title: "Documents" },
  { id: "perishable", title: "Food / perishables" },
  { id: "electronic", title: "Electronics" },
  { id: "fragile", title: "Fragile items" },
];

const ITEM_SIZES = [
  { id: "size_small", title: "Small", description: "Fits in a bag (up to 2 kg)", weight: 1 },
  { id: "size_medium", title: "Medium", description: "Shoe box to small carton (2–10 kg)", weight: 5 },
  { id: "size_large", title: "Large", description: "Big carton (10–25 kg)", weight: 15 },
];

const CANCEL_REASONS = [
  { id: "cr_mind", title: "Changed my mind" },
  { id: "cr_slow", title: "Rider taking too long" },
  { id: "cr_address", title: "Wrong address" },
  { id: "cr_mistake", title: "Booked by mistake" },
  { id: "cr_other", title: "Other reason" },
];

// Must match the values in middlewares/supportTicket.validator.js
const SUPPORT_TYPES = [
  { id: "delivery problems", title: "Delivery problem" },
  { id: "payment issues", title: "Payment issue" },
  { id: "account problems", title: "Account problem" },
  { id: "safety concerns", title: "Safety concern" },
  { id: "app technical issues", title: "App / technical issue" },
  { id: "other", title: "Something else" },
];

const STATUS_LABELS = {
  created: "Looking for a rider",
  assigned: "Rider assigned",
  picked_up: "Picked up, on the way",
  in_transit: "On the way",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  rescue_requested: "Rider requested help",
};

// ───────────────────────────── helpers ─────────────────────────────

const naira = (n) => `₦${Number(n || 0).toLocaleString("en-NG")}`;
const shortAddr = (a, max = 60) => {
  const s = String(a || "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const mapsLink = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;

/** WhatsApp ID (2348031234567) → the formats a phone may be stored in. */
function phoneCandidates(waId) {
  const digits = String(waId).replace(/\D/g, "");
  if (!digits.startsWith("234") || digits.length !== 13) return null;
  const local = digits.slice(3);
  return [`+234${local}`, `0${local}`, `234${local}`];
}

/** Any common Nigerian format → +234XXXXXXXXXX, or null if invalid. */
function normalizeNgPhone(input) {
  const d = String(input || "").replace(/[^\d+]/g, "");
  let local;
  if (/^\+234\d{10}$/.test(d)) local = d.slice(4);
  else if (/^234\d{10}$/.test(d)) local = d.slice(3);
  else if (/^0\d{10}$/.test(d)) local = d.slice(1);
  else return null;
  const full = `+234${local}`;
  return /^\+234[7-9][0-1]\d{8}$/.test(full) ? full : null;
}

async function geocodeAddress(text) {
  const query = /nigeria/i.test(text) ? text : `${text}, Nigeria`;

  const google = await forwardGeocode(query);
  if (google?.success) return { lat: google.lat, lng: google.lng, address: google.formattedAddress };

  // Free fallback when no Google Maps key is configured
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ng&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Riderr-Backend/1.0", "Accept-Language": "en" },
      signal: AbortSignal.timeout(8000),
    });
    const [hit] = await response.json();
    if (hit) return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), address: hit.display_name };
  } catch (error) {
    console.warn(" Nominatim geocode failed:", error.message);
  }
  return null;
}

function parseInput(message) {
  switch (message.type) {
    case "text":
      return { kind: "text", text: message.text?.body?.trim() || "" };
    case "interactive": {
      const reply = message.interactive?.button_reply || message.interactive?.list_reply;
      return { kind: "choice", id: reply?.id, text: reply?.title || "" };
    }
    case "button": // quick-reply button on a template message
      return { kind: "choice", id: message.button?.payload, text: message.button?.text || "" };
    case "location":
      return {
        kind: "location",
        lat: message.location?.latitude,
        lng: message.location?.longitude,
        address: [message.location?.name, message.location?.address].filter(Boolean).join(", ") || null,
      };
    default:
      return { kind: "unsupported", type: message.type };
  }
}

const lower = (input) => (input.kind === "text" ? input.text.toLowerCase() : "");
const choiceOrText = (input) => (input.kind === "choice" ? input.id : lower(input));

function matchMenuAction(input) {
  if (input.kind === "choice" && MENU_ROWS.some((r) => r.id === input.id)) return input.id;
  const t = lower(input);
  if (!t) return null;
  for (const [action, words] of Object.entries(KEYWORDS)) {
    if (words.includes(t)) return action;
  }
  return null;
}

async function saveState(session, state, data = session.data) {
  session.state = state;
  session.data = data;
  session.markModified("data");
  await session.save();
}

const resetState = (session) => saveState(session, "idle", {});

async function loadUser(userId) {
  if (!userId) return null;
  const user = await User.findById(userId)
    .select("-password -refreshToken")
    .populate("companyId", "name status");
  if (!user || !user.isActive || user.isDeleted || user.isLocked) return null;
  return user;
}

// ───────────────────────────── entry point ─────────────────────────────

// Messages from one number are handled one at a time, in order.
const queues = new Map();

export function handleInbound({ from, profileName, message, app }) {
  const previous = queues.get(from) || Promise.resolve();
  const current = previous
    .then(() => processInbound({ from, profileName, message, app }))
    .catch(async (error) => {
      console.error(" WhatsApp bot error:", error);
      await wa
        .sendText(from, "Sorry, something went wrong on our side. Please try again, or type *menu*.")
        .catch(() => null);
    })
    .finally(() => {
      if (queues.get(from) === current) queues.delete(from);
    });
  queues.set(from, current);
  return current;
}

async function processInbound({ from, profileName, message, app }) {
  let session = await WhatsAppSession.findOne({ phone: from });
  if (!session) session = new WhatsAppSession({ phone: from });
  session.lastInboundAt = new Date();
  if (profileName) session.profileName = profileName;
  await session.save();

  wa.markRead(message.id);

  const input = parseInput(message);
  const t = lower(input);

  if (input.kind === "unsupported") {
    return wa.sendText(from, "I can read text, button taps and shared locations. Type *menu* to see what I can do.");
  }

  // Opt-out / opt-in for delivery updates
  if (["stop", "unsubscribe"].includes(t)) {
    session.optIn = false;
    await session.save();
    return wa.sendText(from, "You won't get delivery updates on WhatsApp anymore. Reply *START* to turn them back on.");
  }
  if (["start", "subscribe"].includes(t) && !session.optIn) {
    session.optIn = true;
    await session.save();
    await wa.sendText(from, "Delivery updates are back on ✅");
  }

  // ── Identify the customer ──
  let user = await loadUser(session.userId);
  if (!user && session.userId) {
    session.userId = null;
    await session.save();
  }

  if (!user) {
    if (session.state.startsWith("reg_")) return handleRegistration(session, input, profileName);

    const candidates = phoneCandidates(from);
    const existing = candidates
      ? await User.findOne({ phone: { $in: candidates }, isDeleted: { $ne: true } }).select("_id role")
      : null;

    if (existing) {
      if (existing.role !== "customer") {
        return wa.sendText(
          from,
          "This number belongs to a Riderr rider or business account. WhatsApp booking is for customers only for now, so please use the Riderr app.",
        );
      }
      user = await loadUser(existing._id);
      if (!user) {
        return wa.sendText(from, "Your Riderr account is currently deactivated or locked. Please contact support@riderr.ng.");
      }
      session.userId = user._id;
      await resetState(session);
      await wa.sendText(from, `Welcome back, ${user.name.split(" ")[0]}! 👋 Your Riderr account is now connected to WhatsApp.`);
      return sendMenu(from);
    }

    if (!candidates) {
      return wa.sendText(
        from,
        "Riderr on WhatsApp is available for Nigerian (+234) numbers. You can still book in the Riderr app.",
      );
    }
    return startRegistration(session, profileName);
  }

  // ── Global commands ──
  if (["menu", "hi", "hello", "hey", "home", "start", "0"].includes(t)) {
    await resetState(session);
    return sendMenu(from, `Hi ${user.name.split(" ")[0]} 👋 What would you like to do?`);
  }
  if (["cancel", "exit", "quit", "back"].includes(t) && session.state !== "idle") {
    await resetState(session);
    return sendMenu(from, "Okay, stopped. What would you like to do?");
  }

  const ctx = { from, session, user, app, input };

  return wa.whatsappContext.run({ userId: user._id }, () => route(ctx));
}

// ───────────────────────────── routing ─────────────────────────────

async function route(ctx) {
  const { session, input } = ctx;
  const handler = STATE_HANDLERS[session.state];

  if (handler) return handler(ctx);

  // Idle: pick an action from the menu
  const action = matchMenuAction(input) || (lower(input) === "cancel" ? "cancel_delivery" : null);
  if (action) return ACTIONS[action](ctx);

  return sendMenu(ctx.from, "Sorry, I didn't catch that. Here's what I can do:");
}

function sendMenu(to, intro = "What would you like to do?") {
  return wa.sendList(to, intro, "Menu", MENU_ROWS, {
    sectionTitle: "Riderr",
    footer: "Type menu at any time to come back here",
  });
}

const ACTIONS = {
  book: startBooking,
  track: trackDelivery,
  history: showHistory,
  chat: startChat,
  pay_status: paymentStatus,
  cancel_delivery: startCancel,
  rate: startRating,
  support: startSupport,
};

// ───────────────────────────── registration ─────────────────────────────

async function startRegistration(session, profileName) {
  await saveState(session, "reg_name", {});
  const intro =
    "Welcome to *Riderr* 🛵 — fast package delivery, right here on WhatsApp.\n\nLet's set up your account (takes 30 seconds). What's your *full name*?";
  if (profileName && profileName.trim().length >= 2) {
    return wa.sendButtons(session.phone, intro, [{ id: "reg_use_profile", title: profileName.trim() }], "Tap your name or type it");
  }
  return wa.sendText(session.phone, intro);
}

async function handleRegistration(session, input, profileName) {
  const from = session.phone;
  const t = lower(input);

  if (["cancel", "exit", "quit"].includes(t)) {
    await resetState(session);
    return wa.sendText(from, "No problem. Message us any time to sign up.");
  }

  if (session.state === "reg_name") {
    const name = (input.kind === "choice" && input.id === "reg_use_profile" ? profileName : input.text || "").trim();
    if (name.length < 2 || name.length > 100) {
      return wa.sendText(from, "Please send your full name (2–100 characters).");
    }
    await saveState(session, "reg_email", { name });
    return wa.sendText(from, `Thanks, ${name.split(" ")[0]}! What's your *email address*? We'll send your receipts there.`);
  }

  if (session.state === "reg_email") {
    const email = (input.text || "").trim().toLowerCase();
    if (!validator.isEmail(email)) {
      return wa.sendText(from, "That doesn't look like a valid email. Please try again.");
    }
    if (await User.exists({ email })) {
      return wa.sendText(
        from,
        "That email already belongs to a Riderr account with a different phone number.\n\nIf it's yours, open the Riderr app, change your phone number to this WhatsApp number, then message us again. Or send a different email.",
      );
    }

    const local = phoneCandidates(from)[0];
    let user;
    try {
      // The customer can set a real password later with "Forgot password" in the app.
      const password = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
      user = await User.create({
        role: "customer",
        name: session.data.name,
        email,
        phone: local,
        password,
      });
    } catch (error) {
      console.error(" WhatsApp registration error:", error.message);
      return wa.sendText(from, "Sorry, we couldn't create your account. Please check your details and try again.");
    }

    session.userId = user._id;
    await resetState(session);
    await wa.sendText(
      from,
      `Your account is ready ✅\n\nYou can also log into the Riderr app with *${email}*. Use "Forgot password" there to set a password.`,
    );
    return sendMenu(from);
  }
}

// ───────────────────────────── booking ─────────────────────────────

async function startBooking({ from, session }) {
  await saveState(session, "book_pickup", {});
  return wa.sendLocationRequest(
    from,
    "📦 *New delivery*\n\nWhere should the rider *pick up* the package?\n\nTap *Send location* to drop a pin, or type the pickup address.",
  );
}

async function askDropoff(from) {
  return wa.sendLocationRequest(
    from,
    "Where is it going? Tap *Send location* to drop a pin for the *drop-off*, or type the address.",
  );
}

/** Shared by the pickup and drop-off steps. which = "pickup" | "dropoff" */
async function handleAddressInput(ctx, which) {
  const { from, session, input } = ctx;
  const data = session.data;

  if (input.kind === "location") {
    data[which] = { lat: input.lat, lng: input.lng, address: input.address };
    return which === "pickup" ? afterPickup(ctx) : afterDropoff(ctx);
  }

  if (input.kind !== "text" || input.text.length < 3) {
    return wa.sendText(from, "Please share a location pin or type the address.");
  }

  const found = await geocodeAddress(input.text);
  if (!found) {
    return wa.sendText(
      from,
      "I couldn't find that address. Try adding the area and city (e.g. *12 Allen Avenue, Ikeja, Lagos*), or share a location pin.",
    );
  }

  data.pendingAddress = found;
  await saveState(session, `book_${which}_confirm`, data);
  return wa.sendButtons(
    from,
    `Is this the right ${which === "pickup" ? "pickup" : "drop-off"} address?\n\n📍 ${found.address}\n${mapsLink(found.lat, found.lng)}`,
    [
      { id: "addr_yes", title: "✅ Yes" },
      { id: "addr_no", title: "✏️ No, retype" },
    ],
  );
}

async function handleAddressConfirm(ctx, which) {
  const { from, session, input } = ctx;
  const answer = choiceOrText(input);

  if (answer === "addr_yes" || answer === "yes") {
    session.data[which] = session.data.pendingAddress;
    delete session.data.pendingAddress;
    return which === "pickup" ? afterPickup(ctx) : afterDropoff(ctx);
  }
  if (answer === "addr_no" || answer === "no") {
    delete session.data.pendingAddress;
    await saveState(session, `book_${which}`, session.data);
    return wa.sendText(from, "Okay, type the address again (include the area and city), or share a location pin.");
  }
  // They typed a new address instead of answering
  await saveState(session, `book_${which}`, session.data);
  return handleAddressInput(ctx, which);
}

async function afterPickup({ from, session }) {
  await saveState(session, "book_dropoff", session.data);
  return askDropoff(from);
}

async function afterDropoff({ from, session }) {
  await saveState(session, "book_recipient_name", session.data);
  return wa.sendButtons(from, "Who is receiving the package? Send the *recipient's name*.", [
    { id: "recipient_me", title: "It's me" },
  ]);
}

async function handleRecipientName({ from, session, user, input }) {
  if (input.kind === "choice" && input.id === "recipient_me") {
    session.data.recipientName = user.name;
    session.data.recipientPhone = user.phone;
    return askItemType(from, session);
  }
  const name = (input.text || "").trim();
  if (name.length < 2) return wa.sendText(from, "Please send the recipient's name.");
  session.data.recipientName = name.slice(0, 100);
  await saveState(session, "book_recipient_phone", session.data);
  return wa.sendText(from, `What's ${name.split(" ")[0]}'s *phone number*? The rider will call them on arrival.`);
}

async function handleRecipientPhone({ from, session, input }) {
  const phone = normalizeNgPhone(input.text);
  if (!phone) return wa.sendText(from, "Please send a valid Nigerian phone number, e.g. *08031234567*.");
  session.data.recipientPhone = phone;
  return askItemType(from, session);
}

async function askItemType(from, session) {
  await saveState(session, "book_item_type", session.data);
  return wa.sendList(from, "What are you sending?", "Choose item", ITEM_TYPES, { sectionTitle: "Item type" });
}

async function handleItemType({ from, session, input }) {
  const item = ITEM_TYPES.find((i) => i.id === input.id || i.title.toLowerCase() === lower(input));
  if (!item) {
    return wa.sendList(from, "Please pick an item type from the list.", "Choose item", ITEM_TYPES, { sectionTitle: "Item type" });
  }
  session.data.itemType = item.id;
  session.data.itemLabel = item.title;
  await saveState(session, "book_item_size", session.data);
  return wa.sendList(from, "How big is it?", "Choose size", ITEM_SIZES, { sectionTitle: "Size" });
}

async function handleItemSize({ from, session, input }) {
  const size = ITEM_SIZES.find((s) => s.id === input.id || s.title.toLowerCase() === lower(input));
  if (!size) return wa.sendList(from, "Please pick a size from the list.", "Choose size", ITEM_SIZES, { sectionTitle: "Size" });
  session.data.itemWeight = size.weight;
  session.data.sizeLabel = size.title;
  await saveState(session, "book_item_desc", session.data);
  return wa.sendButtons(
    from,
    "Briefly describe the item so the rider knows what to collect (e.g. _black shoe box_).",
    [{ id: "desc_skip", title: "Skip" }],
  );
}

async function handleItemDescription(ctx) {
  const { session, input } = ctx;
  session.data.itemDescription = input.kind === "choice" && input.id === "desc_skip" ? "" : (input.text || "").slice(0, 300);
  return sendQuote(ctx);
}

async function sendQuote(ctx) {
  const { from, session, user, app } = ctx;
  const d = session.data;

  const result = await runRoute([calculateDeliveryFare], {
    user,
    app,
    body: {
      pickupLat: d.pickup.lat,
      pickupLng: d.pickup.lng,
      dropoffLat: d.dropoff.lat,
      dropoffLng: d.dropoff.lng,
      itemType: d.itemType,
      itemWeight: d.itemWeight,
    },
  });

  if (!result.ok) {
    // Too close / too far: let them fix the drop-off
    if (result.status === 400) {
      await saveState(session, "book_dropoff", d);
      await wa.sendText(from, `⚠️ ${result.body?.message || "We couldn't price that trip."}`);
      return askDropoff(from);
    }
    await resetState(session);
    return wa.sendText(from, "Sorry, we couldn't get a price right now. Please try again in a moment (type *book*).");
  }

  const q = result.body.data;
  d.pickup.address = d.pickup.address || q.pickup.address;
  d.dropoff.address = d.dropoff.address || q.dropoff.address;
  d.quote = {
    quoteId: q.quoteId,
    totalFare: q.fare.totalFare,
    distance: q.distance.formatted,
    duration: q.estimatedDuration.formatted,
  };
  await saveState(session, "book_payment", d);

  const riders = q.availability.nearbyDriversCount;
  const availability =
    riders > 0
      ? `🟢 ${riders} rider${riders === 1 ? "" : "s"} nearby · pickup in ${q.availability.estimatedPickupTime}`
      : "🟡 Few riders nearby right now, so it may take longer to find one";

  return wa.sendButtons(
    from,
    [
      "📦 *Delivery quote*",
      "",
      `*From:* ${shortAddr(d.pickup.address, 80)}`,
      `*To:* ${shortAddr(d.dropoff.address, 80)}`,
      `*Recipient:* ${d.recipientName} (${d.recipientPhone})`,
      `*Item:* ${d.itemLabel} · ${d.sizeLabel}${d.itemDescription ? ` · ${d.itemDescription}` : ""}`,
      `*Distance:* ${d.quote.distance} · about ${d.quote.duration}`,
      "",
      `💰 *Fare: ${naira(d.quote.totalFare)}*`,
      availability,
      "",
      "How would you like to pay?",
    ].join("\n"),
    [
      { id: "pay_cash", title: "💵 Cash" },
      { id: "pay_transfer", title: "🏦 Bank transfer" },
      { id: "pay_card", title: "💳 Card" },
    ],
    "Type cancel to stop",
  );
}

async function handlePaymentChoice(ctx) {
  const { from, session, user, app, input } = ctx;
  const choice = choiceOrText(input);
  const method = { pay_cash: "cash", cash: "cash", pay_transfer: "transfer", transfer: "transfer", pay_card: "card", card: "card" }[choice];

  if (!method) {
    return wa.sendButtons(from, "Please choose how you'd like to pay.", [
      { id: "pay_cash", title: "💵 Cash" },
      { id: "pay_transfer", title: "🏦 Bank transfer" },
      { id: "pay_card", title: "💳 Card" },
    ]);
  }

  const d = session.data;
  // Clear the flow first so a double tap can't create the delivery twice
  await resetState(session);

  const created = await runRoute([createDeliveryRequest], {
    user,
    app,
    body: {
      pickupAddress: d.pickup.address,
      pickupLat: d.pickup.lat,
      pickupLng: d.pickup.lng,
      pickupName: user.name,
      pickupPhone: user.phone,
      dropoffAddress: d.dropoff.address,
      dropoffLat: d.dropoff.lat,
      dropoffLng: d.dropoff.lng,
      recipientName: d.recipientName,
      recipientPhone: d.recipientPhone,
      itemType: d.itemType,
      itemDescription: d.itemDescription,
      itemWeight: d.itemWeight,
      paymentMethod: method,
      quoteId: d.quote.quoteId,
      expectedFare: d.quote.totalFare,
    },
  });

  if (!created.ok) {
    if (created.body?.data?.currentFare) {
      return wa.sendText(
        from,
        `The fare changed to ${naira(created.body.data.currentFare)} while you were booking. Type *book* to get a fresh quote.`,
      );
    }
    return wa.sendText(from, `Sorry, we couldn't create your delivery: ${created.body?.message || "unknown error"}. Type *book* to try again.`);
  }

  const delivery = created.body.data.delivery;
  const searching = created.body.noDriversFound
    ? "We're searching for a rider and will message you here as soon as one accepts."
    : "Nearby riders have been notified. We'll message you here when one accepts.";

  if (method === "cash") {
    return wa.sendText(
      from,
      `✅ *Delivery booked!*\nRef: *${delivery.referenceId}*\n\n${searching}\n\n💵 Pay *${naira(delivery.fare.totalFare)}* in cash to the rider.\n\nReply *track* any time to check on it.`,
    );
  }

  const reference = delivery.payment?.reference;
  if (method === "transfer") return sendTransferDetails({ from, user, app }, delivery._id, delivery.referenceId);
  return sendCardLink({ from, user }, delivery, reference);
}

async function sendTransferDetails({ from, user, app }, deliveryId, referenceId) {
  const init = await runRoute([initializeDeliveryPayment], {
    user,
    app,
    body: { deliveryId: String(deliveryId), paymentType: "transfer" },
  });

  if (!init.ok) {
    return wa.sendText(
      from,
      `Your delivery *${referenceId}* is booked, but we couldn't get transfer details: ${init.body?.message || "unknown error"}. Reply *payment* to try again.`,
    );
  }

  const p = init.body.data;
  await wa.sendText(
    from,
    [
      `✅ *Delivery booked* (Ref: *${referenceId}*)`,
      "",
      `🏦 Transfer exactly *${naira(p.amount)}* to:`,
      `*Bank:* ${p.bankAccount.bankName}`,
      `*Account number:* ${p.bankAccount.accountNumber}`,
      `*Account name:* ${p.bankAccount.accountName}`,
      p.bankAccount.narration && p.bankAccount.narration !== "Not required" ? `*Narration:* ${p.bankAccount.narration}` : null,
      "",
      "⏱️ Please pay within *5 minutes* or the booking is cancelled automatically.",
      "We'll confirm here as soon as the money arrives.",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );
  // Separate message so the number is easy to copy
  return wa.sendText(from, String(p.bankAccount.accountNumber));
}

async function sendCardLink({ from, user }, delivery, reference) {
  if (!reference) {
    return wa.sendText(from, `Your delivery *${delivery.referenceId}* is booked, but we couldn't start card payment. Reply *payment* to try again.`);
  }

  const payment = await Payment.findOne({ paystackReference: reference });
  let link = payment?.metadata?.checkoutLink;

  if (!link) {
    const checkout = await createCheckoutLink({
      reference,
      amount: delivery.fare.totalFare,
      currency: "NGN",
      email: user.email,
      channels: ["card"],
      metadata: {
        deliveryId: String(delivery._id),
        customerName: user.name,
        customerPhone: user.phone,
        source: "whatsapp",
      },
    });

    if (!checkout.success) {
      console.error(" WhatsApp card link error:", checkout.message);
      return wa.sendText(
        from,
        `Your delivery *${delivery.referenceId}* is booked, but card payment isn't available right now. Reply *payment* to pay by bank transfer instead.`,
      );
    }

    link = checkout.data.link;
    if (payment) {
      payment.metadata = { ...payment.metadata, checkoutLink: link, platform: "whatsapp" };
      payment.markModified("metadata");
      await payment.save();
    }
  }

  return wa.sendLinkButton(
    from,
    `✅ *Delivery booked* (Ref: *${delivery.referenceId}*)\n\n💳 Pay *${naira(delivery.fare.totalFare)}* securely on our payment page.\n\n⏱️ Please pay within *5 minutes* or the booking is cancelled automatically. We'll confirm here once it's paid.`,
    "Pay now",
    link,
  );
}

// ───────────────────────────── tracking & history ─────────────────────────────

async function getActive({ user, app }) {
  const result = await runRoute([getCustomerActiveDelivery], { user, app });
  return result.ok ? result.body.data : null;
}

// getCustomerActiveDelivery can return an empty driverDetails object before a
// rider accepts, so only treat it as assigned when it carries a name.
const assignedRider = (d) => (d?.driverDetails?.name ? d.driverDetails : null);

async function trackDelivery(ctx) {
  const { from } = ctx;
  const d = await getActive(ctx);
  if (!d) {
    return wa.sendButtons(from, "You don't have an active delivery right now.", [{ id: "book", title: "📦 Send a package" }]);
  }

  const driver = assignedRider(d);
  const vehicle = driver?.vehicle
    ? [driver.vehicle.make, driver.vehicle.model, driver.vehicle.plateNumber && `(${driver.vehicle.plateNumber})`].filter(Boolean).join(" ")
    : "";
  const lines = [
    `📍 *${d.referenceId}*: ${STATUS_LABELS[d.status] || d.status}`,
    d.nextStep ? `_${d.nextStep}_` : null,
    "",
    `*From:* ${shortAddr(d.pickup?.address)}`,
    `*To:* ${shortAddr(d.dropoff?.address)}`,
  ];

  if (driver) {
    lines.push("", `🛵 *Rider:* ${driver.name}${driver.rating ? ` ⭐ ${Number(driver.rating).toFixed(1)}` : ""}`);
    if (driver.phone) lines.push(`📞 ${driver.phone}`);
    if (vehicle) lines.push(`🏍️ ${vehicle}`);
    if (d.etaMinutes) lines.push(`⏱️ About *${d.etaMinutes} min* ${d.status === "assigned" ? "to pickup" : "to drop-off"}`);
    const loc = driver.currentLocation;
    if (loc?.lat && loc?.lng) lines.push(`🗺️ Rider's location: ${mapsLink(loc.lat, loc.lng)}`);
  }

  const pay = d.payment || {};
  lines.push("", `💰 ${naira(d.fare?.totalFare)} · ${pay.method || "cash"} · ${pay.status === "paid" ? "paid ✅" : pay.method === "cash" ? "pay rider on delivery" : "awaiting payment"}`);

  const buttons = [{ id: "track", title: "🔄 Refresh" }];
  if (driver) buttons.push({ id: "chat", title: "💬 Message rider" });
  buttons.push({ id: "cancel_delivery", title: "❌ Cancel" });

  return wa.sendButtons(from, lines.filter((l) => l !== null).join("\n"), buttons);
}

async function showHistory({ from, user, app }) {
  const result = await runRoute([getMyDeliveries], { user, app, query: { page: "1", limit: "5" } });
  const list = result.ok ? result.body.data : [];
  if (!list?.length) {
    return wa.sendButtons(from, "You haven't made any deliveries yet.", [{ id: "book", title: "📦 Send a package" }]);
  }

  const lines = list.map((d) => {
    const date = new Date(d.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
    return `• *${d.referenceId}* · ${date}\n  ${STATUS_LABELS[d.status] || d.status} · ${naira(d.fare?.totalFare)}\n  ${shortAddr(d.pickup?.address, 35)} → ${shortAddr(d.dropoff?.address, 35)}`;
  });
  return wa.sendText(from, `🧾 *Your recent deliveries*\n\n${lines.join("\n\n")}\n\nType *menu* for more options.`);
}

// ───────────────────────────── payment ─────────────────────────────

async function paymentStatus(ctx) {
  const { from, user, app } = ctx;
  const d = await getActive(ctx);
  if (!d) return wa.sendText(from, "You don't have an active delivery to pay for.");

  const pay = d.payment || {};
  if (pay.status === "paid") return wa.sendText(from, `✅ *${d.referenceId}* is paid (${naira(d.fare?.totalFare)}).`);
  if (!pay.method || pay.method === "cash") {
    return wa.sendText(from, `💵 *${d.referenceId}* is cash on delivery. Pay *${naira(d.fare?.totalFare)}* to the rider.`);
  }

  if (pay.reference) {
    const status = await runRoute([checkPaymentStatus], { user, app, params: { reference: pay.reference } });
    if (status.ok && status.body.data.status === "successful") {
      return wa.sendText(from, `✅ Payment received for *${d.referenceId}*. Thank you!`);
    }
  }

  if (pay.method === "card") return sendCardLink({ from, user }, d, pay.reference);
  return sendTransferDetails({ from, user, app }, d._id, d.referenceId);
}

// ───────────────────────────── chat with rider ─────────────────────────────

async function startChat(ctx) {
  const { from, session } = ctx;
  const d = await getActive(ctx);
  const rider = d && assignedRider(d);
  if (!rider) {
    return wa.sendText(from, d ? "No rider has accepted your delivery yet. We'll let you know as soon as one does." : "You don't have an active delivery.");
  }
  await saveState(session, "chat_message", { deliveryId: String(d._id), driverName: rider.name });
  return wa.sendText(from, `💬 Type your message for *${rider.name}* (or *cancel*).`);
}

async function handleChatMessage({ from, session, user, app, input }) {
  const text = (input.text || "").trim();
  if (!text) return wa.sendText(from, "Please type your message, or *cancel*.");
  if (text.length > 500) return wa.sendText(from, "That's a bit long. Please keep it under 500 characters.");

  const { deliveryId, driverName } = session.data;
  await resetState(session);

  const result = await runRoute([canAccessDeliveryChat, sendChatMessage], {
    user,
    app,
    params: { deliveryId },
    body: { message: text, messageType: "text" },
  });

  if (!result.ok) return wa.sendText(from, `Couldn't send your message: ${result.body?.message || "unknown error"}.`);
  return wa.sendText(from, `✅ Sent to ${driverName}. Their reply will show up here. Reply *chat* to send another.`);
}

// ───────────────────────────── cancel ─────────────────────────────

async function startCancel(ctx) {
  const { from, session } = ctx;
  const d = await getActive(ctx);
  if (!d) return wa.sendText(from, "You don't have an active delivery to cancel.");

  await saveState(session, "cancel_confirm", { deliveryId: String(d._id), referenceId: d.referenceId });
  const paidNote = d.payment?.status === "paid" ? "\n\nYou've already paid, so a refund will be processed under our cancellation policy." : "";
  return wa.sendButtons(from, `Cancel delivery *${d.referenceId}* (${STATUS_LABELS[d.status] || d.status})?${paidNote}`, [
    { id: "cancel_yes", title: "Yes, cancel it" },
    { id: "cancel_no", title: "No, keep it" },
  ]);
}

async function handleCancelConfirm({ from, session, input }) {
  const answer = choiceOrText(input);
  if (answer === "cancel_yes" || answer === "yes") {
    await saveState(session, "cancel_reason", session.data);
    return wa.sendList(from, "Sorry to see that. Why are you cancelling?", "Choose reason", CANCEL_REASONS, { sectionTitle: "Reason" });
  }
  await resetState(session);
  return wa.sendText(from, "👍 Your delivery is still on.");
}

async function handleCancelReason({ from, session, user, app, input }) {
  const reason = CANCEL_REASONS.find((r) => r.id === input.id)?.title || (input.text || "").trim();
  if (!reason) return wa.sendList(from, "Please pick a reason.", "Choose reason", CANCEL_REASONS, { sectionTitle: "Reason" });

  const { deliveryId, referenceId } = session.data;
  await resetState(session);

  const result = await runRoute([cancelDeliveryWithRefund], {
    user,
    app,
    params: { deliveryId },
    body: { reason: `${reason} (via WhatsApp)` },
  });

  if (!result.ok) return wa.sendText(from, `Couldn't cancel *${referenceId}*: ${result.body?.message || "unknown error"}.`);
  return wa.sendText(from, `❌ Delivery *${referenceId}* has been cancelled.${result.body?.message ? `\n\n${result.body.message}` : ""}`);
}

// ───────────────────────────── rating ─────────────────────────────

async function startRating({ from, session, user, app }) {
  const result = await runRoute([getMyDeliveries], { user, app, query: { status: "delivered", page: "1", limit: "5" } });
  const target = (result.ok ? result.body.data : []).find((d) => !d.rating);
  if (!target) return wa.sendText(from, "You have no completed deliveries waiting for a rating.");

  await saveState(session, "rate_score", { deliveryId: String(target._id), referenceId: target.referenceId });
  const rider = target.driverDetails?.name ? ` with ${target.driverDetails.name}` : "";
  return wa.sendList(
    from,
    `How was delivery *${target.referenceId}*${rider}?`,
    "Rate",
    [5, 4, 3, 2, 1].map((n) => ({ id: `rate_${n}`, title: `${"⭐".repeat(n)}`, description: ["", "Poor", "Fair", "Good", "Great", "Excellent"][n] })),
    { sectionTitle: "Your rating" },
  );
}

async function handleRatingScore({ from, session, input }) {
  const n = parseInt(String(input.id || input.text).replace("rate_", ""), 10);
  if (!(n >= 1 && n <= 5)) return wa.sendText(from, "Please choose 1 to 5 stars from the list.");
  session.data.rating = n;
  await saveState(session, "rate_review", session.data);
  return wa.sendButtons(from, "Thanks! Want to add a short comment for the rider?", [{ id: "review_skip", title: "Skip" }]);
}

async function handleRatingReview({ from, session, user, app, input }) {
  const review = input.kind === "choice" && input.id === "review_skip" ? undefined : (input.text || "").slice(0, 500);
  const { deliveryId, referenceId, rating } = session.data;
  await resetState(session);

  const result = await runRoute([rateDelivery], { user, app, params: { deliveryId }, body: { rating, review } });
  if (!result.ok) return wa.sendText(from, `Couldn't save your rating: ${result.body?.message || "unknown error"}.`);
  return wa.sendText(from, `🙏 Thanks for rating *${referenceId}* ${"⭐".repeat(rating)}`);
}

// ───────────────────────────── support ─────────────────────────────

async function startSupport({ from, session }) {
  await saveState(session, "support_type", {});
  return wa.sendList(from, "🆘 What do you need help with?", "Choose topic", SUPPORT_TYPES, { sectionTitle: "Topic" });
}

async function handleSupportType({ from, session, input }) {
  const type = SUPPORT_TYPES.find((s) => s.id === input.id);
  if (!type) return wa.sendList(from, "Please pick a topic.", "Choose topic", SUPPORT_TYPES, { sectionTitle: "Topic" });
  await saveState(session, "support_description", { issueType: type.id });
  return wa.sendText(from, "Please describe the problem in a few sentences (at least 20 characters). Include your delivery reference if you have one.");
}

async function handleSupportDescription({ from, session, user, app, input }) {
  const description = (input.text || "").trim();
  if (description.length < 20) return wa.sendText(from, "Please add a bit more detail (at least 20 characters).");

  const { issueType } = session.data;
  await resetState(session);

  const result = await runRoute([...createSupportTicketValidator, createSupportTicket], {
    user,
    app,
    body: {
      issueType,
      title: `[WhatsApp] ${description.slice(0, 85)}`,
      description: description.slice(0, 2000),
    },
  });

  if (!result.ok) return wa.sendText(from, "Sorry, we couldn't open a ticket right now. Please email support@riderr.ng.");
  return wa.sendText(
    from,
    `✅ Ticket *#${result.body.data.ticketId}* created. Our support team will get back to you, and updates will show up here.`,
  );
}

// ───────────────────────────── state table ─────────────────────────────

const STATE_HANDLERS = {
  book_pickup: (ctx) => handleAddressInput(ctx, "pickup"),
  book_pickup_confirm: (ctx) => handleAddressConfirm(ctx, "pickup"),
  book_dropoff: (ctx) => handleAddressInput(ctx, "dropoff"),
  book_dropoff_confirm: (ctx) => handleAddressConfirm(ctx, "dropoff"),
  book_recipient_name: handleRecipientName,
  book_recipient_phone: handleRecipientPhone,
  book_item_type: handleItemType,
  book_item_size: handleItemSize,
  book_item_desc: handleItemDescription,
  book_payment: handlePaymentChoice,
  chat_message: handleChatMessage,
  cancel_confirm: handleCancelConfirm,
  cancel_reason: handleCancelReason,
  rate_score: handleRatingScore,
  rate_review: handleRatingReview,
  support_type: handleSupportType,
  support_description: handleSupportDescription,
};
