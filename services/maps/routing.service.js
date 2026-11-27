// services/maps/routing.service.js
// Road distance and travel time between two points, for pricing.
//
// Provider, in order of preference (first one configured wins):
//   1. Google Routes API   GOOGLE_MAPS_API_KEY   (enable "Routes API" in Google Cloud)
//   2. Mapbox Directions   MAPBOX_ACCESS_TOKEN
//   3. OSRM                OSRM_URL              (self-hosted; don't use the public demo in production)
//   4. Fallback            straight line x ROUTING_FALLBACK_FACTOR (default 1.3), 25 km/h
//
// Results are cached for 15 minutes so a quote and the booking that follows
// get the same distance (and you don't pay for the same route twice).

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map();

const haversineMeters = (a, b) => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const withTimeout = async (url, options = {}, ms = 6000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
};

const providers = {
  async google(from, to) {
    const r = await withTimeout("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE"
      })
    });
    const route = r.json?.routes?.[0];
    if (!r.ok || !route?.distanceMeters) throw new Error(`Google Routes ${r.status}: ${r.json?.error?.message || "no route"}`);
    return { distanceMeters: route.distanceMeters, durationSeconds: parseInt(String(route.duration || "0").replace("s", ""), 10) || null };
  },

  async mapbox(from, to) {
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=false&access_token=${encodeURIComponent(process.env.MAPBOX_ACCESS_TOKEN)}`;
    const r = await withTimeout(url);
    const route = r.json?.routes?.[0];
    if (!r.ok || !route?.distance) throw new Error(`Mapbox ${r.status}: ${r.json?.message || "no route"}`);
    return { distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration) };
  },

  async osrm(from, to) {
    const base = process.env.OSRM_URL.replace(/\/$/, "");
    const r = await withTimeout(`${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`);
    const route = r.json?.routes?.[0];
    if (!r.ok || !route?.distance) throw new Error(`OSRM ${r.status}: ${r.json?.message || "no route"}`);
    return { distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration) };
  }
};

const configuredProviders = () =>
  [
    process.env.GOOGLE_MAPS_API_KEY && "google",
    process.env.MAPBOX_ACCESS_TOKEN && "mapbox",
    process.env.OSRM_URL && "osrm"
  ].filter(Boolean);

const fallback = (from, to) => {
  const factor = Number(process.env.ROUTING_FALLBACK_FACTOR) || 1.3;
  const distanceMeters = Math.round(haversineMeters(from, to) * factor);
  return { distanceMeters, durationSeconds: Math.round(distanceMeters / (25000 / 3600)), provider: "estimate" };
};

const validPoint = (p) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/**
 * Road route between two { lat, lng } points.
 * Returns { distanceMeters, durationSeconds, provider }. Never throws for
 * provider problems: it falls back to an estimate so bookings keep working.
 */
export const getRoute = async (from, to) => {
  if (!validPoint(from) || !validPoint(to)) throw new Error("Invalid coordinates");

  // ~11 m precision is plenty for pricing and makes caching useful.
  const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(",");
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = null;
  for (const name of configuredProviders()) {
    try {
      value = { ...(await providers[name](from, to)), provider: name };
      break;
    } catch (e) {
      console.warn(` Routing via ${name} failed, trying next:`, e.message);
    }
  }
  if (!value) value = fallback(from, to);
  if (!value.durationSeconds) value.durationSeconds = fallback(from, to).durationSeconds;

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
};

export const routingProviderName = () => configuredProviders()[0] || "estimate";
