import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import Driver from "../models/riders.models.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import twilio from "twilio";
import { validationResult } from "express-validator";

/**
 * -------------------------------
 * UTILITY FUNCTIONS
 * -------------------------------
 */

// Generate random verification code
const generateVerificationCode = (length = 6) => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send SMS OTP using Twilio
const sendSMSOTP = async (phone, otp, message) => {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: `${message}: ${otp}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });

    console.log(`✅ SMS OTP sent to ${phone}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ SMS send failed for ${phone}:`, error.message);
    return { success: false, error: error.message };
  }
};
/**
 * @desc    Check verification status
 * @route   GET /api/auth/check-verification
 * @access  Public
 */
export const checkVerificationStatus = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "emailVerifiedAt isVerified",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        isVerified: user.isVerified,
        emailVerifiedAt: user.emailVerifiedAt,
        requiresVerification: !user.isVerified,
      },
    });
  } catch (error) {
    console.error("❌ Check verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check verification status",
    });
  }
};

// Generate JWT tokens
const generateAccessToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || "fallback-secret-key-change-in-production",
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "30d" },
  );
};

const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET ||
      process.env.JWT_SECRET ||
      "fallback-secret-key-change-in-production",
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "30d" },
  );
};

// Email transporter
const createEmailTransporter = () => {
  try {
    // Use Ethereal for development (reliable email testing)
    if (process.env.NODE_ENV === "development") {
      const testAccount = nodemailer.createTestAccount();
      return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    // Use configured SMTP for production
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "smtp.gmail.com",
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || "test@example.com",
        pass: process.env.EMAIL_PASSWORD || "testpassword",
      },
      tls: { rejectUnauthorized: false },
    });
  } catch (error) {
    console.log("📧 Email transporter not configured, running in dev mode");
    return null;
  }
};

// Send verification email
const sendVerificationEmail = async (email, code, name, phone = null) => {
  try {
    // In production, use SMS if phone is provided
    if (process.env.NODE_ENV === 'production' && phone) {
      const smsResult = await sendSMSOTP(
        phone,
        code,
        `Your Riderr verification code`
      );
      if (smsResult.success) {
        console.log(`✅ Verification SMS sent to ${phone}`);
        return { success: true, method: 'sms' };
      } else {
        console.error(`❌ SMS failed, falling back to email`);
      }
    }

    // Fallback to email
    const transporter = createEmailTransporter();

    if (!transporter) {
      console.log(`📧 DEV MODE: Email verification code for ${email}: ${code}`);
      return { success: true, devMode: true };
    }

    const mailOptions = {
      from: `"Riderr" <${process.env.EMAIL_USER || "noreply@riderr.com"}>`,
      to: email,
      subject: "Your Riderr Verification Code",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #337bff, #5a95ff); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white; }
            .content { padding: 30px; background: #f8f9fa; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; }
            .code { background: #337bff; color: white; padding: 20px; border-radius: 10px; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; text-align: center; }
            .footer { margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Riderr</h1>
              <p style="margin: 10px 0 0 0;">Email Verification</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Your email verification code is:</p>
              <div class="code">${code}</div>
              <p>This code expires in 10 minutes.</p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${email}`);

    // Return Ethereal URL for development
    const etherealUrl =
      process.env.NODE_ENV === "development" &&
      transporter.options.host === "smtp.ethereal.email"
        ? `https://ethereal.email/message/${info.messageId}`
        : null;

    return { success: true, messageId: info.messageId, etherealUrl };
  } catch (error) {
    console.error("❌ Email error:", error.message);
    console.log(`📧 FALLBACK: Email verification code for ${email}: ${code}`);
    return { success: true, devMode: true };
  }
};

