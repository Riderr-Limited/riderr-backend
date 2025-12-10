export const isCompanyAdmin = (req, res, next) => {
  try {
    const user = req.user;
    const { companyId } = req.params;

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