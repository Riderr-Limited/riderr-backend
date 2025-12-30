import jwt from 'jsonwebtoken';
import User from '../models/user.models.js';

/**
 * Authenticate user via JWT token
 */
export const authenticate = async (req, res, next) => {  // Added next parameter
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
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key-change-in-production');
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
    next();  // Added next() call

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

    next();  // Added next() call
  };
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {  // Added next parameter
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();  // Changed from return; to next()
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return next();  // Changed from return to next()
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key-change-in-production');
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

/**
 * Company admin only middleware
 */
export const companyAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'company_admin') {
    return res.status(403).json({
      success: false,
      message: 'Only company admins can access this route'
    });
  }

  if (!req.user.companyId) {
    return res.status(403).json({
      success: false,
      message: 'Company admin must be associated with a company'
    });
  }

  next();
};

/**
 * Admin only middleware
 */
export const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Only admins can access this route'
    });
  }

  next();
};

/**
 * Driver only middleware
 */
export const driverOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Only drivers can access this route'
    });
  }

  next();
};

/**
 * Customer only middleware
 */
export const customerOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'customer') {
    return res.status(403).json({
      success: false,
      message: 'Only customers can access this route'
    });
  }

  next();
};

/**
 * Rate limiting middleware (placeholder)
 */
export const rateLimit = (req, res, next) => {
  // Implement rate limiting logic here
  // You can use express-rate-limit package
  next();
};

/**
 * Check if user owns resource
 */
export const checkResourceOwnership = (resourceOwnerId) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Admins can access any resource
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    const resourceId = req.params[resourceOwnerId] || req.body[resourceOwnerId];
    
    if (req.user._id.toString() === resourceId.toString()) {
      return next();
    }

    // Company admin can access company resources
    if (req.user.role === 'company_admin' && req.user.companyId) {
      // Additional logic for company-owned resources
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. You do not own this resource.'
    });
  };
};

/**
 * Add aliases for compatibility
 */
export const protect = authenticate;  // Alias for authenticate
export const auth = authenticate;     // Another alias