// Send OTP via email (for password reset)
const sendOTPEmail = async (email, otp, name, phone = null) => {
  try {
    // In production, use SMS if phone is provided
    if (process.env.NODE_ENV === 'production' && phone) {
      const smsResult = await sendSMSOTP(
        phone,
        otp,
        `Your Riderr password reset OTP`
      );
      if (smsResult.success) {
        console.log(`✅ Password reset SMS sent to ${phone}`);
        return { success: true, method: 'sms' };
      } else {
        console.error(`❌ SMS failed, falling back to email`);
      }
    }

    // Fallback to email
    const transporter = createEmailTransporter();

    if (!transporter) {
      console.log(`📧 DEV MODE: OTP for ${email}: ${otp}`);
      return { success: true, devMode: true };
    }

    const mailOptions = {
      from: `"Riderr" <${process.env.EMAIL_USER || "noreply@riderr.com"}>`,
      to: email,
      subject: "Password Reset OTP - Riderr",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #337bff, #5a95ff); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white; }
            .content { padding: 30px; background: #f8f9fa; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; }
            .code { background: #337bff; color: white; padding: 20px; border-radius: 10px; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; text-align: center; }
            .footer { margin-top: 30px; color: #999; font-size: 12px; text-align: center; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Riderr</h1>
              <p style="margin: 10px 0 0 0;">Password Reset</p>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Your password reset OTP is:</p>
              <div class="code">${otp}</div>
              <div class="warning">
                <strong>⚠️ Security Alert:</strong> This OTP expires in 10 minutes. If you didn't request this, please ignore this email and contact support immediately.
              </div>
              <p>For security reasons, do not share this OTP with anyone.</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset OTP sent to ${email}`);

    // Return Ethereal URL for development
    const etherealUrl =
      process.env.NODE_ENV === "development" &&
      transporter.options.host === "smtp.ethereal.email"
        ? `https://ethereal.email/message/${info.messageId}`
        : null;

    return { success: true, messageId: info.messageId, etherealUrl };
  } catch (error) {
    console.error("❌ OTP email error:", error.message);
    console.log(`📧 FALLBACK: Password reset OTP for ${email}: ${otp}`);
    return { success: true, devMode: true };
  }
};

/**
 * -------------------------------
 * AUTH CONTROLLERS
 * -------------------------------
 */

/**
 * @desc    Sign up a new user
 * @route   POST /api/auth/signup
 * @access  Public
 */
export const signUp = async (req, res) => {
  const session = await mongoose.startSession();

  let newUser;
  let emailCode;
  let requiresVerification = true;

  try {
    await session.withTransaction(async () => {
      // ✅ Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new Error("VALIDATION_FAILED");
      }

      const { name, email, password, role, phone } = req.body;

      console.log("📝 Signup request:", { name, email, role, phone });

      // ✅ Check existing user
      const existingUser = await User.findOne({
        $or: [{ email: email.toLowerCase() }, { phone }],
      }).session(session);

      if (existingUser) {
        throw new Error("USER_EXISTS");
      }

      // ✅ Generate verification code
      emailCode = generateVerificationCode();
      const emailExpiry = Date.now() + 10 * 60 * 1000;
      const hashedPassword = await bcrypt.hash(password, 10);

      if (role === "company_admin") {
        const {
          companyName,
          address,
          city,
          state,
          lga,
          businessLicense,
          taxId,
          bankName,
          accountName,
          accountNumber,
          companyPhone,
        } = req.body;

        if (!companyName || !city || !state || !businessLicense || !taxId) {
          throw new Error("COMPANY_DETAILS_REQUIRED");
        }

        const existingCompany = await Company.findOne({
          $or: [
            { name: companyName },
            { contactEmail: email },
            { businessLicense },
          ],
        }).session(session);

        if (existingCompany) {
          throw new Error("COMPANY_EXISTS");
        }

        const [company] = await Company.create(
          [
            {
              name: companyName,
              address,
              city,
              state,
              lga,
              businessLicense,
              taxId,
              contactPhone: companyPhone,
              contactEmail: email,
              password: hashedPassword,
              status: "pending",
              bankDetails: { bankName, accountName, accountNumber },
            },
          ],
          { session },
        );

        [newUser] = await User.create(
          [
            {
              name: name.trim(),
              email: email.toLowerCase().trim(),
              password: hashedPassword,
              phone,
              role: "company_admin",
              companyId: company._id,
              emailVerificationToken: emailCode,
              emailVerificationExpires: emailExpiry,
              isActive: true,
              isVerified: false,
            },
          ],
          { session },
        );
      } else if (role === "driver") {
        const { companyId } = req.body;
        if (!companyId) throw new Error("COMPANY_ID_REQUIRED");

        const company = await Company.findById(companyId).session(session);
        if (!company) throw new Error("COMPANY_NOT_FOUND");

        [newUser] = await User.create(
          [
            {
              name: name.trim(),
              email: email.toLowerCase().trim(),
              password: hashedPassword,
              phone,
              role: "driver",
              companyId,
              emailVerificationToken: emailCode,
              emailVerificationExpires: emailExpiry,
              isActive: true,
              isVerified: false,
            },
          ],
          { session },
        );

        const { licenseNumber, vehicleType, plateNumber, licenseExpiry } =
          req.body;

        if (!licenseNumber || !vehicleType || !plateNumber || !licenseExpiry) {
          throw new Error("DRIVER_DETAILS_REQUIRED");
        }

        await Driver.create(
          [
            {
              userId: newUser._id,
              companyId,
              licenseNumber,
              vehicleType,
              plateNumber,
              licenseExpiry,
              approvalStatus: "pending",
            },
          ],
          { session },
        );
      } else {
        [newUser] = await User.create(
          [
            {
              name: name.trim(),
              email: email.toLowerCase().trim(),
              password: hashedPassword,
              phone,
              role: role || "customer",
              emailVerificationToken: emailCode,
              emailVerificationExpires: emailExpiry,
              isActive: true,
              isVerified: false,
            },
          ],
          { session },
        );
      }

      // ✅ Tokens INSIDE transaction (DB-only)
      const refreshToken = generateRefreshToken({ userId: newUser._id });
      newUser.refreshToken = refreshToken;
      await newUser.save({ session });

      requiresVerification = role !== "admin";
    });

    session.endSession();

    // ✅ SEND EMAIL AFTER COMMIT (VERY IMPORTANT)
    let emailResult = null;
    if (requiresVerification) {
      emailResult = await sendVerificationEmail(
        newUser.email,
        emailCode,
        newUser.name,
        newUser.phone, // Add phone for SMS in production
      );
    }

    // ✅ Generate access token AFTER commit
    const accessToken = generateAccessToken({
      userId: newUser._id,
      role: newUser.role,
      isVerified: false,
    });

    return res.status(201).json({
      success: true,
      message: "Account created. Email verification code sent.",
      data: {
        accessToken,
        refreshToken: newUser.refreshToken,
        user: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          companyId: newUser.companyId,
        },
        ...(emailResult?.etherealUrl && {
          debug: { etherealUrl: emailResult.etherealUrl },
        }),
      },
    });
  } catch (error) {
    session.endSession();

    console.error("❌ Signup error:", error);

    if (error.message === "USER_EXISTS") {
      return res
        .status(409)
        .json({ success: false, message: "User already exists" });
    }

    return res.status(500).json({
      success: false,
      message: "Signup failed",
    });
  }
};

/**
 * @desc    Sign up company driver (for company admins)
 * @route   POST /api/auth/signup-company-driver
 * @access  Private (Company Admin only)
 */
export const signUpCompanyDriver = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Check if user is company admin
    if (req.user.role !== "company_admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only company admins can register drivers",
      });
    }

    const { name, email, password, phone } = req.body;

    // Validate required fields
    if (!name || !email || !password || !phone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and phone are required",
      });
    }

    console.log("📝 Company driver signup request:", {
      name,
      email,
      companyId: req.user.companyId,
    });

    // Check existing user
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    }).session(session);

    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists",
      });
    }

    // Generate email verification code
    const emailCode = generateVerificationCode();
    const emailExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    console.log("🔐 Generated email code:", emailCode);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create driver user
    const newUser = await User.create(
      [
        {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          phone,
          role: "driver",
          companyId: req.user.companyId, // Use the company admin's company
          emailVerificationToken: emailCode,
          emailVerificationExpires: emailExpiry,
          failedLoginAttempts: 0,
          isActive: true,
          isVerified: false,
        },
      ],
      { session },
    );

    console.log("🚗 Company driver created:", newUser[0]._id);

    // Driver details
    const {
      licenseNumber,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      licenseExpiry,
    } = req.body;

    // Create driver profile
    await Driver.create(
      [
        {
          userId: newUser[0]._id,
          companyId: req.user.companyId,
          licenseNumber,
          vehicleType,
          vehicleMake,
          vehicleModel,
          vehicleYear,
          vehicleColor,
          plateNumber,
          licenseExpiry,
          approvalStatus: "pending",
          isOnline: false,
          isAvailable: false,
          canAcceptDeliveries: true,
        },
      ],
      { session },
    );

    // Send verification email
    await sendVerificationEmail(email, emailCode, name);

    // Generate tokens for the driver
    const accessToken = generateAccessToken({
      userId: newUser[0]._id,
      role: newUser[0].role,
      isVerified: false,
    });

    const refreshToken = generateRefreshToken({
      userId: newUser[0]._id,
    });

    newUser[0].refreshToken = refreshToken;
    await newUser[0].save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: "Driver account created successfully. Verification code sent.",
      data: {
        accessToken,
        refreshToken,
        user: {
          _id: newUser[0]._id,
          name: newUser[0].name,
          email: newUser[0].email,
          phone: newUser[0].phone,
          role: newUser[0].role,
          isVerified: false,
          companyId: newUser[0].companyId,
        },
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Company driver signup error:", error);

    res.status(500).json({
      success: false,
      message: "Driver registration failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Sign in user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const signIn = async (req, res) => {
  try {
    const { email, phone, password, emailOrPhone } = req.body;

    // Determine the identifier
    let userIdentifier;

    if (emailOrPhone) {
      userIdentifier = emailOrPhone;
    } else if (email) {
      userIdentifier = email;
    } else if (phone) {
      userIdentifier = phone;
    }

    if (!userIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/Phone and password are required",
      });
    }

    // Find user
    const query = {
      $or: [
        { email: userIdentifier.toLowerCase().trim() },
        { phone: userIdentifier.trim() },
      ],
    };

    const user = await User.findOne(query)
      .select(
        "+password +failedLoginAttempts +isLocked +refreshToken +emailVerificationToken",
      )
      .populate("companyId");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(403).json({
        success: false,
        message: "Account is locked due to too many failed attempts",
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated",
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      // Increment failed attempts
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      user.lastFailedLogin = new Date();

      // Lock account after 5 failed attempts
      if (user.failedLoginAttempts >= 5) {
        user.isLocked = true;
      }

      await user.save();

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Reset failed attempts on successful login
    user.failedLoginAttempts = 0;
    user.isLocked = false;
    user.lastLoginAt = new Date();

    // For company admins, check company status
    // if (user.role === "company_admin" && user.companyId) {
    //   if (user.companyId.status !== "approved") {
    //     return res.status(403).json({
    //       success: false,
    //       message: "Company not approved yet",
    //       companyStatus: user.companyId.status
    //     });
    //   }
    // }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: user._id,
      role: user.role,
      isVerified: user.isVerified,
    });

    const refreshToken = generateRefreshToken({
      userId: user._id,
    });

    user.refreshToken = refreshToken;
    await user.save();

    // Remove sensitive data
    const userObject = user.toObject();
    delete userObject.password;
    delete userObject.refreshToken;
    delete userObject.emailVerificationToken;
    delete userObject.resetPasswordToken;
    delete userObject.resetPasswordExpires;

    // For drivers, fetch driver profile
    let driverProfile = null;
    if (user.role === "driver") {
      driverProfile = await Driver.findOne({
        userId: user._id,
        companyId: user.companyId,
      });
    }

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        accessToken,
        refreshToken,
        user: {
          ...userObject,
          driverProfile: driverProfile
            ? {
                _id: driverProfile._id,
                licenseNumber: driverProfile.licenseNumber,
                licenseExpiry: driverProfile.licenseExpiry,
                vehicleType: driverProfile.vehicleType,
                vehicleMake: driverProfile.vehicleMake,
                vehicleModel: driverProfile.vehicleModel,
                vehicleYear: driverProfile.vehicleYear,
                vehicleColor: driverProfile.vehicleColor,
                plateNumber: driverProfile.plateNumber,
                approvalStatus: driverProfile.approvalStatus,
                isOnline: driverProfile.isOnline,
                isAvailable: driverProfile.isAvailable,
                canAcceptDeliveries: driverProfile.canAcceptDeliveries,
                currentLocation: driverProfile.currentLocation,
                rating: driverProfile.rating,
                totalRides: driverProfile.totalRides,
                earnings: driverProfile.earnings,
              }
            : null,
        },
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * @desc    Verify email
 * @route   POST /api/auth/verify-email
 * @access  Public
 */
export const verifyEmail = async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({
        success: false,
        message: "Email and code are required",
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+emailVerificationToken",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.emailVerifiedAt) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
        alreadyVerified: true,
      });
    }

    if (!user.emailVerificationToken || !user.emailVerificationExpires) {
      return res.status(400).json({
        success: false,
        message: "No active verification found",
      });
    }

    if (Date.now() > user.emailVerificationExpires) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired",
      });
    }

    if (user.emailVerificationToken !== token) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Update user
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.isVerified = true;

    await user.save();

    // Generate new token for verified user
    const newAccessToken = generateAccessToken({
      userId: user._id,
      role: user.role,
      isVerified: true,
    });

    res.status(200).json({
      success: true,
      message: "Email verified successfully!",
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: true,
          companyId: user.companyId,
        },
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    console.error("❌ Email verification error:", error);
    res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
};

