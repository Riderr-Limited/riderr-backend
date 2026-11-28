// utils/companyUser.js
// The user account to notify for a company. Companies have no owner field;
// their admin is the User with role "company_admin" and this companyId.
// (Lookups by company.ownerId matched an undefined id, which could pick an
// unrelated user.)
import User from "../models/user.models.js";

export const findCompanyAdminUser = (companyId) => {
  const id = companyId?._id || companyId;
  if (!id) return Promise.resolve(null);
  return User.findOne({ companyId: id, role: "company_admin" }).sort({ createdAt: 1 }).select("_id name email phone");
};
