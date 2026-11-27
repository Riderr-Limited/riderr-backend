// services/kyc/kyc.service.js
// Identity verification for INDIVIDUAL riders (onboardingType = "individual").
// Company riders are vouched for by their company and never go through this.
//
// Flow:  consent + NIN  ->  selfie (liveness + match to NIN photo)  ->
//        2 guarantors confirm (phone OTP + their own NIN)  ->  admin approves
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

import Driver from "../../models/riders.models.js";
import Guarantor from "../../models/guarantor.model.js";
import VerificationServices from "../verification.services.js";
import { sendNotification } from "../../utils/notification.js";
import { encrypt, decrypt, hashIdentifier, generateToken, sha256 } from "../../utils/kycCrypto.js";
import { getKycProvider, kycConfig } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Outside /uploads, which index.js serves publicly. Never expose this folder.
export const PRIVATE_KYC_DIR = path.join(__dirname, "..", "..", "private_uploads", "kyc");

const ACTIVE_GUARANTOR_STATUSES = ["invited", "phone_verified", "confirmed"];
const MAX_OTP_ATTEMPTS = 5;
const MAX_GUARANTOR_NIN_ATTEMPTS = 3;
const DEV_OTP = "123456";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export class KycError extends Error {
  constructor(message, statusCode = 400, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const tokens = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1);

/**
 * 1   = first AND last name on the NIN both appear in the name we were given
 * 0.5 = only one of them appears (send to a human)
 * 0   = neither appears
 */
export const nameMatchScore = (givenName, { firstName, middleName, lastName }) => {
  const given = new Set(tokens(givenName));
  const first = tokens(firstName);
  const last = tokens(lastName);
  const middle = tokens(middleName);
  const hasFirst = first.some((t) => given.has(t));
  const hasLast = last.some((t) => given.has(t));
  if (hasFirst && hasLast) return 1;
  // People often use a middle name as their first name in Nigeria.
  const hasMiddle = middle.some((t) => given.has(t));
  if ((hasFirst || hasMiddle) && hasLast) return 1;
  if (hasFirst || hasLast || hasMiddle) return 0.5;
  return 0;
};

/** Normalise Nigerian phone numbers to +234XXXXXXXXXX. Returns null if invalid. */
export const normaliseNgPhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  let local;
  if (digits.startsWith("234") && digits.length === 13) local = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 11) local = digits.slice(1);
  else if (digits.length === 10) local = digits;
  else return null;
  if (!/^[789]\d{9}$/.test(local)) return null;
  return `+234${local}`;
};

const validNin = (nin) => /^\d{11}$/.test(String(nin || ""));

const log = (driver, action, by, note) => {
  driver.kyc.history.push({ action, by, note, at: new Date() });
};

const notify = async (userId, title, message, data = {}, subType = "verification") => {
  try {
    await sendNotification({ userId, type: "driver", subType, title, message, data: { kind: "kyc", ...data }, priority: "high" });
  } catch (e) {
    console.error("KYC notification failed:", e.message);
  }
};

const loadIndividualDriver = async (userId, extraSelect = "") => {
  const driver = await Driver.findOne({ userId }).select(extraSelect);
  if (!driver) throw new KycError("Rider profile not found", 404);
  if (driver.onboardingType !== "individual") {
    throw new KycError("Company riders are verified by their company and don't need this step", 400, "NOT_INDIVIDUAL");
  }
  return driver;
};

const assertEditable = (driver) => {
  if (driver.kyc.status === "approved") throw new KycError("Your verification is already approved", 400, "ALREADY_APPROVED");
  if (driver.kyc.status === "rejected") {
    throw new KycError("Your verification was rejected. Please contact support.", 403, "REJECTED");
  }
};

/** Move the overall status forward based on the individual checks. */
const recomputeStatus = (driver) => {
  const k = driver.kyc;
  if (["approved", "rejected"].includes(k.status)) return;
  const ok = (s) => s === "passed" || s === "manual_review";
  if (ok(k.nin.status) && ok(k.face.status) && k.guarantors.status === "passed") {
    if (k.status !== "pending_review") {
      k.status = "pending_review";
      k.submittedAt = new Date();
    }
  } else {
    k.status = "in_progress";
  }
};

