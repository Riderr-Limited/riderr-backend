// services/kyc/index.js
// Picks the identity provider. KYC_PROVIDER = "mock" (default) | "dojah".
// The mock is blocked in production unless KYC_ALLOW_MOCK=true, so nobody can
// pass verification for free by accident.
import mockProvider from "./providers/mock.provider.js";
import dojahProvider from "./providers/dojah.provider.js";

const providers = { mock: mockProvider, dojah: dojahProvider };

export const getKycProvider = () => {
  const name = (process.env.KYC_PROVIDER || "mock").toLowerCase();
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown KYC_PROVIDER "${name}"`);

  if (
    provider.name === "mock" &&
    process.env.NODE_ENV === "production" &&
    process.env.KYC_ALLOW_MOCK !== "true"
  ) {
    const err = new Error("Identity verification is not configured yet. Please try again later.");
    err.statusCode = 503;
    throw err;
  }
  return provider;
};

export const kycConfig = () => ({
  requiredGuarantors: Number(process.env.KYC_REQUIRED_GUARANTORS || 2),
  maxNinAttempts: Number(process.env.KYC_MAX_NIN_ATTEMPTS || 3),
  maxFaceAttempts: Number(process.env.KYC_MAX_FACE_ATTEMPTS || 3),
  faceMatchThreshold: Number(process.env.KYC_FACE_MATCH_THRESHOLD || 0.8),
  // How many riders one person may guarantee at the same time.
  maxRidersPerGuarantor: Number(process.env.KYC_MAX_RIDERS_PER_GUARANTOR || 2),
  guarantorLinkTtlHours: Number(process.env.KYC_GUARANTOR_LINK_TTL_HOURS || 72),
  publicAppUrl: (process.env.KYC_GUARANTOR_LINK_BASE_URL || process.env.FRONTEND_URL || "https://riderr.ng").replace(/\/$/, "")
});