/**
 * @desc    Forgot password
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal that user doesn't exist for security
      return res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, a reset code will be sent",
      });
    }

    // Generate OTP
    const otp = generateVerificationCode();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Save OTP to user
    user.resetPasswordToken = otp;
    user.resetPasswordExpires = otpExpiry;
    await user.save();

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, user.name, user.phone);

    res.status(200).json({
      success: true,
      message: "Password reset code sent to your email",
      ...(process.env.NODE_ENV === "development" && {
        debug: {
          otp,
          ...(emailResult?.etherealUrl && {
            etherealUrl: emailResult.etherealUrl,
          }),
        },
      }),
    });
  } catch (error) {
    console.error("❌ Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process request",
    });
  }
};

/**
 * @desc    Reset password
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: otp,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset tokens
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    user.failedLoginAttempts = 0;
    user.isLocked = false;
    user.refreshToken = null; // Force re-login on all devices

    await user.save();

    res.status(200).json({
      success: true,
      message:
        "Password reset successfully. Please login with your new password.",
    });
  } catch (error) {
    console.error("❌ Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  }
};

/**
 * @desc    Change password (authenticated)
 * @route   POST /api/auth/change-password
 * @access  Private
 */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current and new passwords are required",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const user = await User.findById(userId).select("+password");

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash and save new password
    user.password = await bcrypt.hash(newPassword, 10);
    user.refreshToken = null; // Force re-login
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("❌ Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
};