const refreshGuarantorSummary = async (driver) => {
  const { requiredGuarantors } = kycConfig();
  const list = await Guarantor.find({ driverId: driver._id });
  const confirmed = list.filter((g) => g.status === "confirmed").length;
  driver.kyc.guarantors.required = requiredGuarantors;
  driver.kyc.guarantors.confirmedCount = confirmed;
  driver.kyc.guarantors.status =
    confirmed >= requiredGuarantors ? "passed" : list.some((g) => ACTIVE_GUARANTOR_STATUSES.includes(g.status)) ? "pending" : "not_started";
};

const guarantorLink = (token) => `${kycConfig().publicAppUrl}/guarantor/${token}`;

// ---------------------------------------------------------------------------
// rider: status
// ---------------------------------------------------------------------------

export const getStatus = async (userId) => {
  const driver = await Driver.findOne({ userId });
  if (!driver) throw new KycError("Rider profile not found", 404);

  if (driver.onboardingType !== "individual") {
    return { onboardingType: "company", required: false, canWork: true, message: "Verified through your company" };
  }

  const guarantors = await Guarantor.find({ driverId: driver._id }).sort({ createdAt: 1 });
  const k = driver.kyc;
  const { requiredGuarantors, maxNinAttempts, maxFaceAttempts } = kycConfig();

  let nextStep = null;
  if (k.status === "approved") nextStep = null;
  else if (k.status === "rejected") nextStep = "contact_support";
  else if (!["passed", "manual_review"].includes(k.nin.status)) nextStep = "submit_nin";
  else if (!["passed", "manual_review"].includes(k.face.status)) nextStep = "submit_selfie";
  else if (k.guarantors.status !== "passed") nextStep = "add_guarantors";
  else nextStep = "await_review";

  return {
    onboardingType: "individual",
    required: true,
    status: k.status,
    canWork: driver.isKycCleared(),
    nextStep,
    rejectionReason: k.status === "rejected" ? k.rejectionReason : undefined,
    checks: {
      nin: {
        status: k.nin.status,
        last4: k.nin.last4,
        attemptsLeft: Math.max(0, maxNinAttempts - k.nin.attempts),
        failureReason: k.nin.failureReason
      },
      face: {
        status: k.face.status,
        attemptsLeft: Math.max(0, maxFaceAttempts - k.face.attempts),
        failureReason: k.face.failureReason
      },
      guarantors: {
        status: k.guarantors.status,
        required: requiredGuarantors,
        confirmed: k.guarantors.confirmedCount,
        list: guarantors.map((g) => ({
          id: g._id,
          name: g.name,
          phone: g.phone,
          relationship: g.relationship,
          status: g.status,
          linkExpiresAt: g.tokenExpiresAt,
          failureReason: g.failureReason
        }))
      }
    }
  };
};

// ---------------------------------------------------------------------------
// rider: step 1, NIN
// ---------------------------------------------------------------------------

