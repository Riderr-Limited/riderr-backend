/**
 * Middleware to authorize users based on their role
 * @param {string[]} allowedRoles - Array of roles that are allowed
 */
const authorizeRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required"
        });
      }

      // Check if user's role is in allowed roles
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. ${req.user.role} role cannot perform this action.`,
          requiredRoles: allowedRoles
        });
      }

      // Additional check for company_admin: ensure they can only access their company's resources
      if (req.user.role === "company_admin" && req.params.companyId) {
        if (!req.user.companyId) {
          return res.status(403).json({
            success: false,
            message: "Company admin does not belong to any company"
          });
        }

        if (req.user.companyId.toString() !== req.params.companyId) {
          return res.status(403).json({
            success: false,
            message: "Cannot access resources from another company"
          });
        }
      }

      next();
    } catch (error) {
      console.error("Authorize role error:", error);
      return res.status(500).json({
        success: false,
        message: "Authorization error"
      });
    }
  };
};

export default authorizeRole;