/**
 * @desc    Resend verification code
 * @route   POST /api/auth/resend-verification
 * @access  Public
 */
export const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "User already verified",
      });
    }

    // Generate new email verification code
    const newCode = generateVerificationCode();

    user.emailVerificationToken = newCode;
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
    await user.save();

    // Send verification email
    await sendVerificationEmail(email, newCode, user.name, user.phone);

    res.status(200).json({
      success: true,
      message: "Verification code resent to your email",
    });
  } catch (error) {
    console.error("❌ Resend verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend code",
    });
  }
};

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh
 * @access  Public
 */
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: oldRefreshToken } = req.body;

    if (!oldRefreshToken) {
      return res.status(400).json({
        success: false,
        message: "Refresh token required",
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(
        oldRefreshToken,
        process.env.JWT_REFRESH_SECRET ||
          process.env.JWT_SECRET ||
          "fallback-secret-key-change-in-production",
      );
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // Find user
    const user = await User.findOne({
      _id: decoded.userId,
      refreshToken: oldRefreshToken,
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid token or account deactivated",
      });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({
      userId: user._id,
      role: user.role,
      isVerified: user.isVerified,
    });

    const newRefreshToken = generateRefreshToken({
      userId: user._id,
    });

    user.refreshToken = newRefreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    console.error("❌ Token refresh error:", error);
    res.status(500).json({
      success: false,
      message: "Token refresh failed",
    });
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshToken: null });
    }

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("❌ Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};

/**
 * @desc    Get current user
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("companyId")
      .select(
        "-password -refreshToken -emailVerificationToken -resetPasswordToken",
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // For drivers, fetch driver profile
    let driverProfile = null;
    if (user.role === "driver") {
      driverProfile = await Driver.findOne({
        userId: user._id,
        companyId: user.companyId,
      });
    }

    const userObject = user.toObject();

    res.status(200).json({
      success: true,
      data: {
        ...userObject,
        driverProfile: driverProfile
          ? {
              _id: driverProfile._id,
              licenseNumber: driverProfile.licenseNumber,
              licenseExpiry: driverProfile.licenseExpiry,
              vehicleType: driverProfile.vehicleType,
              vehicleMake: driverProfile.vehicleMake,
              vehicleModel: driverProfile.vehicleModel,
              vehicleYear: driverProfile.vehicleYear,
              vehicleColor: driverProfile.vehicleColor,
              plateNumber: driverProfile.plateNumber,
              approvalStatus: driverProfile.approvalStatus,
              isOnline: driverProfile.isOnline,
              isAvailable: driverProfile.isAvailable,
              canAcceptDeliveries: driverProfile.canAcceptDeliveries,
              currentLocation: driverProfile.currentLocation,
              rating: driverProfile.rating,
              totalRides: driverProfile.totalRides,
              earnings: driverProfile.earnings,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("❌ Get me error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user data",
    });
  }
};

/**
 * @desc    Update profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, phone, avatarUrl } = req.body;

    const updates = {};

    if (name && name.trim().length >= 2) {
      updates.name = name.trim();
    }

    if (phone) {
      // Check if phone is already taken
      const existingUser = await User.findOne({
        phone,
        _id: { $ne: userId },
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Phone number already in use",
        });
      }
      updates.phone = phone;
    }

    if (avatarUrl !== undefined) {
      updates.avatarUrl = avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true },
    ).select("-password -refreshToken");

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("❌ Update profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

/**
 * @desc    Test endpoint
 * @route   GET /api/auth/test
 * @access  Public
 */
export const testEndpoint = async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Auth endpoint is working!",
    timestamp: new Date().toISOString(),
  });
};
