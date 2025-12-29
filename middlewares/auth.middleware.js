import jwt from 'jsonwebtoken';
import User from '../models/user.models.js';

/**
 * Authenticate user via JWT token
 */


export const authenticate = async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Authorization denied.'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Get user from token
    const user = await User.findById(decoded.userId)
      .select('-password -refreshToken')
      .populate('companyId', 'name status');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Token invalid.'
      });
    }

    // Check if user is active
    if (!user.isActive || user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is locked'
      });
    }

    // Attach user to request
    req.user = user;
    next();

  } catch (error) {
    console.error('❌ Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Authorize user based on roles
 * Usage: authorize('admin', 'company_admin')
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
        requiredRoles: roles,
        userRole: req.user.role
      });
    }

   
  };
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return;
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId)
      .select('-password -refreshToken');

    if (user && user.isActive && !user.isDeleted) {
      req.user = user;
    }

    next();
  } catch (error) {
    // Silent fail for optional auth
    next();
  }
};

/**
 * Require verification
 */
export const requireVerification = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message: 'Account verification required',
      code: 'VERIFICATION_REQUIRED'
    });
  }

  next();
};

/**
 * Check company ownership
 */
export const checkCompanyOwnership = (req, res, next) => {
  const { companyId } = req.params;

  if (req.user.role === 'admin') {
    // Admin can access any company
    return next();
  }

  if (req.user.role === 'company_admin') {
    if (!req.user.companyId || req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: 'Cannot access another company\'s resources'
      });
    }
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};