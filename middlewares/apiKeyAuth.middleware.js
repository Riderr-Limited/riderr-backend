import Partner from "../models/partner.model.js";

/**
 * Authenticates external partner apps (ecommerce/marketplace platforms)
 * against the Partner API. Completely separate from the JWT-based
 * `authenticate` middleware used by the customer/driver/company app —
 * partners never get a Riderr user account.
 *
 * Expects headers:
 *   X-API-Key:    pk_...
 *   X-API-Secret: sk_...
 */
export const apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers["x-api-key"];
    const apiSecret = req.headers["x-api-secret"];

    if (!apiKey || !apiSecret) {
      return res.status(401).json({
        success: false,
        message: "Missing X-API-Key / X-API-Secret headers",
      });
    }

    const partner = await Partner.findOne({ apiKey }).select("+apiSecretHash");

    if (!partner) {
      return res.status(401).json({
        success: false,
        message: "Invalid API key",
      });
    }

    const validSecret = await partner.verifySecret(apiSecret);
    if (!validSecret) {
      return res.status(401).json({
        success: false,
        message: "Invalid API secret",
      });
    }

    if (!partner.canOperate()) {
      return res.status(403).json({
        success: false,
        message: "This partner account is suspended",
      });
    }

    partner.lastUsedAt = new Date();
    partner.requestCount += 1;
    await partner.save();

    req.partner = partner;
    next();
  } catch (error) {
    console.error("Partner API auth error:", error);
    res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
};
