export const isCompanyAdmin = (req, res, next) => {
  try {
    const user = req.user;
    const { companyId } = req.params;

    console.log("=== DEBUG isCompanyAdmin ===");
    console.log("User ID:", user._id);
    console.log("User role:", user.role);
    console.log("User companyId:", user.companyId);
    console.log("User companyId type:", typeof user.companyId);
    console.log("Request companyId:", companyId);
    console.log("Request companyId type:", typeof companyId);
    console.log("Are they equal?", user.companyId === companyId);
    console.log("String comparison:", user.companyId?.toString() === companyId?.toString());

    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company admins can perform this action"
      });
    }

    if (!user.companyId || user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot access resources from another company"
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Authorization error"
    });
  }
};