import User from "../models/user.models.js";
import Company from "../models/company.models.js"; // Add this import
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken"; // Add this import
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";
import mongoose from 'mongoose'
/**
 * -------------------------------
 * SIGN UP (for customers and company registration)
 * -------------------------------
 */
export const signUp = async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;
    const { companyId } = req.params; // from URL (for riders only)

    // 1. Check missing fields
    if (!name || !email || !password || !role || !phone) {
      const error = new Error("All fields are required");
      error.statusCode = 400;
      throw error;
    }

    // 2. Validate role - company registration is now allowed
    const validRoles = ["customer", "company", "rider"];
    if (!validRoles.includes(role)) {
      const error = new Error("Invalid role. Must be customer, company, or rider");
      error.statusCode = 400;
      throw error;
    }

    // 3. Prevent admin creation via signup
    if (role === "admin" || role === "company_admin") {
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

    // Start transaction for company registration
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let newUser;
      let company = null;

      if (role === "company") {
        // 8. For company registration, create company first
        const { companyName, address, city, lga, contactPhone, contactEmail, lat, lng } = req.body.companyDetails;

        if (!companyName || !city || !contactPhone) {
          const error = new Error("Company name, city, and contact phone are required");
          error.statusCode = 400;
          throw error;
        }

        // Check if company already exists
        const existingCompany = await Company.findOne({
          $or: [
            { name: companyName },
            { contactEmail: contactEmail || email },
            { contactPhone: contactPhone || phone }
          ]
        }).session(session);

        if (existingCompany) {
          const error = new Error("Company with this name, email or phone already exists");
          error.statusCode = 409;
          throw error;
        }

        // Create company
        company = await Company.create([{
          name: companyName,
          address,
          city,
          lga,
          contactPhone: contactPhone || phone,
          contactEmail: contactEmail || email,
          lat,
          lng,
          status: "pending" // Company needs admin approval
        }], { session });

        // Create company user with company_admin role
        const hashedPassword = await bcrypt.hash(password, 10);
        
        newUser = await User.create([{
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password: hashedPassword,
          phone,
          role: "company_admin",
          companyId: company[0]._id,
          isVerified: false, // Needs admin verification
          isActive: true,
        }], { session });

      } else if (role === "rider") {
        // 9. Enforce companyId for riders
        if (!companyId) {
          const error = new Error("Riders must belong to a company");
          error.statusCode = 400;
          throw error;
        }

        // Verify company exists
        const companyExists = await Company.findById(companyId).session(session);
        if (!companyExists) {
          const error = new Error("Company not found");
          error.statusCode = 404;
          throw error;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create rider user
        newUser = await User.create([{
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password: hashedPassword,
          phone,
          role: "rider",
          companyId,
          isVerified: false,
          isActive: true,
        }], { session });

      } else {
        // 10. For customer registration
        const hashedPassword = await bcrypt.hash(password, 10);

        newUser = await User.create([{
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password: hashedPassword,
          phone,
          role: "customer",
          companyId: null,
          isVerified: true, // Customers auto-verified
          isActive: true,
        }], { session });
      }

      // 11. Generate tokens
      const accessToken = generateAccessToken({ 
        userId: newUser[0]._id, 
        role: newUser[0].role 
      });
      
      const refreshToken = generateRefreshToken({ 
        userId: newUser[0]._id 
      });

      // 12. Save refresh token
      newUser[0].refreshToken = refreshToken;
      await newUser[0].save({ session });

      // 13. Remove sensitive info
      const userResponse = newUser[0].toObject();
      delete userResponse.password;
      delete userResponse.refreshToken;

      // Add company info if created
      if (company) {
        userResponse.company = company[0];
      }

      // Commit transaction
      await session.commitTransaction();

      // 14. Send response
      res.status(201).json({
        success: true,
        message: role === "company" ? "Company registration submitted for approval" : "User created successfully",
        data: {
          accessToken,
          refreshToken,
          user: userResponse
        }
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

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