export const submitNin = async (user, { nin, consent }, ip) => {
  if (consent !== true) {
    throw new KycError("You must agree to let Riderr verify your identity with NIMC", 400, "CONSENT_REQUIRED");
  }
  nin = String(nin || "").trim();
  if (!validNin(nin)) throw new KycError("NIN must be exactly 11 digits", 400, "INVALID_NIN");

  const driver = await loadIndividualDriver(user._id, "+kyc.nin.hash +kyc.nin.encrypted");
  assertEditable(driver);
  const { maxNinAttempts } = kycConfig();
  const k = driver.kyc;

  if (k.nin.status === "passed") throw new KycError("Your NIN is already verified", 400, "NIN_ALREADY_VERIFIED");
  if (k.nin.attempts >= maxNinAttempts) {
    throw new KycError("Too many NIN attempts. Please contact support.", 429, "NIN_ATTEMPTS_EXCEEDED");
  }

  const hash = hashIdentifier(nin);
  const taken = await Driver.exists({ _id: { $ne: driver._id }, "kyc.nin.hash": hash });
  if (taken) {
    throw new KycError("This NIN is already linked to another Riderr account. Contact support if this is a mistake.", 409, "NIN_IN_USE");
  }

  const provider = getKycProvider();
  const result = await provider.lookupNin(nin, { hintName: user.name });

  k.nin.attempts += 1;
  k.consentAt = k.consentAt || new Date();
  k.consentIp = k.consentIp || ip;

  if (!result.found) {
    k.nin.status = "failed";
    k.nin.failureReason = "NIN not found on the NIMC database";
    k.nin.encrypted = undefined;
    k.nin.hash = undefined;
    log(driver, "nin_failed", user._id, k.nin.failureReason);
    recomputeStatus(driver);
    await driver.save();
    throw new KycError("We couldn't find that NIN. Please check the number and try again.", 400, "NIN_NOT_FOUND");
  }

  const score = nameMatchScore(user.name, result);
  k.nin.nameMatchScore = score;
  k.nin.providerName = { firstName: result.firstName, middleName: result.middleName, lastName: result.lastName };
  k.nin.dateOfBirth = result.dateOfBirth;
  k.nin.providerRef = result.providerRef;
  k.nin.last4 = nin.slice(-4);

  if (score === 0) {
    // Don't keep the NIN: it belongs to someone else, and keeping the hash would
    // block the real owner from ever signing up.
    k.nin.status = "failed";
    k.nin.failureReason = "Name on NIN does not match your account name";
    k.nin.encrypted = undefined;
    k.nin.hash = undefined;
    log(driver, "nin_failed", user._id, k.nin.failureReason);
  } else {
    k.nin.status = score === 1 ? "passed" : "manual_review";
    k.nin.failureReason = score === 1 ? undefined : "Name only partly matches. A reviewer will check it.";
    k.nin.encrypted = encrypt(nin);
    k.nin.hash = hash;
    k.nin.verifiedAt = new Date();
    log(driver, `nin_${k.nin.status}`, user._id);
  }

  recomputeStatus(driver);
  try {
    await driver.save();
  } catch (e) {
    if (e.code === 11000) throw new KycError("This NIN is already linked to another Riderr account.", 409, "NIN_IN_USE");
    throw e;
  }

  if (k.nin.status === "failed") {
    throw new KycError(
      "The name on this NIN doesn't match the name on your account. Update your account name to match your NIN, then try again.",
      400,
      "NIN_NAME_MISMATCH"
    );
  }
  return getStatus(user._id);
};

// ---------------------------------------------------------------------------
// rider: step 2, selfie
// ---------------------------------------------------------------------------

