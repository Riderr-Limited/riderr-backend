/**
 * @swagger
 * tags:
 *   - name: KYC
 *     description: Identity verification for individual riders (NIN, selfie, guarantors)
 *   - name: Guarantor
 *     description: Public pages a guarantor opens from the link the rider sends them
 *   - name: Admin KYC
 *     description: Review queue for individual rider verification
 */
import express from "express";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import {
  getMyKycStatus,
  submitNin,
  submitSelfie,
  addGuarantors,
  regenerateGuarantorLink,
  removeGuarantor,
  getGuarantorInvite,
  sendGuarantorOtp,
  verifyGuarantorOtp,
  respondAsGuarantor,
  listKycQueue,
  getKycReview,
  resolveKycCheck,
  approveKyc,
  rejectKyc,
  reopenKyc,
  getKycSelfie
} from "../controllers/kyc.controller.js";

// Selfies stay in memory; the service re-encodes and stores them privately.
const selfieUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"].includes(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error("Selfie must be a JPEG, PNG or WEBP image"), { statusCode: 400 }));
  }
});

const uploadSelfie = (req, res, next) =>
  selfieUpload.single("selfie")(req, res, (err) => {
    if (!err) return next();
    const message = err.code === "LIMIT_FILE_SIZE" ? "Selfie must be smaller than 8MB" : err.message;
    res.status(400).json({ success: false, message });
  });

// Signed-in routes are limited per user account (can't be dodged by spoofing
// X-Forwarded-For). Public guarantor routes fall back to IP, and also have
// per-link attempt counters stored in the database.
const limiter = (limit, windowMinutes = 15) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => (req.user?._id ? `user:${req.user._id}` : `ip:${ipKeyGenerator(req.ip || "")}`),
    message: { success: false, message: "Too many requests. Please wait and try again." }
  });

// ======================= rider (mounted at /api/kyc) =======================
export const riderKycRouter = express.Router();
riderKycRouter.use(protect, authorize("driver"));

/**
 * @swagger
 * /kyc/status:
 *   get:
 *     tags: [KYC]
 *     summary: My verification status and next step
 */
riderKycRouter.get("/status", getMyKycStatus);

/**
 * @swagger
 * /kyc/nin:
 *   post:
 *     tags: [KYC]
 *     summary: Step 1 - verify NIN against NIMC (name must match account name)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nin, consent]
 *             properties:
 *               nin: { type: string, example: "12345678901" }
 *               consent: { type: boolean, example: true }
 */
riderKycRouter.post("/nin", limiter(10), submitNin);

/**
 * @swagger
 * /kyc/selfie:
 *   post:
 *     tags: [KYC]
 *     summary: Step 2 - live selfie, checked for liveness and matched to NIN photo
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               selfie: { type: string, format: binary }
 */
riderKycRouter.post("/selfie", limiter(10), uploadSelfie, submitSelfie);

/**
 * @swagger
 * /kyc/guarantors:
 *   post:
 *     tags: [KYC]
 *     summary: Step 3 - add guarantors; returns a link to send each one
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               guarantors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [name, phone, relationship]
 *                   properties:
 *                     name: { type: string }
 *                     phone: { type: string, example: "08031234567" }
 *                     relationship: { type: string, enum: [family, employer, religious_leader, community_leader, friend, colleague, other] }
 *                     email: { type: string }
 *                     address: { type: string }
 *                     occupation: { type: string }
 */
riderKycRouter.post("/guarantors", limiter(20), addGuarantors);
riderKycRouter.post("/guarantors/:guarantorId/link", limiter(20), regenerateGuarantorLink);
riderKycRouter.delete("/guarantors/:guarantorId", removeGuarantor);

// ================= guarantor, public (mounted at /api/guarantors) =================
export const guarantorRouter = express.Router();
guarantorRouter.use(limiter(30));

/**
 * @swagger
 * /guarantors/{token}:
 *   get:
 *     tags: [Guarantor]
 *     summary: What the guarantor is being asked to confirm
 * /guarantors/{token}/otp:
 *   post:
 *     tags: [Guarantor]
 *     summary: Send an SMS code to the guarantor's phone
 * /guarantors/{token}/otp/verify:
 *   post:
 *     tags: [Guarantor]
 *     summary: Verify the SMS code  { code }
 * /guarantors/{token}/respond:
 *   post:
 *     tags: [Guarantor]
 *     summary: Accept (with own NIN + consent) or decline  { accept, nin, consent }
 */
guarantorRouter.get("/:token", getGuarantorInvite);
guarantorRouter.post("/:token/otp", limiter(5), sendGuarantorOtp);
guarantorRouter.post("/:token/otp/verify", limiter(10), verifyGuarantorOtp);
guarantorRouter.post("/:token/respond", limiter(10), respondAsGuarantor);

// ===================== admin (mounted at /api/admin/kyc) =====================
export const adminKycRouter = express.Router();
adminKycRouter.use(protect, authorize("admin"));

/**
 * @swagger
 * /admin/kyc:
 *   get:
 *     tags: [Admin KYC]
 *     summary: Review queue (?status=pending_review|in_progress|approved|rejected|not_started|all)
 * /admin/kyc/{driverId}:
 *   get:
 *     tags: [Admin KYC]
 *     summary: Full review detail incl. guarantors
 * /admin/kyc/{driverId}/selfie:
 *   get:
 *     tags: [Admin KYC]
 *     summary: The rider's selfie image (private)
 * /admin/kyc/{driverId}/checks/{check}:
 *   post:
 *     tags: [Admin KYC]
 *     summary: Settle a manual-review check. check = nin|face, body { status: passed|failed, note }
 * /admin/kyc/{driverId}/approve:
 *   post:
 *     tags: [Admin KYC]
 *     summary: Approve rider (all checks must be passed)  { note }
 * /admin/kyc/{driverId}/reject:
 *   post:
 *     tags: [Admin KYC]
 *     summary: Reject rider  { reason }
 * /admin/kyc/{driverId}/reopen:
 *   post:
 *     tags: [Admin KYC]
 *     summary: Let a rejected or locked-out rider try again  { note }
 */
adminKycRouter.get("/", listKycQueue);
adminKycRouter.get("/:driverId", getKycReview);
adminKycRouter.get("/:driverId/selfie", getKycSelfie);
adminKycRouter.post("/:driverId/checks/:check", resolveKycCheck);
adminKycRouter.post("/:driverId/approve", approveKyc);
adminKycRouter.post("/:driverId/reject", rejectKyc);
adminKycRouter.post("/:driverId/reopen", reopenKyc);
