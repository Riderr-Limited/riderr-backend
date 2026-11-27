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