export const submitSelfie = async (user, file) => {
  if (!file?.buffer) throw new KycError("A selfie image is required", 400, "SELFIE_REQUIRED");

  const driver = await loadIndividualDriver(user._id, "+kyc.nin.encrypted +kyc.face.selfiePath");
  assertEditable(driver);
  const k = driver.kyc;
  const { maxFaceAttempts, faceMatchThreshold } = kycConfig();

  if (!["passed", "manual_review"].includes(k.nin.status) || !k.nin.encrypted) {
    throw new KycError("Verify your NIN first", 400, "NIN_REQUIRED");
  }
  if (k.face.status === "passed") throw new KycError("Your face is already verified", 400, "FACE_ALREADY_VERIFIED");
  if (k.face.attempts >= maxFaceAttempts) {
    throw new KycError("Too many selfie attempts. Please contact support.", 429, "FACE_ATTEMPTS_EXCEEDED");
  }

  // Re-encode: proves it's a real image, fixes rotation, strips EXIF (GPS etc).
  let jpeg;
  try {
    jpeg = await sharp(file.buffer).rotate().resize({ width: 1280, height: 1280, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    throw new KycError("That file isn't a valid image", 400, "INVALID_IMAGE");
  }

  const nin = decrypt(k.nin.encrypted);
  const provider = getKycProvider();
  const result = await provider.matchSelfieToNin(nin, jpeg.toString("base64"));

  const dir = path.join(PRIVATE_KYC_DIR, String(driver._id));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `selfie-${Date.now()}.jpg`);
  await fs.writeFile(filePath, jpeg);

  k.face.attempts += 1;
  k.face.selfiePath = path.relative(PRIVATE_KYC_DIR, filePath);
  k.face.livenessScore = result.livenessScore;
  k.face.matchScore = result.matchScore;
  k.face.providerRef = result.providerRef;

  let message;
  if (!result.live) {
    k.face.status = "failed";
    k.face.failureReason = "Liveness check failed. Take a live selfie, not a photo of a photo or screen.";
    message = k.face.failureReason;
  } else if (result.match && (result.matchScore ?? 0) >= faceMatchThreshold) {
    k.face.status = "passed";
    k.face.failureReason = undefined;
    k.face.verifiedAt = new Date();
  } else if (result.matchScore == null || result.matchScore >= faceMatchThreshold - 0.2) {
    k.face.status = "manual_review";
    k.face.failureReason = "Face match was unclear. A reviewer will check it.";
  } else {
    k.face.status = "failed";
    k.face.failureReason = "Your selfie doesn't match your NIN photo.";
    message = "Your selfie doesn't match your NIN photo. Use good lighting, face the camera and remove glasses or caps.";
  }

  log(driver, `face_${k.face.status}`, user._id);
  recomputeStatus(driver);
  await driver.save();

  if (k.face.status === "failed") throw new KycError(message, 400, "FACE_FAILED");
  return getStatus(user._id);
};

// ---------------------------------------------------------------------------
// rider: step 3, guarantors
// ---------------------------------------------------------------------------

export const addGuarantors = async (user, list) => {
  const driver = await loadIndividualDriver(user._id);
  assertEditable(driver);
  if (!["passed", "manual_review"].includes(driver.kyc.nin.status)) {
    throw new KycError("Verify your NIN before adding guarantors", 400, "NIN_REQUIRED");
  }
  if (!Array.isArray(list) || list.length === 0) throw new KycError("Add at least one guarantor", 400);

  const { requiredGuarantors, guarantorLinkTtlHours } = kycConfig();
  const existing = await Guarantor.find({ driverId: driver._id, status: { $in: ACTIVE_GUARANTOR_STATUSES } });
  if (existing.length + list.length > requiredGuarantors) {
    throw new KycError(`You can only have ${requiredGuarantors} guarantors. Remove one first.`, 400, "TOO_MANY_GUARANTORS");
  }

  const riderPhone = normaliseNgPhone(user.phone);
  const seen = new Set(existing.map((g) => g.phone));
  const relationships = Guarantor.schema.path("relationship").enumValues;

  const prepared = list.map((g, i) => {
    const label = `Guarantor ${i + 1}`;
    const name = String(g?.name || "").trim();
    if (tokens(name).length < 2) throw new KycError(`${label}: enter their full name as on their NIN`, 400);
    const phone = normaliseNgPhone(g.phone);
    if (!phone) throw new KycError(`${label}: enter a valid Nigerian phone number`, 400);
    if (phone === riderPhone) throw new KycError(`${label}: you can't be your own guarantor`, 400);
    if (seen.has(phone)) throw new KycError(`${label}: this phone number is already one of your guarantors`, 400);
    seen.add(phone);
    if (!relationships.includes(g.relationship)) {
      throw new KycError(`${label}: relationship must be one of ${relationships.join(", ")}`, 400);
    }
    return { name, phone, relationship: g.relationship, email: g.email, address: g.address, occupation: g.occupation };
  });

  const created = [];
  for (const g of prepared) {
    const { token, tokenHash } = generateToken();
    const doc = await Guarantor.create({
      ...g,
      driverId: driver._id,
      tokenHash,
      tokenExpiresAt: new Date(Date.now() + guarantorLinkTtlHours * 3600 * 1000)
    });
    created.push({ id: doc._id, name: doc.name, phone: doc.phone, link: guarantorLink(token), expiresAt: doc.tokenExpiresAt });
  }

  log(driver, "guarantors_added", user._id, `${created.length} added`);
  await refreshGuarantorSummary(driver);
  recomputeStatus(driver);
  await driver.save();

  // The raw links are only returned now. The rider shares them (SMS/WhatsApp).
  return { guarantors: created, status: await getStatus(user._id) };
};

export const regenerateGuarantorLink = async (user, guarantorId) => {
  const driver = await loadIndividualDriver(user._id);
  assertEditable(driver);
  const g = await Guarantor.findOne({ _id: guarantorId, driverId: driver._id });
  if (!g) throw new KycError("Guarantor not found", 404);
  if (!["invited", "phone_verified"].includes(g.status)) {
    throw new KycError(`This guarantor is already ${g.status}`, 400);
  }
  const { token, tokenHash } = generateToken();
  g.tokenHash = tokenHash;
  g.tokenExpiresAt = new Date(Date.now() + kycConfig().guarantorLinkTtlHours * 3600 * 1000);
  await g.save();
  return { id: g._id, link: guarantorLink(token), expiresAt: g.tokenExpiresAt };
};

export const removeGuarantor = async (user, guarantorId) => {
  const driver = await loadIndividualDriver(user._id);
  assertEditable(driver);
  const g = await Guarantor.findOne({ _id: guarantorId, driverId: driver._id });
  if (!g) throw new KycError("Guarantor not found", 404);
  if (g.status === "confirmed" && driver.kyc.status === "pending_review") {
    throw new KycError("You can't remove a confirmed guarantor while your application is under review", 400);
  }
  g.status = "revoked";
  await g.save();
  log(driver, "guarantor_removed", user._id, g.name);
  await refreshGuarantorSummary(driver);
  recomputeStatus(driver);
  await driver.save();
  return getStatus(user._id);
};

// ---------------------------------------------------------------------------
// public: guarantor confirms through their link
// ---------------------------------------------------------------------------

const loadByToken = async (token, extraSelect = "") => {
  if (!token || typeof token !== "string" || token.length > 100) throw new KycError("Invalid link", 404);
  const g = await Guarantor.findOne({ tokenHash: sha256(token) }).select(extraSelect);
  if (!g) throw new KycError("This link is invalid", 404, "INVALID_LINK");
  if (g.tokenExpiresAt < new Date() && !["confirmed", "declined"].includes(g.status)) {
    throw new KycError("This link has expired. Ask the rider to send you a new one.", 410, "LINK_EXPIRED");
  }
  if (g.status === "revoked") throw new KycError("This request was cancelled by the rider", 410, "REVOKED");
  return g;
};

const riderSummary = async (driverId) => {
  const driver = await Driver.findById(driverId).populate("userId", "name");
  const parts = tokens(driver?.userId?.name);
  // Show first name and last initial only.
  const display = driver?.userId?.name
    ? `${driver.userId.name.trim().split(/\s+/)[0]} ${parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() + "." : ""}`.trim()
    : "A rider";
  return { driver, display };
};

export const getGuarantorInvite = async (token) => {
  const g = await loadByToken(token);
  const { display } = await riderSummary(g.driverId);
  return {
    riderName: display,
    guarantorName: g.name,
    relationship: g.relationship,
    status: g.status,
    phoneHint: g.phone.replace(/^(\+234\d{3})\d{4}(\d{3})$/, "$1****$2"),
    expiresAt: g.tokenExpiresAt,
    responsibilities: [
      "You confirm that you know this person and they are of good character.",
      "Riderr may contact you if the rider breaks the rules or goes missing with goods.",
      "Your NIN will be checked with NIMC to confirm your identity."
    ]
  };
};

const twilioReady = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);

