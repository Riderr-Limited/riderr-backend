# Priority Dispatch: who gets a delivery or ride request first

When a customer creates a delivery or a ride, Riderr no longer pings every nearby rider at once, where the first tap wins. Riders are **ranked**, and the best ones get the request first, in **waves**.

## Who can receive requests

A rider must be online, available, not suspended, not on another delivery or ride, and within `DISPATCH_RADIUS_KM` (default **10 km**) of the pickup. This applies to company riders and to individual riders alike. **Individual riders must be KYC-approved**: unapproved individuals are never offered jobs.

## How riders are ranked

| Factor | Weight | What it means |
|---|---|---|
| Rating | **50%** | Average customer rating, **weighted by number of reviews** |
| Distance | 30% | Closer to the pickup scores higher |
| Reliability | 20% | Completed jobs vs. jobs the rider cancelled or failed |

Every new rider starts as if they already had **10 reviews averaging 4.0**, and real reviews move them up or down from there. So:
- a rider with 50 reviews at 4.8 beats a rider with one 5-star review
- a proven rider beats a brand-new rider who is a bit closer
- a badly rated rider ranks low even when they're the closest

Ratings and reliability come from the rider's real delivery **and ride** history over the last 180 days. History from before this change counts too.

## Waves

| Wave | Who | When |
|---|---|---|
| 1 | Top **3** riders | Immediately (card/transfer: once paid) |
| 2 | Next **5** riders | After **30 s** with no accept |
| Final | Everyone else nearby. The request is then open to all, including riders who come online later | After another 30 s |

If **everyone in the current wave declines**, the next wave goes out straight away and doesn't wait 30 s.

Riders only see a request in their "nearby requests" list once it has been offered to them. If they try to accept one that hasn't, they get **403 `NOT_OFFERED_YET`**. Deliveries created before this change are still visible to everyone.

A background job runs every 10 seconds (`jobs/dispatchWaves.js`). It is safe to run on several servers at once.

For admins, each delivery stores `dispatch.lastRanking`: the top 20 riders with their score, distance, rating, review count and reliability, so you can see why a rider got the job.

## Settings (environment variables)

| Variable | Default | |
|---|---|---|
| `DISPATCH_PRIORITY_ENABLED` | `true` | `false` switches back to the old behaviour (everyone at once) |
| `DISPATCH_RADIUS_KM` | `10` | |
| `DISPATCH_WAVE_SIZES` | `3,5` | Sizes of the waves before the final "open to all" wave |
| `DISPATCH_WAVE_SECONDS` | `30` | |
| `DISPATCH_WEIGHT_RATING` / `_DISTANCE` / `_RELIABILITY` | `0.5` / `0.3` / `0.2` | |
| `DISPATCH_RATING_PRIOR` / `_PRIOR_WEIGHT` | `4.0` / `10` | A new rider's starting rating, and how many reviews it counts as |
| `DISPATCH_HISTORY_DAYS` | `180` | |
| `RIDE_SEARCH_TIMEOUT_MINUTES` | `5` | Rides nobody accepts are cancelled and the customer is notified |

## Rides

