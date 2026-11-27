# Riderr on WhatsApp

Customers can use Riderr entirely from WhatsApp: sign up, get a quote, book, pay, track, message their rider, cancel, rate and contact support.

The bot doesn't have its own business logic. Each action runs the same route handlers the mobile app calls (see `services/whatsapp/invoke.js`), so fares, driver matching, payments, refunds and notifications behave exactly as they do in the app.

## How it works

```
Customer ─► WhatsApp ─► Meta Cloud API ─► POST /api/whatsapp/webhook
                                              │  (signature check, dedupe)
                                              ▼
                                   services/whatsapp/bot.js  (conversation state)
                                              │  runRoute([...route handlers])
                                              ▼
                     delivery / payment / chat / support controllers (unchanged)
                                              │  sendNotification(...)
                                              ▼
              utils/notification.js ─► push (as before) + WhatsApp (if linked)
```

| File | Purpose |
| --- | --- |
| `routes/whatsapp.routes.js` | Webhook: Meta verification (GET), incoming messages (POST). Mounted before `express.json()` because the signature check needs the raw body. |
| `services/whatsapp/bot.js` | Menu, registration and every customer flow. |
| `services/whatsapp/client.js` | Cloud API calls (text, buttons, lists, location request, link button, templates), signature check, and `notifyUserOnWhatsApp`. |
| `services/whatsapp/invoke.js` | Runs a route's middleware and controller chain in-process. |
| `models/whatsappSession.model.js` | One record per WhatsApp number: linked user, conversation state, opt-in, last message time. |
| `models/whatsappInbound.model.js` | Processed message IDs (2-day TTL), so Meta's retries are ignored. |

Changes to existing files:

- `app.js`: mounts `/api/whatsapp`.
- `utils/notification.js`: every `sendNotification` is also forwarded to WhatsApp for users with a linked, opted-in session. For everyone else it does nothing.
- `controllers/payment.controller.js`: the Flutterwave webhook now also notifies the **customer** when a payment succeeds. Before, only the driver was told. App users get a push for this as well.

## Customer features

| Menu item / keyword | What happens |
| --- | --- |
| first message | A known number (any customer whose `phone` matches) is linked automatically. Otherwise the bot asks for name and email and creates a customer account. The customer can later log into the app with that email and use "Forgot password" to set a password. |
| `book` | Pickup and drop-off (location pin, or a typed address that is geocoded and then confirmed), recipient, item type, size, description, then a quote, then Cash / Bank transfer / Card. |
| `track` | Status, rider name, phone, vehicle, ETA, and a Google Maps link to the rider's location. |
| `history` | Last 5 deliveries. |
| `chat` | Sends a message to the assigned rider through the normal delivery chat. The rider's replies arrive in WhatsApp. |
| `payment` | Shows payment status, or sends the transfer details or card link again. |
| `cancel` | Confirm, pick a reason, then `cancelDeliveryWithRefund`. |
| `rate` | Rates the last delivered, unrated delivery (1–5 stars plus an optional comment). |
| `help` | Opens a support ticket. |
| `menu` | Back to the menu at any time. `cancel` also exits any flow. |
| `STOP` / `START` | Turns WhatsApp delivery updates off or on. |

Payments:

- **Cash**: same as the app.
- **Bank transfer**: `initializeDeliveryPayment` with type `transfer` (virtual account). The existing Flutterwave webhook confirms it.
- **Card**: a Flutterwave **hosted checkout link**, using the same reference as the payment record, so the existing webhook confirms it. Card numbers are never collected in the chat.
- Unpaid card and transfer bookings are cancelled after 5 minutes by `jobs/autoExpireDeliveries.js`, as in the app.

Out of scope for now: drivers and company admins. Numbers linked to those roles are told to use the app. Errands and proof-of-delivery (POD) are also not included.

## Setup

### 1. Meta

1. Go to <https://developers.facebook.com>, create an app (type **Business**), and add the **WhatsApp** product.
2. Under **WhatsApp → API Setup**, note the **Phone number ID**. For testing, use the free test number and add your own phone as a recipient.
3. Create a **permanent access token**: Business Settings → System users → add a user → Generate token with `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on the API Setup page expires after 24 hours.
4. Under **App settings → Basic**, copy the **App secret**.
5. Under **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://riderr-backend.onrender.com/api/whatsapp/webhook`
   - Verify token: any random string. Use the same value for `WHATSAPP_VERIFY_TOKEN`.
   - Subscribe to the **messages** field.
6. For production, add and verify your real business number, then set a display name.

### 2. Environment variables (Render dashboard, not the committed `.env`)

| Variable | Required | Notes |
| --- | --- | --- |
| `WHATSAPP_TOKEN` | yes | Permanent system-user token. |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | From API Setup. |
| `WHATSAPP_APP_SECRET` | yes | Used to check webhook signatures. Without it, every webhook POST is rejected. |
| `WHATSAPP_VERIFY_TOKEN` | yes | Must match the verify token entered in Meta. |
| `WHATSAPP_UPDATE_TEMPLATE` | recommended | Name of an approved template for updates sent more than 24 hours after the customer's last message (see below). |
| `WHATSAPP_TEMPLATE_LANG` | no | Template language code. Default: `en`. |
| `WHATSAPP_API_VERSION` | no | Graph API version. Default: `v23.0`. |
| `GOOGLE_MAPS_API_KEY` | recommended | Better geocoding for typed addresses. Without it, OpenStreetMap is used. |
| `BACKEND_URL` | yes, for card | Used for the Flutterwave redirect after card payment. |

### 3. Update template (for messages outside the 24-hour window)

WhatsApp only allows free-form messages within 24 hours of the customer's last message. After that, updates such as "Rider assigned" or "Delivered" need an approved template. Create one under **WhatsApp Manager → Message templates**:

- Category: **Utility**
- Name: e.g. `delivery_update`, then set `WHATSAPP_UPDATE_TEMPLATE=delivery_update`
- Body, with exactly two variables (title, then message):

  ```
  Riderr update: {{1}}

  {{2}}

  Reply MENU to see your options.
  ```

If no template is configured, updates outside the window are skipped; push notifications still go out as before.

## Testing locally

1. Run the server (`npm run dev`) and expose it with a tunnel, e.g. `cloudflared tunnel --url http://localhost:5000`.
2. Set the webhook callback URL in Meta to `https://<tunnel>/api/whatsapp/webhook`.
3. Send "hi" to the test number from a phone you added as a recipient.

Use a test database when testing locally. The bot creates real users and deliveries.
