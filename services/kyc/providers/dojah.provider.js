// services/kyc/providers/dojah.provider.js
// Dojah (https://dojah.io) adapter for Nigerian NIN and face checks.
//
// Env:
//   DOJAH_APP_ID, DOJAH_SECRET_KEY
//   DOJAH_BASE_URL  (default https://sandbox.dojah.io; production is https://api.dojah.io)
//
// Endpoints used (confirm against your Dojah dashboard and docs when you get keys):
//   GET  /api/v1/kyc/nin?nin=...            NIN lookup
//   POST /api/v1/kyc/nin/verify             NIN + selfie face match  { nin, selfie_image }
//   POST /api/v1/ml/liveness                liveness check           { image }
//
// Parsing is defensive: if a field we rely on is missing, the check is treated
// as NOT passed (sent to manual review), never as passed.

const BASE_URL = () => (process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io").replace(/\/$/, "");

const headers = () => {
  const appId = process.env.DOJAH_APP_ID;
  const secret = process.env.DOJAH_SECRET_KEY;
  if (!appId || !secret) throw new Error("DOJAH_APP_ID and DOJAH_SECRET_KEY must be set");
  return { AppId: appId, Authorization: secret, "Content-Type": "application/json", Accept: "application/json" };
};

const request = async (method, path, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${BASE_URL()}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
};

// Dojah wants raw base64 without the data URL prefix.
const stripDataUrl = (b64) => String(b64).replace(/^data:image\/[a-zA-Z]+;base64,/, "");

// Dojah reports confidence as 0-100; normalise to 0-1.
const toUnit = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v > 1 ? v / 100 : v;
};

const providerError = (what, r) => {
  const err = new Error(`Dojah ${what} failed (HTTP ${r.status}): ${r.json?.error || r.json?.message || "no details"}`);
  err.isProviderError = true;
  err.httpStatus = r.status;
  return err;
};

export default {
  name: "dojah",

  async lookupNin(nin) {
    const r = await request("GET", `/api/v1/kyc/nin?nin=${encodeURIComponent(nin)}`);
    if (r.status === 404 || (r.status === 400 && /not\s*found/i.test(JSON.stringify(r.json || "")))) {
      return { found: false };
    }
    if (!r.ok) throw providerError("NIN lookup", r);
    const e = r.json?.entity;
    if (!e) return { found: false };
    return {
      found: true,
      firstName: e.first_name || e.firstname || "",
      middleName: e.middle_name || e.middlename || "",
      lastName: e.last_name || e.surname || e.lastname || "",
      dateOfBirth: e.date_of_birth || e.birthdate || null,
      gender: e.gender || null,
      phone: e.phone_number || e.telephoneno || null,
      providerRef: r.json?.reference_id || null
    };
  },

  async checkLiveness(selfieBase64) {
    const r = await request("POST", "/api/v1/ml/liveness", { image: stripDataUrl(selfieBase64) });
    if (!r.ok) throw providerError("liveness", r);
    const l = r.json?.entity?.liveness || r.json?.entity || {};
    const score = toUnit(l.liveness_probability ?? l.confidence);
    return {
      live: l.liveness_check === true,
      score,
      providerRef: r.json?.reference_id || null
    };
  },

  async matchSelfieToNin(nin, selfieBase64) {
    const liveness = await this.checkLiveness(selfieBase64);

    const r = await request("POST", "/api/v1/kyc/nin/verify", {
      nin,
      selfie_image: stripDataUrl(selfieBase64)
    });
    if (!r.ok) throw providerError("NIN selfie match", r);
    const sv = r.json?.entity?.selfie_verification || {};
    return {
      live: liveness.live,
      livenessScore: liveness.score,
      match: sv.match === true,
      matchScore: toUnit(sv.confidence_value),
      providerRef: r.json?.reference_id || liveness.providerRef || null
    };
  }
};
