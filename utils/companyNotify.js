import Company from "../models/company.models.js";
import User from "../models/user.models.js";
import { sendEmail } from "../services/email.service.js";
import { sendNotification } from "./notification.js";

/**
 * Notify a company admin  push notification + email
 * @param {string|ObjectId} companyId
 * @param {string} title
 * @param {string} message
 * @param {object} data  - extra data for push payload
 * @param {string} emailBody - plain-text email body (optional, falls back to message)
 */
export const notifyCompany = async (companyId, title, message, data = {}, emailBody = null) => {
  if (!companyId) return;

  try {
    const [company, companyAdmin] = await Promise.all([
      Company.findById(companyId).select("contactEmail name").lean(),
      User.findOne({ companyId, role: "company_admin", isActive: true }).select("_id").lean(),
    ]);

    // Push notification to company admin user
    if (companyAdmin) {
      await sendNotification({ userId: companyAdmin._id, type: "company", title, message, data });
    }

    // Email to company contact email
    if (company?.contactEmail) {
      const html = buildEmailHTML(company.name, title, emailBody || message);
      await sendEmail(company.contactEmail, title, html, emailBody || message);
    }
  } catch (err) {
    console.error("notifyCompany error:", err);
  }
};

const buildEmailHTML = (companyName, title, body) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f5f5f5">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:32px;text-align:center;color:#fff">
      <h1 style="margin:0;font-size:28px">Riderr</h1>
      <p style="margin:8px 0 0 0;opacity:.9">${companyName}</p>
    </div>
    <div style="padding:32px 28px">
      <h2 style="margin:0 0 16px 0;font-size:20px;color:#1a1a1a">${title}</h2>
      <p style="color:#444;line-height:1.6;margin:0">${body}</p>
    </div>
    <div style="background:#f8f9fa;padding:16px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee">
       ${new Date().getFullYear()} Riderr. All rights reserved.
    </div>
  </div>
</body>
</html>`;
