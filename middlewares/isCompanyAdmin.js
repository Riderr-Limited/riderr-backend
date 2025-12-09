export const isCompanyAdmin = (req, res, next) => {
  if (req.user.role !== "company_admin") {
    return res.status(403).json({ message: "Access denied: Company admin only" });
  }
  next();
};
