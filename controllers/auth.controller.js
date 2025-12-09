import User from "../models/user.models.js";
import bcrypt from "bcrypt";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";


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

    // 2. Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const error = new Error("User already exists");
      error.statusCode = 409;
      throw error;
    }

    // 3. Enforce companyId for riders
    if (role === "rider") {
      if (!companyId) {
        const error = new Error("Riders must belong to a company");
        error.statusCode = 400;
        throw error;
      }
    }

    // 4. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Create user
    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role,
      companyId: role === "rider" ? companyId : null,
      isVerified: role === "rider" ? false : true,
    });

    // 6. Generate tokens
    const accessToken = generateAccessToken({ userId: newUser._id, role: newUser.role });
    const refreshToken = generateRefreshToken({ userId: newUser._id });

    // 7. Save refresh token
    newUser.refreshToken = refreshToken;
    await newUser.save();

    // 8. Remove sensitive info
    const userResponse = newUser.toObject();
    delete userResponse.password;
    delete userResponse.refreshToken;

    // 9. Send response
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
