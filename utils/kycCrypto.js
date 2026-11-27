// utils/kycCrypto.js
// Encryption for identity numbers (NIN). Never store a NIN in plain text.
//
// KYC_ENCRYPTION_KEY must be 32 bytes, given as 64 hex characters.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Losing or changing this key makes stored NINs unreadable, so back it up.
import crypto from "crypto";

const getKey = () => {
  const hex = process.env.KYC_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("KYC_ENCRYPTION_KEY is missing or invalid (expected 64 hex characters)");
  }
  return Buffer.from(hex, "hex");
};

// Separate key for hashing so the hash can't be used to decrypt anything.
const getHashKey = () => crypto.createHmac("sha256", getKey()).update("riderr-kyc-hash-v1").digest();

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64 parts). */
export const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
};

export const decrypt = (payload) => {
  const [version, iv, tag, data] = String(payload).split(":");
  if (version !== "v1") throw new Error("Unknown KYC ciphertext version");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

/** Deterministic keyed hash, for uniqueness lookups ("is this NIN already used?"). */
export const hashIdentifier = (value) =>
  crypto.createHmac("sha256", getHashKey()).update(String(value).trim()).digest("hex");

/** Random URL-safe token plus its SHA-256 (store only the hash). */
export const generateToken = () => {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
};

export const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export const isKycCryptoConfigured = () => {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
};
