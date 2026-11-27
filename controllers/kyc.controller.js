// controllers/kyc.controller.js
// HTTP layer for individual-rider KYC. Business rules live in services/kyc/kyc.service.js.
import * as kyc from "../services/kyc/kyc.service.js";

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req, res);
    if (!res.headersSent) res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    const status = error.statusCode || (error.isProviderError ? 502 : 500);
    if (status >= 500) console.error("KYC error:", error);
    res.status(status).json({
      success: false,
      message:
        status >= 500 && !error.statusCode
          ? error.isProviderError
            ? "The identity service is unavailable right now. Please try again shortly."
            : "Something went wrong. Please try again."
          : error.message,
      code: error.code
    });
  }
};

// ----- rider -----
export const getMyKycStatus = handle((req) => kyc.getStatus(req.user._id));
export const submitNin = handle((req) => kyc.submitNin(req.user, req.body, req.ip));
export const submitSelfie = handle((req) => kyc.submitSelfie(req.user, req.file));
export const addGuarantors = handle((req) => kyc.addGuarantors(req.user, req.body.guarantors));
export const regenerateGuarantorLink = handle((req) => kyc.regenerateGuarantorLink(req.user, req.params.guarantorId));
export const removeGuarantor = handle((req) => kyc.removeGuarantor(req.user, req.params.guarantorId));

// ----- public (guarantor link) -----
export const getGuarantorInvite = handle((req) => kyc.getGuarantorInvite(req.params.token));
export const sendGuarantorOtp = handle((req) => kyc.sendGuarantorOtp(req.params.token));
export const verifyGuarantorOtp = handle((req) => kyc.verifyGuarantorOtp(req.params.token, req.body.code));
export const respondAsGuarantor = handle((req) => kyc.respondAsGuarantor(req.params.token, req.body, req.ip));

// ----- admin -----
export const listKycQueue = handle((req) => kyc.listQueue(req.query));
export const getKycReview = handle((req) => kyc.getReviewDetail(req.params.driverId));
export const resolveKycCheck = handle((req) =>
  kyc.resolveCheck(req.params.driverId, req.params.check, req.body.status, req.body.note, req.user)
);
export const approveKyc = handle((req) => kyc.approve(req.params.driverId, req.user, req.body.note));
export const rejectKyc = handle((req) => kyc.reject(req.params.driverId, req.user, req.body.reason));
export const reopenKyc = handle((req) => kyc.reopen(req.params.driverId, req.user, req.body.note));

export const getKycSelfie = async (req, res) => {
  try {
    const file = await kyc.getSelfieFile(req.params.driverId);
    res.set("Cache-Control", "no-store, private");
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(500).json({ success: false, message: "Could not read selfie" });
    });
  } catch (error) {
    const status = error.name === "CastError" ? 404 : error.statusCode || 500;
    res.status(status).json({ success: false, message: status === 500 ? "Something went wrong" : error.message });
  }
};