export const sendGuarantorOtp = async (token) => {
  const g = await loadByToken(token);
  if (g.status !== "invited") throw new KycError(`Already ${g.status.replace("_", " ")}`, 400);
  if (g.otpAttempts >= MAX_OTP_ATTEMPTS) throw new KycError("Too many attempts. Ask the rider for a new link.", 429);

  if (twilioReady()) {
    await VerificationServices.sendPhoneVerification(g.phone);
    return { sent: true, phoneHint: g.phone.replace(/^(\+234\d{3})\d{4}(\d{3})$/, "$1****$2") };
  }
  if (process.env.NODE_ENV === "production") throw new KycError("SMS is not configured", 503);
  console.warn(`[KYC dev] Twilio not configured. Guarantor OTP for ${g.phone} is ${DEV_OTP}`);
  return { sent: true, devMode: true, devCode: DEV_OTP };
};

export const verifyGuarantorOtp = async (token, code) => {
  const g = await loadByToken(token);
  if (g.status !== "invited") throw new KycError(`Already ${g.status.replace("_", " ")}`, 400);
  if (g.otpAttempts >= MAX_OTP_ATTEMPTS) throw new KycError("Too many attempts. Ask the rider for a new link.", 429);
  if (!/^\d{4,8}$/.test(String(code || ""))) throw new KycError("Enter the code sent to your phone", 400);

  g.otpAttempts += 1;
  let ok;
  if (twilioReady()) {
    try {
      ok = (await VerificationServices.verifyPhoneCode(g.phone, String(code))).success;
    } catch {
      ok = false;
    }
  } else {
    ok = process.env.NODE_ENV !== "production" && String(code) === DEV_OTP;
  }

  if (!ok) {
    await g.save();
    throw new KycError("Wrong or expired code", 400, "BAD_OTP");
  }
  g.status = "phone_verified";
  g.phoneVerifiedAt = new Date();
  await g.save();
  return { status: g.status };
};

