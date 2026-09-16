import Partner from "../models/partner.model.js";

/**
 * POST /api/admin/partners
 * Admin onboards a new external partner (ecommerce/marketplace platform)
 * and receives its API key + secret. The secret is only ever shown here.
 */
export const createPartner = async (req, res) => {
  try {
    const { businessName, contactName, contactEmail, contactPhone, allowedCompanyIds } = req.body;

    if (!businessName || !contactName || !contactEmail || !contactPhone) {
      return res.status(400).json({
        success: false,
        message: "businessName, contactName, contactEmail, and contactPhone are required",
      });
    }

    const { apiKey, apiSecret, apiSecretHash } = await Partner.generateCredentials();

    const partner = await Partner.create({
      businessName,
      contactName,
      contactEmail,
      contactPhone,
      allowedCompanyIds: allowedCompanyIds || [],
      apiKey,
      apiSecretHash,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Partner created. Store the apiSecret now — it will not be shown again.",
      data: {
        ...partner.toPublicJSON(),
        apiSecret,
      },
    });
  } catch (error) {
    console.error("Create partner error:", error);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A partner with this email already exists" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/partners
 */
export const listPartners = async (req, res) => {
  try {
    const partners = await Partner.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: partners.map((p) => p.toPublicJSON()) });
  } catch (error) {
    console.error("List partners error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/partners/:partnerId
 */
export const getPartner = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.partnerId);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });
    res.status(200).json({ success: true, data: partner.toPublicJSON() });
  } catch (error) {
    console.error("Get partner error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/admin/partners/:partnerId/suspend
 */
export const suspendPartner = async (req, res) => {
  try {
    const partner = await Partner.findByIdAndUpdate(
      req.params.partnerId,
      { status: "suspended" },
      { new: true }
    );
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });
    res.status(200).json({ success: true, message: "Partner suspended", data: partner.toPublicJSON() });
  } catch (error) {
    console.error("Suspend partner error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/admin/partners/:partnerId/activate
 */
export const activatePartner = async (req, res) => {
  try {
    const partner = await Partner.findByIdAndUpdate(
      req.params.partnerId,
      { status: "active" },
      { new: true }
    );
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });
    res.status(200).json({ success: true, message: "Partner activated", data: partner.toPublicJSON() });
  } catch (error) {
    console.error("Activate partner error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/admin/partners/:partnerId/regenerate-secret
 * Invalidates the old secret and issues a new one (apiKey stays the same).
 */
export const regeneratePartnerSecret = async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.partnerId);
    if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });

    const { apiSecret, apiSecretHash } = await Partner.generateCredentials();
    partner.apiSecretHash = apiSecretHash;
    await partner.save();

    res.status(200).json({
      success: true,
      message: "New apiSecret generated. Store it now — it will not be shown again.",
      data: { apiKey: partner.apiKey, apiSecret },
    });
  } catch (error) {
    console.error("Regenerate partner secret error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
