import User from "../models/user.models.js";
import bcrypt from "bcrypt";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";

/**
 * -------------------------------
 * SIGN UP
 * -------------------------------
 */
export const signUp = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;
    const { companyId } = req.params; // from URL

    // 1. Check missing fields
    if (!name || !email || !password || !role || !phone) {
      const error = new Error("All fields are required");
      error.statusCode = 400;
      throw error;
    }

    // 2. Validate role
    const validRoles = ["customer", "company_admin", "rider"];
    if (!validRoles.includes(role)) {
      const error = new Error("Invalid role. Must be customer, company_admin, or rider");
      error.statusCode = 400;
      throw error;
    }

    // 3. Prevent admin creation via signup
    if (role === "admin") {
      const error = new Error("Admin users cannot be created via signup");
      error.statusCode = 403;
      throw error;
    }

    // 4. Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const error = new Error("Invalid email format");
      error.statusCode = 400;
      throw error;
    }

    // 5. Validate phone format
    const phoneRegex = /^[+]?[\d\s\-\(\)]{10,}$/;
    if (!phoneRegex.test(phone)) {
      const error = new Error("Invalid phone number format");
      error.statusCode = 400;
      throw error;
    }

    // 6. Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      const error = new Error(
        "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
      );
      error.statusCode = 400;
      throw error;
    }

    // 7. Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });
    
    if (existingUser) {
      const error = new Error("User with this email or phone already exists");
      error.statusCode = 409;
      throw error;
    }

    // 8. Enforce companyId for riders
    if (role === "rider") {
      if (!companyId) {
        const error = new Error("Riders must belong to a company");
        error.statusCode = 400;
        throw error;
      }
    }

    // 9. For company_admin role, validate companyId from body if needed
    if (role === "company_admin" && !req.body.companyId) {
      const error = new Error("Company admins must have a companyId");
      error.statusCode = 400;
      throw error;
    }

    // 10. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 11. Create user
    const newUser = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      phone,
      role,
      companyId: role === "rider" ? companyId : (role === "company_admin" ? req.body.companyId : null),
      isVerified: role === "rider" ? false : true,
      isActive: true,
    });

    // 12. Generate tokens
    const accessToken = generateAccessToken({ 
      userId: newUser._id, 
      role: newUser.role 
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: newUser._id 
    });

    // 13. Save refresh token
    newUser.refreshToken = refreshToken;
    await newUser.save();

    // 14. Remove sensitive info
    const userResponse = newUser.toObject();
    delete userResponse.password;
    delete userResponse.refreshToken;

    // 15. Send response
    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: {
        accessToken,
        refreshToken,
        user: userResponse
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * SIGN IN
 * -------------------------------
 */
export const signIn = async (req, res, next) => {
  try {
    const { emailOrPhone, password } = req.body;

    // 1. Validate input
    if (!emailOrPhone || !password) {
      const error = new Error("Email/Phone and password are required");
      error.statusCode = 400;
      throw error;
    }

    // 2. Find user by email or phone
    const user = await User.findOne({
      $or: [
        { email: emailOrPhone },
        { phone: emailOrPhone }
      ]
    });

    if (!user) {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    // 3. Check if user is active
    if (user.isActive === false) {
      const error = new Error("Account is deactivated. Please contact support.");
      error.statusCode = 403;
      throw error;
    }

    // 4. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const error = new Error("Invalid credentials");
      error.statusCode = 401;
      throw error;
    }

    // 5. Generate tokens
    const accessToken = generateAccessToken({ 
      userId: user._id, 
      role: user.role 
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: user._id 
    });

    // 6. Save refresh token and update last seen
    user.refreshToken = refreshToken;
    user.lastSeenAt = new Date();
    await user.save();

    // 7. Remove sensitive info
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.refreshToken;

    // 8. Send response
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        accessToken,
        refreshToken,
        user: userResponse
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * REFRESH TOKEN
 * -------------------------------
 */
export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: oldRefreshToken } = req.body;

    if (!oldRefreshToken) {
      const error = new Error("Refresh token is required");
      error.statusCode = 400;
      throw error;
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      const error = new Error("Invalid or expired refresh token");
      error.statusCode = 401;
      throw error;
    }

    // Find user with matching refresh token
    const user = await User.findOne({
      _id: decoded.userId,
      refreshToken: oldRefreshToken
    });

    if (!user) {
      const error = new Error("Invalid refresh token");
      error.statusCode = 401;
      throw error;
    }

    // Check if user is active
    if (user.isActive === false) {
      const error = new Error("Account is deactivated");
      error.statusCode = 403;
      throw error;
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({ 
      userId: user._id, 
      role: user.role 
    });
    
    const newRefreshToken = generateRefreshToken({ 
      userId: user._id 
    });

    // Update refresh token
    user.refreshToken = newRefreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * LOGOUT
 * -------------------------------
 */
export const logout = async (req, res, next) => {
  try {
    const user = req.user;

    // Clear refresh token
    user.refreshToken = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * LOGOUT ALL DEVICES
 * -------------------------------
 */
export const logoutAll = async (req, res, next) => {
  try {
    const user = req.user;

    // Clear refresh token (this will invalidate all devices)
    user.refreshToken = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Logged out from all devices successfully"
    });

  } catch (error) {
    next(error);
  }
};