export const respondAsGuarantor = async (token, { accept, nin, consent }, ip) => {
  const g = await loadByToken(token, "+nin.hash +nin.encrypted");
  if (g.status !== "phone_verified") {
    throw new KycError(g.status === "invited" ? "Verify your phone number first" : `Already ${g.status}`, 400);
  }

  if (accept === false) {
    g.status = "declined";
    g.declinedAt = new Date();
    await g.save();
    const { driver } = await riderSummary(g.driverId);
    if (driver) {
      await refreshGuarantorSummary(driver);
      recomputeStatus(driver);
      await driver.save();
      await notify(driver.userId._id, "Guarantor declined", `${g.name} declined to be your guarantor. Please add someone else.`);
    }
    return { status: g.status };
  }

  if (accept !== true) throw new KycError("Choose whether you accept to be a guarantor", 400);
  if (consent !== true) throw new KycError("You must agree to let Riderr verify your NIN with NIMC", 400, "CONSENT_REQUIRED");
  nin = String(nin || "").trim();
  if (!validNin(nin)) throw new KycError("NIN must be exactly 11 digits", 400, "INVALID_NIN");
  if (g.ninAttempts >= MAX_GUARANTOR_NIN_ATTEMPTS) {
    throw new KycError("Too many attempts. Ask the rider for a new link.", 429);
  }

  const { driver } = await riderSummary(g.driverId);
  if (!driver) throw new KycError("Rider not found", 404);
  const riderWithNin = await Driver.findById(driver._id).select("+kyc.nin.hash");

  const hash = hashIdentifier(nin);
  if (riderWithNin?.kyc?.nin?.hash === hash) throw new KycError("A rider can't be their own guarantor", 400);

  // Stop one person from guaranteeing lots of riders.
  const { maxRidersPerGuarantor } = kycConfig();
  const activeElsewhere = await Guarantor.countDocuments({
    _id: { $ne: g._id },
    status: "confirmed",
    "nin.hash": hash
  });
  if (activeElsewhere >= maxRidersPerGuarantor) {
    throw new KycError(
      `You are already a guarantor for ${activeElsewhere} riders, which is the maximum.`,
      400,
      "GUARANTOR_LIMIT"
    );
  }

  g.ninAttempts += 1;
  const result = await getKycProvider().lookupNin(nin, { hintName: g.name });
  const score = result.found ? nameMatchScore(g.name, result) : 0;

  if (!result.found || score < 1) {
    const left = MAX_GUARANTOR_NIN_ATTEMPTS - g.ninAttempts;
    if (left <= 0) {
      g.status = "failed";
      g.failureReason = result.found ? "Name did not match NIN" : "NIN not found";
    }
    await g.save();
    if (g.status === "failed") {
      await refreshGuarantorSummary(driver);
      recomputeStatus(driver);
      await driver.save();
      await notify(driver.userId._id, "Guarantor check failed", `We couldn't verify ${g.name}. Please add another guarantor.`);
    }
    throw new KycError(
      result.found
        ? `The name on this NIN doesn't match "${g.name}". ${left > 0 ? `${left} attempt(s) left.` : ""}`.trim()
        : `NIN not found. ${left > 0 ? `${left} attempt(s) left.` : ""}`.trim(),
      400,
      "GUARANTOR_NIN_FAILED"
    );
  }

  g.nin = {
    encrypted: encrypt(nin),
    hash,
    last4: nin.slice(-4),
    nameMatchScore: score,
    providerRef: result.providerRef
  };
  g.status = "confirmed";
  g.confirmedAt = new Date();
  g.consentAt = new Date();
  g.consentIp = ip;
  g.failureReason = undefined;
  await g.save();

  await refreshGuarantorSummary(driver);
  log(driver, "guarantor_confirmed", undefined, g.name);
  recomputeStatus(driver);
  await driver.save();

  await notify(driver.userId._id, "Guarantor confirmed", `${g.name} has confirmed as your guarantor.`);
  if (driver.kyc.status === "pending_review") {
    await notify(driver.userId._id, "Verification submitted", "All checks are done. Our team will review your application shortly.");
  }
  return { status: g.status };
};

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

