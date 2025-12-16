import User from '../models/user.models.js';
import VerificationService from '../services/verification.service.js';

/**
 * Send phone verification code
 */
export const sendPhoneVerification = async (req, res, next) => {
  try {
    const { userId, phone } = req.body;

    if (!phone) {
      const error = new Error("Phone number is required");
      error.statusCode = 400;
      throw error;
    }

    let user;
    if (userId) {
      // For existing users (after signup)
      user = await User.findById(userId);
      if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }
    } else {
      // For new users (check if phone exists)
      user = await User.findOne({ phone });
      if (user && user.isVerified) {
        const error = new Error("Phone number already verified");
        error.statusCode = 400;
        throw error;
      }
    }

    // Send verification via Twilio
    const result = await VerificationService.sendPhoneVerification(phone);
    
    // Generate and save local verification code
    if (user) {
      const code = VerificationService.generateVerificationCode();
      user.phoneVerificationCode = code;
      user.phoneVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
      user.verificationAttempts = 0;
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: 'Verification code sent successfully',
      data: {
        method: 'sms',
        expiresIn: '10 minutes'
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Verify phone code
 */
export const verifyPhone = async (req, res, next) => {
  try {
    const { phone, code, userId } = req.body;

    if (!phone || !code) {
      const error = new Error("Phone and code are required");
      error.statusCode = 400;
      throw error;
    }

    let user;
    if (userId) {
      user = await User.findById(userId);
    } else {
      user = await User.findOne({ phone });
    }

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    // Option 1: Use Twilio verification
    const twilioResult = await VerificationService.verifyPhoneCode(phone, code);
    
    if (twilioResult.success) {
      // Update user verification status
      user.isVerified = true;
      user.phoneVerifiedAt = new Date();
      user.phoneVerificationCode = null;
      user.phoneVerificationExpires = null;
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Phone number verified successfully',
        data: {
          user: {
            id: user._id,
            phone: user.phone,
            isVerified: user.isVerified,
            phoneVerifiedAt: user.phoneVerifiedAt
          }
        }
      });
    }

    // Option 2: Use local verification code
    if (user.phoneVerificationCode && user.phoneVerificationExpires) {
      if (Date.now() > user.phoneVerificationExpires) {
        const error = new Error("Verification code expired");
        error.statusCode = 400;
        throw error;
      }

      if (user.verificationAttempts >= 5) {
        const error = new Error("Too many attempts. Please request a new code");
        error.statusCode = 429;
        throw error;
      }

      user.verificationAttempts += 1;

      if (user.phoneVerificationCode === code) {
        user.isVerified = true;
        user.phoneVerifiedAt = new Date();
        user.phoneVerificationCode = null;
        user.phoneVerificationExpires = null;
        user.verificationAttempts = 0;
        await user.save();

        return res.status(200).json({
          success: true,
          message: 'Phone number verified successfully',
          data: {
            user: {
              id: user._id,
              phone: user.phone,
              isVerified: user.isVerified,
              phoneVerifiedAt: user.phoneVerifiedAt
            }
          }
        });
      } else {
        await user.save();
        const error = new Error("Invalid verification code");
        error.statusCode = 400;
        throw error;
      }
    }

    const error = new Error("No verification found for this phone");
    error.statusCode = 404;
    throw error;

  } catch (error) {
    next(error);
  }
};

/**
 * Send email verification
 */
export const sendEmailVerification = async (req, res, next) => {
  try {
    const { email, userId } = req.body;

    if (!email) {
      const error = new Error("Email is required");
      error.statusCode = 400;
      throw error;
    }

    let user;
    if (userId) {
      user = await User.findById(userId);
      if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }
    } else {
      user = await User.findOne({ email });
      if (user && user.isVerified) {
        const error = new Error("Email already verified");
        error.statusCode = 400;
        throw error;
      }
    }

    // Generate verification code
    const code = VerificationService.generateVerificationCode();
    
    // Save verification code to user
    if (user) {
      user.emailVerificationToken = code;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      await user.save();
    }

    // Send verification email
    await VerificationService.sendEmailVerification(email, code);

    res.status(200).json({
      success: true,
      message: 'Verification email sent successfully',
      data: {
        method: 'email',
        expiresIn: '24 hours'
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Verify email
 */
export const verifyEmail = async (req, res, next) => {
  try {
    const { email, code, userId } = req.body;

    if (!email || !code) {
      const error = new Error("Email and code are required");
      error.statusCode = 400;
      throw error;
    }

    let user;
    if (userId) {
      user = await User.findById(userId);
    } else {
      user = await User.findOne({ email });
    }

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    if (!user.emailVerificationToken || !user.emailVerificationExpires) {
      const error = new Error("No verification found for this email");
      error.statusCode = 404;
      throw error;
    }

    if (Date.now() > user.emailVerificationExpires) {
      const error = new Error("Verification code expired");
      error.statusCode = 400;
      throw error;
    }

    if (user.emailVerificationToken === code) {
      user.isVerified = true;
      user.emailVerifiedAt = new Date();
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Email verified successfully',
        data: {
          user: {
            id: user._id,
            email: user.email,
            isVerified: user.isVerified,
            emailVerifiedAt: user.emailVerifiedAt
          }
        }
      });
    } else {
      const error = new Error("Invalid verification code");
      error.statusCode = 400;
      throw error;
    }

  } catch (error) {
    next(error);
  }
};

/**
 * Resend verification code
 */
export const resendVerification = async (req, res, next) => {
  try {
    const { type, identifier, userId } = req.body;

    if (!type || !identifier) {
      const error = new Error("Type and identifier are required");
      error.statusCode = 400;
      throw error;
    }

    let user;
    if (userId) {
      user = await User.findById(userId);
    } else {
      user = await User.findOne({
        $or: [{ email: identifier }, { phone: identifier }]
      });
    }

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    if (user.isVerified) {
      const error = new Error("User is already verified");
      error.statusCode = 400;
      throw error;
    }

    if (type === 'phone') {
      const result = await VerificationService.sendPhoneVerification(user.phone);
      
      // Generate new local code
      const code = VerificationService.generateVerificationCode();
      user.phoneVerificationCode = code;
      user.phoneVerificationExpires = Date.now() + 10 * 60 * 1000;
      user.verificationAttempts = 0;
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Verification code resent successfully',
        data: {
          method: 'sms',
          expiresIn: '10 minutes'
        }
      });
    } else if (type === 'email') {
      const code = VerificationService.generateVerificationCode();
      user.emailVerificationToken = code;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save();

      await VerificationService.sendEmailVerification(user.email, code);

      res.status(200).json({
        success: true,
        message: 'Verification email resent successfully',
        data: {
          method: 'email',
          expiresIn: '24 hours'
        }
      });
    } else {
      const error = new Error("Invalid verification type");
      error.statusCode = 400;
      throw error;
    }

  } catch (error) {
    next(error);
  }
};

/**
 * Check verification status
 */
export const checkVerificationStatus = async (req, res, next) => {
  try {
    const { userId } = req.body;
    const user = req.user || await User.findById(userId);

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    res.status(200).json({
      success: true,
      data: {
        isVerified: user.isVerified,
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        requiresVerification: !user.isVerified && user.role === 'rider',
        email: user.email,
        phone: user.phone
      }
    });

  } catch (error) {
    next(error);
  }
};