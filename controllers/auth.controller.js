import User from "../models/user.models.js";
import Company from "../models/company.models.js";
import Driver from "../models/riders.models.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

/**
 * -------------------------------
 * UTILITY FUNCTIONS
 * -------------------------------
 */

// Generate random verification code
const generateVerificationCode = (length = 6) => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate JWT tokens
const generateAccessToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'fallback-secret-key-change-in-production',
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '24h' }
  );
};

const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'fallback-secret-key-change-in-production',
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' }
  );
};

// Email transporter
const createEmailTransporter = () => {
  try {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'test@example.com',
        pass: process.env.EMAIL_PASSWORD || 'testpassword'
      },
      tls: { rejectUnauthorized: false }
    });
  } catch (error) {
    console.log('📧 Email transporter not configured, running in dev mode');
    return null;
  }
};

// Send verification email (ONLY EMAIL, NO SMS)
const sendVerificationEmail = async (email, code, name) => {
  try {
    const transporter = createEmailTransporter();
    
    if (!transporter) {
      console.log(`📧 DEV MODE: Email verification code for ${email}: ${code}`);
      return { success: true, devMode: true };
    }
    
    const mailOptions = {
      from: `"Riderr" <${process.env.EMAIL_USER || 'noreply@riderr.com'}>`,
      to: email,
      subject: 'Your Riderr Verification Code',
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
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Email error:', error.message);
    console.log(`📧 FALLBACK: Email verification code for ${email}: ${code}`);
    return { success: true, devMode: true };
  }
};

/**
 * -------------------------------
 * DEBUG ENDPOINTS (TEMPORARY)
 * -------------------------------
 */

/**
 * @desc    Debug: Check raw user data
 * @route   POST /api/auth/debug-user
 * @access  Public
 */
export const debugUser = async (req, res) => {
  try {
    const { email, phone } = req.body;
    
    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() })
        .select('+password +refreshToken +emailVerificationToken +resetPasswordToken');
    } else if (phone) {
      user = await User.findOne({ phone })
        .select('+password +refreshToken +emailVerificationToken +resetPasswordToken');
    } else {
      return res.status(400).json({
        success: false,
        message: "Email or phone required"
      });
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        email: user.email,
        phone: user.phone,
        emailVerificationToken: user.emailVerificationToken,
        emailVerificationExpires: user.emailVerificationExpires,
        emailVerifiedAt: user.emailVerifiedAt,
        isVerified: user.isVerified,
        rawData: user.toObject()
      }
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      message: "Debug failed"
    });
  }
};

/**
 * @desc    Check user verification status
 * @route   POST /api/auth/check-verification
 * @access  Public
 */
export const checkVerificationStatus = async (req, res) => {
  try {
    const { email, phone } = req.body;
    
    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() })
        .select('+emailVerificationToken');
    } else if (phone) {
      user = await User.findOne({ phone })
        .select('+emailVerificationToken');
    } else {
      return res.status(400).json({
        success: false,
        message: "Email or phone required"
      });
    }
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          phone: user.phone,
          role: user.role,
          emailVerificationToken: user.emailVerificationToken || "NOT SET",
          emailVerificationExpires: user.emailVerificationExpires 
            ? new Date(user.emailVerificationExpires).toISOString() 
            : "NOT SET",
          emailVerifiedAt: user.emailVerifiedAt 
            ? new Date(user.emailVerifiedAt).toISOString() 
            : "NOT VERIFIED",
          isVerified: user.isVerified,
          createdAt: user.createdAt
        },
        currentTime: new Date().toISOString(),
        codeExpired: user.emailVerificationExpires 
          ? Date.now() > user.emailVerificationExpires 
          : "NO EXPIRY SET"
      }
    });
    
  } catch (error) {
    console.error('Check verification error:', error);
    res.status(500).json({
      success: false,
      message: "Check failed"
    });
  }
};

