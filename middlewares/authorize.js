import jwt from "jsonwebtoken";
import User from "../models/user.models.js";

const authorize = async (req, res, next) => {
  try {
    let token;

    // Check for Bearer Token in Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // Check for token in cookies (alternative)
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    // No token found
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: "Unauthorized - No token provided" 
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: "Token expired",
          code: "TOKEN_EXPIRED"
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid token",
        code: "INVALID_TOKEN"
      });
    }

    // Fetch user from DB with password (for security checks)
    const user = await User.findById(decoded.userId)
      .select('+password +refreshToken +loginAttempts +lockUntil')
      .populate('companyId', 'name status');

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: "Unauthorized - User not found" 
      });
    }

    // Check if user account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated. Please contact support.",
        code: "ACCOUNT_DEACTIVATED"
      });
    }

    // Check if account is locked due to too many login attempts
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
      return res.status(403).json({
        success: false,
        message: `Account is temporarily locked. Try again in ${minutesLeft} minutes.`,
        code: "ACCOUNT_LOCKED"
      });
    }

    // Attach user to req object (without sensitive data)
    const userObject = user.toObject();
    delete userObject.password;
    delete userObject.refreshToken;
    delete userObject.loginAttempts;
    delete userObject.lockUntil;
    
    req.user = userObject;

    // Update last seen time (non-blocking)
    user.lastSeenAt = new Date();
    user.save().catch(console.error); // Don't block request if this fails

    next();

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error in authentication",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export default authorize;