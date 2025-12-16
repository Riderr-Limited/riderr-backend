import User from '../models/user.models.js';

const requireVerification = (roles = []) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      // If no roles specified, check all users
      if (roles.length === 0 || roles.includes(user.role)) {
        if (!user.isVerified) {
          return res.status(403).json({
            success: false,
            message: 'Account verification required',
            requiresVerification: true,
            verificationType: user.phone ? 'phone' : 'email'
          });
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export default requireVerification;