/**
 * -------------------------------
 * AUTH CONTROLLERS
 * -------------------------------
 */

/**
 * @desc    Sign up a new user (ONLY EMAIL VERIFICATION)
 * @route   POST /api/auth/signup
 * @access  Public
 */
export const signUp = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const { name, email, password, role, phone } = req.body;

    console.log('📝 Signup request:', { name, email, role, phone });

    // Validation
    if (!name || !email || !password || !role || !phone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // Validate role
    const validRoles = ["customer", "company_admin", "driver", "admin"];
    if (!validRoles.includes(role)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid role"
      });
    }

    // Check existing user
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    }).session(session);
    
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists"
      });
    }

    // Generate email verification code (ONLY EMAIL, NO PHONE CODE)
    const emailCode = generateVerificationCode();
    const emailExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    console.log('🔐 Generated email code:', emailCode);

    let newUser;
    let company = null;
    const hashedPassword = await bcrypt.hash(password, 10);

    if (role === "company_admin") {
      // Company registration
      const { companyName, address, city, state, lga, businessLicense, taxId, 
              bankName, accountName, accountNumber, companyPhone } = req.body; // Added companyPhone

      if (!companyName || !city || !state || !businessLicense || !taxId || !companyPhone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Company details required: name, city, state, business license, tax ID, company phone"
        });
      }

      // Check existing company
      const existingCompany = await Company.findOne({
        $or: [
          { name: companyName },
          { contactEmail: email },
          { businessLicense }
        ]
      }).session(session);

      if (existingCompany) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          success: false,
          message: "Company already exists"
        });
      }

      // Create company
      company = await Company.create([{
        name: companyName,
        address,
        city,
        state,
        lga,
        businessLicense,
        taxId,
        contactPhone: companyPhone, // Use separate company phone
        contactEmail: email,
        password: hashedPassword,
        status: "pending",
        bankDetails: {
          bankName,
          accountName,
          accountNumber
        }
      }], { session });

      // Create company admin user
      newUser = await User.create([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phone,
        role: "company_admin",
        companyId: company[0]._id,
        emailVerificationToken: emailCode,
        emailVerificationExpires: emailExpiry,
        failedLoginAttempts: 0,
        isActive: true,
        isVerified: false
      }], { session });

      console.log('🏢 Company admin created:', newUser[0]._id);

    } else if (role === "driver") {
      // Driver registration by company
      const { companyId } = req.params;

      if (!companyId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Drivers must belong to a company"
        });
      }

      // Verify company exists and is approved
      company = await Company.findById(companyId).session(session);
      if (!company || company.status !== "approved") {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Company not found or not approved"
        });
      }

      // Create driver user
      newUser = await User.create([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phone,
        role: "driver",
        companyId,
        emailVerificationToken: emailCode,
        emailVerificationExpires: emailExpiry,
        failedLoginAttempts: 0,
        isActive: true,
        isVerified: false
      }], { session });

      console.log('🚗 Driver created:', newUser[0]._id);

      // Create driver profile
      const { licenseNumber, vehicleType, vehicleMake, vehicleModel, vehicleYear, 
              vehicleColor, plateNumber, licenseExpiry } = req.body;

      if (!licenseNumber || !vehicleType || !plateNumber || !licenseExpiry) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Driver details required: license number, vehicle type, plate number, license expiry"
        });
      }

      await Driver.create([{
        userId: newUser[0]._id,
        companyId,
        licenseNumber,
        vehicleType,
        vehicleMake,
        vehicleModel,
        vehicleYear,
        vehicleColor,
        plateNumber,
        licenseExpiry,
        approvalStatus: "pending"
      }], { session });

    } else {
      // Customer or admin registration
      newUser = await User.create([{
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phone,
        role,
        emailVerificationToken: emailCode,
        emailVerificationExpires: emailExpiry,
        failedLoginAttempts: 0,
        isActive: true,
        isVerified: false
      }], { session });

      console.log('👤 User created:', newUser[0]._id);
    }

    // Fetch the user with verification token
    const userWithToken = await User.findById(newUser[0]._id)
      .select('+emailVerificationToken')
      .session(session);
    
    console.log('✅ User created with email token:', {
      userId: userWithToken._id,
      savedEmailCode: userWithToken.emailVerificationToken,
      emailExpiry: userWithToken.emailVerificationExpires
    });

    // Send verification email (ONLY EMAIL)
    const requiresVerification = role !== "admin";
    
    if (requiresVerification) {
      const emailResult = await sendVerificationEmail(email, emailCode, name);
      
      console.log('📨 Email sent:', { 
        emailSent: emailResult.success
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken({ 
      userId: newUser[0]._id, 
      role: newUser[0].role,
      isVerified: false
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: newUser[0]._id 
    });

    newUser[0].refreshToken = refreshToken;
    await newUser[0].save({ session });

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: requiresVerification 
        ? "Account created. Email verification code sent."
        : "Account created successfully",
      requiresVerification,
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
          companyId: newUser[0].companyId
        }
      },
      // In development, show the code for testing
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          emailCode,
          userId: newUser[0]._id
        }
      })
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Signup error:', error);
    
    res.status(500).json({
      success: false,
      message: "Signup failed",
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
/**
 * @desc    Sign in user
 * @route   POST /api/auth/login
 * @access  Public
 */
/**
 * @desc    Sign in user with complete user data
 * @route   POST /api/auth/login
 * @access  Public
 */
export const signIn = async (req, res) => {
  try {
    console.log('🔑 Login request body:', JSON.stringify(req.body, null, 2));
    
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
      console.log('❌ Missing credentials:', { userIdentifier, hasPassword: !!password });
      return res.status(400).json({
        success: false,
        message: "Email/Phone and password are required"
      });
    }

    console.log('🔍 Looking for user with identifier:', userIdentifier);

    // Find user by email or phone
    const query = {
      $or: [
        { email: userIdentifier.toLowerCase().trim() },
        { phone: userIdentifier.trim() }
      ]
    };

    console.log('📋 Search query:', JSON.stringify(query, null, 2));

    // Find user with password and sensitive fields
    const user = await User.findOne(query)
      .select('+password +failedLoginAttempts +isLocked +refreshToken +emailVerificationToken')
      .populate('companyId'); // Populate company data
    
    if (!user) {
      console.log('❌ User not found with query:', query);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    console.log('✅ User found:', {
      _id: user._id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      isLocked: user.isLocked,
      isVerified: user.isVerified
    });

    // Check if account is locked
    if (user.isLocked) {
      console.log('🔒 Account is locked for user:', user.email);
      return res.status(403).json({
        success: false,
        message: "Account is locked due to too many failed attempts"
      });
    }

    // Check if account is active
    if (!user.isActive) {
      console.log('❌ Account is deactivated for user:', user.email);
      return res.status(403).json({
        success: false,
        message: "Account is deactivated"
      });
    }

    // Check password
    let isPasswordValid;
    try {
      isPasswordValid = await bcrypt.compare(password, user.password);
      console.log('🔐 Password comparison result:', isPasswordValid);
    } catch (bcryptError) {
      console.error('❌ Bcrypt comparison error:', bcryptError);
      return res.status(500).json({
        success: false,
        message: "Authentication error"
      });
    }
    
    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', user.email);
      
      // Increment failed attempts
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      user.lastFailedLogin = new Date();
      
      // Lock account after 5 failed attempts
      if (user.failedLoginAttempts >= 5) {
        user.isLocked = true;
        console.log('🔒 Account locked after 5 failed attempts:', user.email);
      }
      
      await user.save();
      
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // ✅ Password is valid!
    console.log('✅ Password validated for user:', user.email);

    // Reset failed attempts on successful login
    user.failedLoginAttempts = 0;
    user.isLocked = false;
    user.lastLoginAt = new Date();
    await user.save();

    // For company admins, check company status
    if (user.role === "company_admin" && user.companyId) {
      const company = await Company.findById(user.companyId);
      if (!company || company.status !== "approved") {
        console.log('⚠️ Company not approved:', company?.status);
        return res.status(403).json({
          success: false,
          message: "Company not approved yet",
          companyStatus: company?.status
        });
      }
    }

    // Check email verification status
    const isEmailVerified = !!user.emailVerifiedAt;

    if (!isEmailVerified) {
      console.log('⚠️ Email not verified for user:', user.email);
      return res.status(403).json({
        success: true,
        message: 'Email verification required',
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
      isVerified: true
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: user._id 
    });

    user.refreshToken = refreshToken;
    await user.save();

    // Convert user to object and remove sensitive data
    const userObject = user.toObject();
    
    // Remove sensitive fields
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
        companyId: user.companyId 
      });
    }

    console.log('✅ Login successful for:', user.email);

    // Return complete user data
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        accessToken,
        refreshToken,
        user: {
          // Basic Information
          _id: userObject._id,
          name: userObject.name,
          email: userObject.email,
          phone: userObject.phone,
          role: userObject.role,
          
          // Verification Status
          isVerified: userObject.isVerified,
          emailVerifiedAt: userObject.emailVerifiedAt,
          phoneVerifiedAt: userObject.phoneVerifiedAt,
          
          // Account Status
          isActive: userObject.isActive,
          isLocked: userObject.isLocked,
          failedLoginAttempts: userObject.failedLoginAttempts,
          
          // Company Information
          companyId: userObject.companyId?._id || userObject.companyId,
          company: userObject.companyId ? {
            _id: userObject.companyId._id,
            name: userObject.companyId.name,
            address: userObject.companyId.address,
            city: userObject.companyId.city,
            state: userObject.companyId.state,
            contactPhone: userObject.companyId.contactPhone,
            contactEmail: userObject.companyId.contactEmail,
            status: userObject.companyId.status,
            businessLicense: userObject.companyId.businessLicense,
            taxId: userObject.companyId.taxId
          } : null,
          
          // Driver Profile (for drivers only)
          driverProfile: driverProfile ? {
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
            currentLocation: driverProfile.currentLocation,
            rating: driverProfile.rating,
            totalRides: driverProfile.totalRides,
            earnings: driverProfile.earnings
          } : null,
          
          // Additional User Fields (if they exist in your schema)
          profileImage: userObject.profileImage || null,
          dateOfBirth: userObject.dateOfBirth || null,
          gender: userObject.gender || null,
          address: userObject.address || null,
          city: userObject.city || null,
          state: userObject.state || null,
          country: userObject.country || null,
          postalCode: userObject.postalCode || null,
          
          // Activity Tracking
          lastLoginAt: userObject.lastLoginAt,
          lastFailedLogin: userObject.lastFailedLogin,
          
          // Timestamps
          createdAt: userObject.createdAt,
          updatedAt: userObject.updatedAt,
          
          // Preferences (if you have them)
          preferences: userObject.preferences || {},
          notifications: userObject.notifications || {},
          settings: userObject.settings || {}
        }
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
/**
 * @desc    Verify email (ONLY EMAIL VERIFICATION)
 * @route   POST /api/auth/verify-email
 * @access  Public
 */
export const verifyEmail = async (req, res) => {
  try {
    const { email, token, userId } = req.body;
    
    console.log('📧 Verify email request:', { email, token, userId });

    if (!email || !token) {
      return res.status(400).json({
        success: false,
        message: "Email and code are required"
      });
    }

    // Find user - MUST INCLUDE emailVerificationToken
    let user;
    if (userId) {
      user = await User.findById(userId)
        .select('+emailVerificationToken');
    } else {
      user = await User.findOne({ email: email.toLowerCase() })
        .select('+emailVerificationToken');
    }

    if (!user) {
      console.log('❌ User not found for email verification');
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    console.log('🔍 Checking email verification token...');
    console.log('   Stored token:', user.emailVerificationToken || 'NOT SET');
    console.log('   Provided token:', token);
    console.log('   Expires:', user.emailVerificationExpires 
      ? new Date(user.emailVerificationExpires).toISOString() 
      : 'NOT SET');

    if (!user.emailVerificationToken || !user.emailVerificationExpires) {
      console.log('⚠️ No active email verification token');
      
      // Check if user is already email verified
      if (user.emailVerifiedAt) {
        return res.status(400).json({
          success: false,
          message: "Email already verified",
          alreadyVerified: true
        });
      }
      
      return res.status(400).json({
        success: false,
        message: "No active verification found"
      });
    }

    if (Date.now() > user.emailVerificationExpires) {
      console.log('⚠️ Email token expired');
      return res.status(400).json({
        success: false,
        message: "Verification code expired"
      });
    }

    if (user.emailVerificationToken !== token) {
      console.log('❌ Email token mismatch');
      return res.status(400).json({
        success: false,
        message: "Invalid verification code"
      });
    }

    // Update user - user becomes verified after email verification
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.isVerified = true; // User is now fully verified
    
    await user.save();
    
    console.log('✅ Email verified successfully');
    console.log('   Email verified at:', user.emailVerifiedAt);
    console.log('   Is verified:', user.isVerified);

    // Generate new token for verified user
    const newAccessToken = generateAccessToken({ 
      userId: user._id, 
      role: user.role,
      isVerified: true
    });
    
    console.log('✅ Generated new access token for verified user');

    res.status(200).json({
      success: true,
      message: "Email verified! Your account is now fully verified.",
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: true,
          companyId: user.companyId
        },
        accessToken: newAccessToken
      }
    });

  } catch (error) {
    console.error('❌ Email verification error:', error);
    res.status(500).json({
      success: false,
      message: "Verification failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * REMOVED: verifyPhone endpoint
 * REMOVED: requestVerification endpoint (replaced by resendVerification)
 */

/**
 * @desc    Resend verification code (EMAIL ONLY)
 * @route   POST /api/auth/resend-verification
 * @access  Public
 */
export const resendVerification = async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email && !userId) {
      return res.status(400).json({
        success: false,
        message: "Email or user ID is required"
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
        message: "User already verified"
      });
    }

    // Generate new email verification code
    const newCode = generateVerificationCode();
    
    // Set new email verification token
    user.emailVerificationToken = newCode;
    user.emailVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();
    
    // Send verification email
    await sendVerificationEmail(user.email, newCode, user.name);
    
    res.status(200).json({
      success: true,
      message: "Verification code resent to your email",
      ...(process.env.NODE_ENV === 'development' && {
        debug: { emailCode: newCode }
      })
    });

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to resend code",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
        message: "Refresh token required"
      });
    }

    console.log('🔄 Token refresh requested');

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(oldRefreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'fallback-secret-key-change-in-production');
    } catch (err) {
      console.log('❌ Invalid refresh token');
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token"
      });
    }

    // Find user
    const user = await User.findOne({
      _id: decoded.userId,
      refreshToken: oldRefreshToken
    });

    if (!user || !user.isActive) {
      console.log('❌ User not found or inactive');
      return res.status(401).json({
        success: false,
        message: "Invalid token or account deactivated"
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

    user.refreshToken = newRefreshToken;
    await user.save();

    console.log('✅ Tokens refreshed for user:', user.email);

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });

  } catch (error) {
    console.error('❌ Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: "Token refresh failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    console.log('👋 Logout request for user:', userId);

    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshToken: null });
      console.log('✅ User logged out:', userId);
    }

    res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    console.log('👤 Get current user:', user.email);

    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        companyId: user.companyId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Get me error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to get user data",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    timestamp: new Date().toISOString()
  });
};
/**
 * @desc    Emergency password reset (development only)
 * @route   POST /api/auth/reset-password-admin
 * @access  Public (TEMPORARY - REMOVE IN PRODUCTION)
 */
