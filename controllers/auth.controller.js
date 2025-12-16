import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

/**
 * -------------------------------
 * UTILITY FUNCTIONS
 * -------------------------------
 */

// Generate random verification code
const generateVerificationCode = (length = process.env.VERIFICATION_CODE_LENGTH || 6) => {
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
};

// Generate JWT tokens
const generateAccessToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }
  );
};

const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' }
  );
};

// Email transporter
const createEmailTransporter = () => {
  console.log('🔧 Creating email transporter...');
  console.log('Host:', process.env.EMAIL_HOST);
  console.log('Port:', process.env.EMAIL_PORT);
  console.log('User:', process.env.EMAIL_USER);
  console.log('Password set:', !!process.env.EMAIL_PASSWORD);
  
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

// Send verification email
const sendVerificationEmail = async (email, code, name) => {
  try {
    console.log(`📧 Attempting to send verification email to: ${email}`);
    console.log(`📧 Verification code: ${code}`);
    
    const transporter = createEmailTransporter();
    
    const mailOptions = {
      from: `"Riderr" <${process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@riderr.com'}>`,
      to: email,
      subject: 'Your Riderr Verification Code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Riderr Verification</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #337bff, #5a95ff); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; color: white; }
            .content { padding: 30px; background: #f8f9fa; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; }
            .code { background: #337bff; color: white; padding: 20px 40px; border-radius: 10px; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; text-align: center; display: inline-block; }
            .note { background: #e8f0ff; padding: 15px; border-radius: 8px; margin: 25px 0; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #999; font-size: 12px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 style="margin: 0;">Riderr</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Account Verification</p>
          </div>
          
          <div class="content">
            <h2 style="color: #333; margin-top: 0;">Hello ${name},</h2>
            
            <p>Thank you for registering with Riderr! Here is your verification code:</p>
            
            <div style="text-align: center;">
              <div class="code">${code}</div>
            </div>
            
            <p>Enter this code in the verification screen to verify your account.</p>
            <p>This code will expire in 24 hours.</p>
            
            <div class="note">
              <p style="margin: 0; font-size: 14px;">
                <strong>Note:</strong> If you didn't request this code, please ignore this email.
              </p>
            </div>
            
            <div class="footer">
              <p>© ${new Date().getFullYear()} Riderr. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Hi ${name},\n\nYour Riderr verification code is: ${code}\n\nEnter this code in the app to verify your account.\n\nThis code expires in 24 hours.\n\nIf you didn't request this, please ignore this email.\n\nThanks,\nThe Riderr Team`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${email}: ${info.messageId}`);
    console.log(`🔑 For development: Verification code = ${code}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
    console.log(`🔑 EMAIL CODE (for testing): ${code}`);
    throw new Error('Failed to send verification email');
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
  
  try {
    const { name, email, password, role, phone } = req.body;
    const { companyId } = req.params; // For rider registration

    console.log(`📝 Signup attempt: ${name} (${email})`);

    // Validate required fields
    if (!name || !email || !password || !role || !phone) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // Validate role
    const validRoles = ["customer", "company", "rider", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be customer, company, rider, or admin"
      });
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    // Validate phone (simplified)
    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''))) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format (10-15 digits)"
      });
    }

    // Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
      });
    }

    // Start transaction
    session.startTransaction();

    // Check for existing user
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    }).session(session);
    
    if (existingUser) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists"
      });
    }

    let newUser;
    let requiresVerification = false;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate verification code
    const verificationCode = generateVerificationCode();
    const emailExpiry = Date.now() + (parseInt(process.env.EMAIL_VERIFICATION_EXPIRY) || 24) * 60 * 60 * 1000;

    // Handle different user roles
    if (role === "company") {
      // Company registration
      const { companyName, address, city, lga, contactPhone, contactEmail } = req.body;

      if (!companyName || !city) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Company name and city are required"
        });
      }

      // Check for existing company
      const existingCompany = await Company.findOne({
        $or: [
          { name: companyName },
          { contactEmail: contactEmail || email },
          { contactPhone: contactPhone || phone }
        ]
      }).session(session);

      if (existingCompany) {
        await session.abortTransaction();
        return res.status(409).json({
          success: false,
          message: "Company with this name, email or phone already exists"
        });
      }

      // Create company
      const company = await Company.create([{
        name: companyName,
        address,
        city,
        lga,
        contactPhone: contactPhone || phone,
        contactEmail: contactEmail || email,
        status: "pending"
      }], { session });

      // Create company admin user
      newUser = await User.create([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phone,
        role: "company_admin",
        companyId: company[0]._id,
        isVerified: false,
        isActive: true,
        emailVerificationToken: verificationCode,
        emailVerificationExpires: emailExpiry,
        verificationAttempts: 0
      }], { session });

      requiresVerification = true;

    } else if (role === "rider") {
      // Rider registration
      if (!companyId) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Riders must belong to a company"
        });
      }

      // Verify company exists
      const company = await Company.findById(companyId).session(session);
      if (!company) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Create rider user
      newUser = await User.create([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phone,
        role: "rider",
        companyId,
        isVerified: false,
        isActive: true,
        emailVerificationToken: verificationCode,
        emailVerificationExpires: emailExpiry,
        verificationAttempts: 0
      }], { session });

      requiresVerification = true;

    } else {
      // Customer or admin registration
      const isAdmin = role === "admin";
      
      newUser = await User.create([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phone,
        role: role,
        companyId: null,
        isVerified: isAdmin, // Admins are auto-verified
        isActive: true,
        emailVerificationToken: isAdmin ? null : verificationCode,
        emailVerificationExpires: isAdmin ? null : emailExpiry,
        verificationAttempts: 0
      }], { session });

      requiresVerification = !isAdmin;
    }

    // Send verification email if required
    let emailResult = null;

    if (requiresVerification) {
      try {
        // Send Email
        emailResult = await sendVerificationEmail(email, verificationCode, name);
        console.log(`📧 Email sent to ${email}: ${emailResult.success ? 'Success' : 'Failed'}`);
      } catch (emailError) {
        console.error('Email sending error:', emailError.message);
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken({ 
      userId: newUser[0]._id, 
      role: newUser[0].role,
      isVerified: newUser[0].isVerified
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: newUser[0]._id 
    });

    // Save refresh token
    newUser[0].refreshToken = refreshToken;
    await newUser[0].save({ session });

    // Commit transaction
    await session.commitTransaction();
    
    // Prepare response
    const userResponse = {
      _id: newUser[0]._id,
      name: newUser[0].name,
      email: newUser[0].email,
      phone: newUser[0].phone,
      role: newUser[0].role,
      isVerified: newUser[0].isVerified,
      isActive: newUser[0].isActive,
      createdAt: newUser[0].createdAt
    };

    // Build success message
    let message = "Account created successfully";
    if (requiresVerification) {
      message += ". Verification email has been sent to your email address.";
      if (process.env.NODE_ENV === 'development') {
        message += `\n\n🔑 Development: Verification code = ${verificationCode}`;
      }
    }

    res.status(201).json({
      success: true,
      message,
      requiresVerification,
      data: {
        accessToken,
        refreshToken,
        user: userResponse
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Signup error:', error);
    
    res.status(500).json({
      success: false,
      message: "Signup failed due to server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Sign in user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const signIn = async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/Phone and password are required"
      });
    }

    // Find user
    const user = await User.findOne({
      $or: [
        { email: emailOrPhone.toLowerCase() },
        { phone: emailOrPhone }
      ]
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated. Please contact support."
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Check if verification is required
    if (!user.isVerified) {
      return res.status(200).json({
        success: true,
        message: 'Account verification required',
        requiresVerification: true,
        data: {
          userId: user._id,
          email: user.email,
          phone: user.phone,
          role: user.role
        }
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken({ 
      userId: user._id, 
      role: user.role,
      isVerified: user.isVerified
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: user._id 
    });

    // Save refresh token
    user.refreshToken = refreshToken;
    user.lastSeenAt = new Date();
    await user.save();

    // Prepare response
    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt
    };

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
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: "Login failed due to server error"
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
    const { email, code, userId } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required"
      });
    }

    // Find user
    let user;
    if (userId) {
      user = await User.findById(userId).select('+emailVerificationToken');
    } else {
      user = await User.findOne({ email: email.toLowerCase() }).select('+emailVerificationToken');
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        success: true,
        message: "Email already verified",
        data: { isVerified: true }
      });
    }

    if (!user.emailVerificationToken || !user.emailVerificationExpires) {
      return res.status(400).json({
        success: false,
        message: "No active verification found. Please request a new code."
      });
    }

    if (Date.now() > user.emailVerificationExpires) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired. Please request a new code."
      });
    }

    // Verify the code
    if (user.emailVerificationToken !== code) {
      user.verificationAttempts += 1;
      await user.save();
      
      if (user.verificationAttempts >= 5) {
        return res.status(429).json({
          success: false,
          message: "Too many verification attempts. Please request a new code."
        });
      }
      
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
        attemptsRemaining: 5 - user.verificationAttempts
      });
    }

    // Code is valid - update user
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.verificationAttempts = 0;
    user.isVerified = true;
    
    // Generate new token
    const newAccessToken = generateAccessToken({ 
      userId: user._id, 
      role: user.role,
      isVerified: true
    });
    
    await user.save();

    // Prepare response
    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVerified: user.isVerified,
      emailVerified: true
    };

    return res.status(200).json({
      success: true,
      message: "Email verified successfully! Your account is now active.",
      data: {
        user: userResponse,
        isVerified: user.isVerified,
        accessToken: newAccessToken
      }
    });

  } catch (error) {
    console.error('❌ Email verification error:', error);
    res.status(500).json({
      success: false,
      message: "Email verification failed due to server error"
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
    const { email, userId } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Find user
    let user;
    if (userId) {
      user = await User.findById(userId);
    } else {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "User is already verified"
      });
    }

    // Generate new code
    const newCode = generateVerificationCode();
    const emailExpiry = Date.now() + (parseInt(process.env.EMAIL_VERIFICATION_EXPIRY) || 24) * 60 * 60 * 1000;

    // Update email verification
    user.emailVerificationToken = newCode;
    user.emailVerificationExpires = emailExpiry;
    user.verificationAttempts = 0;
    
    // Send email
    await sendVerificationEmail(user.email, newCode, user.name);
    
    await user.save();

    res.status(200).json({
      success: true,
      message: "Verification code resent to your email",
      data: {
        expiresIn: `${process.env.EMAIL_VERIFICATION_EXPIRY || 24} hours`
      }
    });

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to resend verification code"
    });
  }
};

/**
 * @desc    Check verification status
 * @route   POST /api/auth/check-verification
 * @access  Public
 */
export const checkVerificationStatus = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      data: {
        isVerified: user.isVerified,
        email: user.email,
        role: user.role,
        requiresVerification: !user.isVerified
      }
    });

  } catch (error) {
    console.error('❌ Check verification status error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to check verification status"
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
        message: "Refresh token is required"
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token"
      });
    }

    // Find user with matching refresh token
    const user = await User.findOne({
      _id: decoded.userId,
      refreshToken: oldRefreshToken
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token"
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated"
      });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({ 
      userId: user._id, 
      role: user.role,
      isVerified: user.isVerified
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
        refreshToken: newRefreshToken,
        isVerified: user.isVerified
      }
    });

  } catch (error) {
    console.error('❌ Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: "Token refresh failed"
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

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User authentication required"
      });
    }

    const user = await User.findById(userId);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      message: "Logout failed"
    });
  }
};

/**
 * @desc    Logout from all devices
 * @route   POST /api/auth/logout-all
 * @access  Private
 */
export const logoutAll = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User authentication required"
      });
    }

    const user = await User.findById(userId);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "Logged out from all devices successfully"
    });

  } catch (error) {
    console.error('❌ Logout all error:', error);
    res.status(500).json({
      success: false,
      message: "Logout failed"
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
    const user = req.user;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt,
      emailVerified: !!user.emailVerifiedAt
    };

    res.status(200).json({
      success: true,
      data: userResponse
    });

  } catch (error) {
    console.error('❌ Get me error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to get user data"
    });
  }
};

/**
 * @desc    Test endpoint for debugging
 * @route   GET /api/auth/test
 * @access  Public
 */
export const testEndpoint = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      message: "Auth API is working",
      timestamp: new Date().toISOString(),
      emailConfigured: !!process.env.EMAIL_USER
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * @desc    Debug endpoint for development
 * @route   POST /api/auth/debug-code
 * @access  Public
 */
export const getDebugCode = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({
        success: false,
        message: 'Debug only available in development'
      });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      code: {
        emailCode: user.emailVerificationToken,
        emailExpires: user.emailVerificationExpires,
        isVerified: user.isVerified
      }
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};