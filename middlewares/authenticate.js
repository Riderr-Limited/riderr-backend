import jwt from "jsonwebtoken";
import User from "../models/user.models.js";

const authenticate = async (req, res, next) => {
  try {
    let token;

    // Check for Bearer Token
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // No token found
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: "Unauthorized - No token provided" 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user from DB
    const user = await User.findById(decoded.userId).select("-password -refreshToken");
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: "Unauthorized - User not found" 
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated"
      });
    }

    // Attach user to req object
    req.user = user;

    // Continue
    next();
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: "Invalid token"
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired"
      });
    }
    
    return res.status(500).json({
      success: false,
      message: "Server error in authentication"
    });
  }
};

export default authenticate;