export const resetPasswordAdmin = async (req, res) => {
  try {
    // ONLY ALLOW IN DEVELOPMENT
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({
        success: false,
        message: "This endpoint is only available in development"
      });
    }
    
    const { email, newPassword } = req.body;
    
    if (!email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email and new password required"
      });
    }
    
    console.log('🔧 Admin password reset for:', email);
    
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update user
    user.password = hashedPassword;
    user.failedLoginAttempts = 0;
    user.isLocked = false;
    await user.save();
    
    console.log('✅ Password reset successful for:', email);
    
    res.status(200).json({
      success: true,
      message: "Password reset successful",
      data: {
        email: user.email,
        passwordHashPreview: hashedPassword.substring(0, 20) + '...'
      }
    });
    
  } catch (error) {
    console.error('❌ Password reset error:', error);
    res.status(500).json({
      success: false,
      message: "Password reset failed",
      error: error.message
    });
  }
};


/**
 * @desc    Create a driver for a specific company
 * @route   POST /api/auth/signup/companies/:companyId/drivers
 * @access  Public (but company must exist)
 */
export const signUpCompanyDriver = async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      name,
      email,
      phone,
      password,
      licenseNumber,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      licenseExpiry
    } = req.body;

    console.log('🚗 Company driver signup request:', { companyId, email });

    // Validation
    if (!name || !email || !phone || !password || !licenseNumber || 
        !vehicleType || !plateNumber || !licenseExpiry) {
      return res.status(400).json({
        success: false,
        message: "All driver fields are required"
      });
    }

    // Check if company exists and is approved
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found"
      });
    }

    if (company.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Company is not approved yet"
      });
    }

    // Check existing user
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    });
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists"
      });
    }

    // Generate email verification code
    const emailCode = generateVerificationCode();
    const emailExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    console.log('🔐 Generated email code:', emailCode);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create driver user
    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      phone,
      role: "driver",
      companyId,
      emailVerificationToken: emailCode,
      emailVerificationExpires: emailExpiry,
      failedLoginAttempts: 0,
      isActive: true,
      isVerified: false
    });

    console.log('👤 Driver user created:', newUser._id);

    // Create driver profile
    const driverProfile = await Driver.create({
      userId: newUser._id,
      companyId,
      licenseNumber,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      licenseExpiry,
      approvalStatus: "pending"
    });

    console.log('🚗 Driver profile created:', driverProfile._id);

    // Send verification email
    await sendVerificationEmail(email, emailCode, name);

    // Generate tokens
    const accessToken = generateAccessToken({ 
      userId: newUser._id, 
      role: newUser.role,
      isVerified: false
    });
    
    const refreshToken = generateRefreshToken({ 
      userId: newUser._id 
    });

    newUser.refreshToken = refreshToken;
    await newUser.save();

    res.status(201).json({
      success: true,
      message: "Driver account created. Email verification code sent.",
      requiresVerification: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          isVerified: false,
          companyId: newUser.companyId
        },
        driverProfile: {
          _id: driverProfile._id,
          licenseNumber: driverProfile.licenseNumber,
          vehicleType: driverProfile.vehicleType,
          plateNumber: driverProfile.plateNumber,
          approvalStatus: driverProfile.approvalStatus
        }
      },
      // In development, show the code for testing
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          emailCode,
          userId: newUser._id,
          companyId,
          driverProfileId: driverProfile._id
        }
      })
    });

  } catch (error) {
    console.error('❌ Company driver signup error:', error);
    
    res.status(500).json({
      success: false,
      message: "Driver signup failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};