export const listQueue = async ({ status = "pending_review", page = 1, limit = 20 }) => {
  page = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const allowed = ["not_started", "in_progress", "pending_review", "approved", "rejected"];
  const query = { onboardingType: "individual" };
  if (status !== "all") {
    if (!allowed.includes(status)) throw new KycError(`status must be one of all, ${allowed.join(", ")}`);
    query["kyc.status"] = status;
  }
  const [items, total] = await Promise.all([
    Driver.find(query)
      .select("userId vehicleType plateNumber kyc.status kyc.submittedAt kyc.nin.status kyc.face.status kyc.guarantors createdAt")
      .populate("userId", "name email phone")
      .sort({ "kyc.submittedAt": 1, createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Driver.countDocuments(query)
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const loadForAdmin = async (driverId) => {
  const driver = await Driver.findById(driverId).populate("userId", "name email phone");
  if (!driver) throw new KycError("Rider not found", 404);
  if (driver.onboardingType !== "individual") throw new KycError("This is a company rider; KYC doesn't apply", 400);
  return driver;
};

export const getReviewDetail = async (driverId) => {
  const driver = await loadForAdmin(driverId);
  const guarantors = await Guarantor.find({ driverId: driver._id }).sort({ createdAt: 1 });
  return {
    driver: {
      id: driver._id,
      user: driver.userId,
      vehicleType: driver.vehicleType,
      plateNumber: driver.plateNumber,
      vehicleColor: driver.vehicleColor,
      documents: driver.documents,
      approvalStatus: driver.approvalStatus,
      createdAt: driver.createdAt
    },
    kyc: driver.kyc,
    selfieUrl: `/api/admin/kyc/${driver._id}/selfie`,
    guarantors: guarantors.map((g) => ({
      id: g._id,
      name: g.name,
      phone: g.phone,
      email: g.email,
      relationship: g.relationship,
      address: g.address,
      occupation: g.occupation,
      status: g.status,
      ninLast4: g.nin?.last4,
      phoneVerifiedAt: g.phoneVerifiedAt,
      confirmedAt: g.confirmedAt,
      failureReason: g.failureReason
    }))
  };
};

export const getSelfieFile = async (driverId) => {
  const driver = await Driver.findById(driverId).select("+kyc.face.selfiePath");
  const rel = driver?.kyc?.face?.selfiePath;
  if (!rel) throw new KycError("No selfie on file", 404);
  const full = path.resolve(PRIVATE_KYC_DIR, rel);
  if (!full.startsWith(path.resolve(PRIVATE_KYC_DIR) + path.sep)) throw new KycError("Invalid path", 400);
  try {
    await fs.access(full);
  } catch {
    throw new KycError("Selfie file is missing from storage", 404);
  }
  return full;
};

/** Admin settles a check that went to manual_review (or overrides one). */
export const resolveCheck = async (driverId, check, status, note, admin) => {
  if (!["nin", "face"].includes(check)) throw new KycError("check must be nin or face");
  if (!["passed", "failed"].includes(status)) throw new KycError("status must be passed or failed");
  if (!note || String(note).trim().length < 3) throw new KycError("A note explaining the decision is required");

  const driver = await loadForAdmin(driverId);
  if (["approved", "rejected"].includes(driver.kyc.status)) throw new KycError(`Already ${driver.kyc.status}`);
  driver.kyc[check].status = status;
  driver.kyc[check].failureReason = status === "failed" ? note : undefined;
  if (status === "passed") driver.kyc[check].verifiedAt = new Date();
  log(driver, `admin_${check}_${status}`, admin._id, note);
  recomputeStatus(driver);
  await driver.save();
  return getReviewDetail(driverId);
};

export const approve = async (driverId, admin, note) => {
  const driver = await loadForAdmin(driverId);
  const k = driver.kyc;
  if (k.status === "approved") throw new KycError("Already approved");

  const problems = [];
  if (k.nin.status !== "passed") problems.push(`NIN is ${k.nin.status}`);
  if (k.face.status !== "passed") problems.push(`face check is ${k.face.status}`);
  await refreshGuarantorSummary(driver);
  if (k.guarantors.status !== "passed") problems.push(`${k.guarantors.confirmedCount}/${k.guarantors.required} guarantors confirmed`);
  if (problems.length) {
    throw new KycError(`Can't approve yet: ${problems.join("; ")}. Resolve manual-review checks first.`, 400, "CHECKS_INCOMPLETE");
  }

  k.status = "approved";
  k.reviewedBy = admin._id;
  k.reviewedAt = new Date();
  k.rejectionReason = undefined;
  driver.approvalStatus = "approved";
  driver.isVerified = true;
  driver.approvedBy = admin._id;
  driver.approvedAt = new Date();
  log(driver, "approved", admin._id, note);
  await driver.save();

  await notify(driver.userId._id, "You're verified!", "Your Riderr account is approved. You can now go online and start earning.", {}, "driver_approved");
  return getReviewDetail(driverId);
};

export const reject = async (driverId, admin, reason) => {
  if (!reason || String(reason).trim().length < 3) throw new KycError("A rejection reason is required");
  const driver = await loadForAdmin(driverId);
  driver.kyc.status = "rejected";
  driver.kyc.reviewedBy = admin._id;
  driver.kyc.reviewedAt = new Date();
  driver.kyc.rejectionReason = reason;
  driver.approvalStatus = "rejected";
  driver.rejectionReason = reason;
  driver.isVerified = false;
  driver.isOnline = false;
  driver.isAvailable = false;
  log(driver, "rejected", admin._id, reason);
  await driver.save();

  await notify(driver.userId._id, "Verification not approved", `Your verification was not approved: ${reason}`);
  return getReviewDetail(driverId);
};

/** Let a rider try again after rejection or after running out of attempts. */
export const reopen = async (driverId, admin, note) => {
  if (!note || String(note).trim().length < 3) throw new KycError("A note is required");
  const driver = await loadForAdmin(driverId);
  const k = driver.kyc;
  if (k.status === "approved") throw new KycError("Rider is approved; reject first if needed");
  k.status = "in_progress";
  k.rejectionReason = undefined;
  if (k.nin.status === "failed") k.nin.attempts = 0;
  if (k.face.status === "failed") k.face.attempts = 0;
  driver.approvalStatus = "pending";
  driver.rejectionReason = undefined;
  log(driver, "reopened", admin._id, note);
  recomputeStatus(driver);
  await driver.save();
  await notify(driver.userId._id, "Verification reopened", "You can continue your verification in the app.");
  return getReviewDetail(driverId);
};