Rides use the same ranking and waves, with three differences:
- only riders whose **vehicle type** matches the request (`bike`, `car`, `van` or `truck`) are offered it
- rides go out straight away (they're paid at the end)
- if nobody accepts within **5 minutes**, the ride is cancelled and the customer gets a "no rider available" notification, plus a `ride:no_driver` socket event

Rider app endpoints:

| Endpoint | What it does |
|---|---|
| `GET /api/rides/driver/nearby?lat=&lng=` | Ride requests offered to this rider, nearest first |
| `POST /api/rides/:rideId/accept` | Accept. The first valid accept wins; others get **409 `RIDE_TAKEN`**. Also still confirms rides an admin or company assigned |
| `POST /api/rides/:rideId/reject` | Decline `{ reason }` |
| `POST /api/rides/:rideId/arrive` → `/start` → `/complete` | Lifecycle. Order is enforced: `accepted → arrived → started → completed`. Arrive can be skipped |

Socket events: riders get `ride:new_request`; customers get `ride:accepted` (with the rider's name, phone, plate number and vehicle) and `ride:no_driver`.

### Ride bugs fixed along the way

Rides could never have worked before this:
- **Creating a ride always failed**: the reference ID was generated after validation, which required it.
- **Starting a ride always failed**: the status `started` wasn't allowed by the model.
- Riders could only accept rides an admin had already assigned to them. Now they can claim open requests.
- Cancelling didn't record who cancelled or why, and rating saved nothing. Both now save to the right fields, and a ride can only be rated once, after it's completed.
- The fare used a distance sent by the customer's app, so a modified app could get a near-free ride. It's now calculated on the server from the coordinates, using the app's figure only if it's longer.

## Rating fix included

Customer ratings weren't being saved to riders before this change:
- Rating a delivery crashed: it assigned a number to the `rating` object.
- Rating a ride wrote to fields that don't exist, so it was silently lost.

Both now update `rating.average`, `rating.totalRatings` and `rating.breakdown` properly.

---

# Ride payments, pricing and cancellations

## Pricing uses road distance (maps routing)

`POST /api/rides/quote` `{ pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleType? }` returns the road distance, travel time and a fare for each vehicle type. Booking uses the same route (cached for 15 minutes), so the fare matches the quote. Send the quoted fare as `expectedFare` when booking; if the price has moved by more than ₦50 you get `FARE_CHANGED` and should re-quote.

The route comes from the first provider that's configured:

| Env var | Provider | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Google **Routes API** | Most accurate in Nigeria, traffic-aware. Enable "Routes API" in Google Cloud. Paid per request |
| `MAPBOX_ACCESS_TOKEN` | Mapbox Directions | Free tier: 100k requests a month |
| `OSRM_URL` | Self-hosted OSRM | Free, but you run the server |
| none | Estimate | Straight line × `ROUTING_FALLBACK_FACTOR` (1.3) |

If a provider fails, the next one is tried, and the estimate is the last resort, so bookings never break. The fare is fixed at booking: a rider can't change it at the end.

## Payments are in the app, so the commission is always collected

| `paymentMethod` | Flow |
|---|---|
| `card` (default) | The booking response includes `payment.reference`. Charge it with the existing `POST /api/payments/charge-card { reference, cardDetails }`, then `/submit-otp` or `/submit-pin` as for deliveries |
| `bank_transfer` (or `transfer`) | `POST /api/payments/initiate-bank-transfer { rideId }` returns the account to pay into. It's confirmed by the Flutterwave webhook |
| `cash` | **Off by default.** Turn it on with `RIDE_ALLOW_CASH=true`. The rider collects the fare; the commission is added to what they owe and deducted from their next in-app payout (see "Commission on cash jobs") |

- **The ride isn't sent to riders until it's paid.** The dispatch job picks it up within about 10 seconds of payment.
- Unpaid rides are cancelled after `RIDE_PAYMENT_WINDOW_MINUTES` (default 10).
- Commission: `RIDE_PLATFORM_FEE_PERCENTAGE`, or `PLATFORM_FEE_PERCENTAGE` if that isn't set.

**Payout when the ride completes:** the fare minus the commission is transferred automatically, by Flutterwave transfer:
- **Company riders:** paid to the company's bank account.
- **Individual riders:** paid to their own bank account. They add it with `PUT /api/driver/bank-account { bankCode, accountNumber, bankName }`. Flutterwave looks up the account, and **the account name must match the rider's NIN name**. If no account is set up yet, the payout waits, the rider is told to add one, and it's sent automatically as soon as they do. `GET /api/driver/bank-account` shows the saved account, masked.

Each payout can only happen once.

This also fixes **delivery** payouts for individual riders: they used to fail, because settlement only knew how to pay companies.

## Cancellations

| Who / when | What happens |
|---|---|
| **Rider** cancels after accepting (before the trip starts) | The ride goes back to `searching` and is **offered to other riders**, never to the rider who cancelled. The customer gets "Finding you another rider" (`ride:redispatched` socket event). The payment stays held. The cancellation counts against that rider's reliability score. After `RIDE_MAX_REDISPATCHES` (3), the ride is cancelled and fully refunded |
| **Customer** cancels before a rider accepts | Full refund |
| **Customer** cancels after a rider accepts | Refund minus `RIDE_CANCELLATION_FEE` (₦200) |
| Nobody accepts within 5 minutes | Cancelled and fully refunded |
| Trip already started | Can't be cancelled (`TRIP_IN_PROGRESS`); complete it or contact support |

"Refund" in this table means a refund request for the team to process manually (see below).

## Refunds are processed manually

Refunds are not sent automatically. When a paid ride or delivery is cancelled, its payment is marked **refund pending**, with the amount to return and any cancellation fee kept. The customer is told their refund will be processed within `REFUND_PROCESSING_TIME` (default "3 working days").

The team's steps:
1. `GET /api/admin/refunds` lists pending refunds, oldest first. Each entry has the customer's name and phone, the amount to refund, the fee kept, and the transaction reference to find it in the Flutterwave dashboard. Use `?status=refunded` for completed refunds, or `?status=all`.
2. Pay the customer back: refund the card from the Flutterwave dashboard, or send a bank transfer.
3. `POST /api/admin/refunds/:paymentId/complete { reference, note }` records the refund, marks the payment (and the ride or delivery) as refunded, and notifies the customer. A refund can't be recorded twice.

A payment with a pending refund is never paid out to a rider. A payment that has already been paid out can't be refunded through this endpoint; recover the money from the rider or company first.

The older `POST /api/admin/payments/:paymentId/refund { amount, reason, reference }` does the same as `/complete`. Before, it silently saved nothing.

To go back to automatic Flutterwave refunds, set `REFUND_MODE=auto`.

## Commission on cash jobs

With cash, the rider keeps the whole fare, so Riderr's commission (`PLATFORM_FEE_PERCENTAGE`) is added to what the rider owes (`Driver.commission.owed`):
- **Cash deliveries:** recorded when the rider marks the delivery delivered. Before, the cash payment record failed to save (it used an invalid `paymentType`), so no commission was recorded and customers couldn't confirm cash deliveries.
- **Cash rides** (only if `RIDE_ALLOW_CASH=true`): recorded when the ride completes.

**The next time the rider is paid out for a card or transfer job, what they owe is deducted first.** If they owe more than that payout, the whole payout goes to the debt and the rest stays owed. If the transfer fails, the deduction is cancelled. Each cash job shows `metadata.commissionStatus` as `owed`, `partly_paid` or `paid`. For company riders, the deduction comes out of the company's payout for that rider's job.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/driver/commission` | Rider | What they owe and the cash jobs it comes from |
| `GET /api/admin/commissions` | Admin | Riders who owe commission, most owed first, plus the total |
| `GET /api/admin/commissions/:driverId` | Admin | One rider's breakdown |
| `POST /api/admin/commissions/:driverId/settle { amount, note }` | Admin | Record commission a rider paid Riderr directly (e.g. by transfer). Capped at what they owe |
| `POST /api/driver/commission/pay { method, amount? }` | Rider | Pay what they owe in the app (see below) |

### Limit on what a rider can owe

Once a rider owes more than `COMMISSION_OWED_LIMIT` (default ₦5,000; `0` turns it off):
- They're taken offline right away and told why.
- They can't go online, accept rides or deliveries, or be offered jobs by dispatch. The error code is `COMMISSION_LIMIT_REACHED`, with the amount owed and the limit.
- They can work again once they've paid enough to be at or under the limit. A payout deduction or an admin-recorded payment also counts.

### Riders paying in the app

`POST /api/driver/commission/pay` takes `{ method: "card" | "bank_transfer", amount? }`. The amount defaults to everything owed; the minimum is ₦100.
- **Card:** returns a `reference`. Charge it with the usual `POST /api/payments/charge-card { reference, cardDetails }`, then `/submit-otp` or `/submit-pin` if asked.
- **Bank transfer:** returns a one-off Flutterwave account to transfer into. There's no fallback account: if Flutterwave can't create one, the rider is asked to pay by card instead.
- **Confirmation:** check `GET /api/payments/status/:reference`, or `GET /api/driver/commission`. However the payment is confirmed (webhook, OTP, PIN), it's applied once, and the rider is notified.
- **Overpayment:** if the rider pays more than they still owe (for example, a payout deduction cleared some of it in the meantime), the extra goes to the manual refund queue.

## Individual riders must add a bank account

Individual riders are paid straight to their own bank account, so they can't go online, accept jobs, or be offered jobs until they've added and verified one with `PUT /api/driver/bank-account`. The error code is `BANK_ACCOUNT_REQUIRED`. This comes after KYC: `GET /api/kyc/status` returns `nextStep: "add_bank_account"` and `canWork: false` until it's done. Company riders are paid through their company and aren't affected.

## Bank transfers never show a placeholder account

If Flutterwave can't create a one-off account, customers are shown Riderr's own account only when `PLATFORM_BANK_NAME`, `PLATFORM_ACCOUNT_NUMBER` and `PLATFORM_ACCOUNT_NAME` are all set to a real account. Otherwise they get `503 TRANSFER_UNAVAILABLE` ("please pay by card"). Placeholder numbers such as `1012345678` are refused. Customers are also no longer sent to the delivery company's own account, which skipped the commission and paid the company twice.

## Payments are checked against the amount actually paid

The Flutterwave webhook no longer trusts the request body alone. It looks the transaction up with Flutterwave and only marks the payment paid if the full amount was paid in naira. Manual verification (`GET /api/payments/verify/:reference`) does the same check. An underpayment is recorded in `metadata.amountMismatch`, and the job stays unpaid.

## Payouts are safe against double payment

Delivery settlement now records the customer's confirmation first, and only then sends money. Every payout (rides and deliveries) goes through one function, which claims the payment before transferring. So the money can't be sent twice, even if two requests arrive together or something fails after the transfer.
- If the transfer fails, the delivery still completes, and the customer sees "the payout will be completed shortly".
- `GET /api/admin/payouts?status=failed` lists failed payouts. `POST /api/admin/payouts/:paymentId/retry` sends one again.
- A payout stuck in `processing` (the server stopped mid-payout) is only resent with `{ confirmedNotSent: true }`, after you've checked in Flutterwave that no transfer went out.
- Individual riders' failed payouts are also retried automatically when they add a bank account.

## Security fixes in this change

- The Flutterwave webhook **accepted any request when `FLW_SECRET_HASH` was missing**, so anyone could mark a payment as paid. In production it now rejects all webhooks if the hash isn't set.
- `initiateTransfer` logged the first 10 characters of `FLW_SECRET_KEY` on every payout. Removed.
