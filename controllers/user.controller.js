import User from "../models/user.models.js";
import Driver from "../models/riders.models.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";

/**
 * @desc    Get my profile
 * @route   GET /api/users/me
 * @access  Private
 */
 /**
 * @desc    Get current user with complete data
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMyProfile = async (req, res) => {
  try {
    // Get fresh user data from database
    const user = await User.findById(req.user._id)
      .populate('companyId')
      .select('-password -refreshToken -emailVerificationToken -resetPasswordToken');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    console.log('👤 Get current user:', user.email);

    // Convert to object
    const userObject = user.toObject();

    // For drivers, fetch driver profile
    let driverProfile = null;
    if (user.role === "driver") {
      driverProfile = await Driver.findOne({ 
        userId: user._id,
        companyId: user.companyId 
      });
    }

    res.status(200).json({
      success: true,
      data: {
        // Complete user data
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
          status: userObject.companyId.status
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
        
        // Additional User Fields
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
        
        // Preferences
        preferences: userObject.preferences || {},
        notifications: userObject.notifications || {},
        settings: userObject.settings || {}
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
 * @desc    Update my profile
 * @route   PUT /api/users/me
 * @access  Private
 */
export const updateMyProfile = async (req, res) => {
  try {
    const { name, phone, avatarUrl } = req.body;
    const userId = req.user._id;

    const updates = {};

    if (name) {
      if (name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Name must be at least 2 characters",
        });
      }
      updates.name = name.trim();
    }

    if (phone) {
      // Check if phone is already taken
      const existingPhone = await User.findOne({
        phone,
        _id: { $ne: userId },
      });

      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: "Phone number already in use",
        });
      }

      updates.phone = phone;
    }

    if (avatarUrl !== undefined) {
      updates.avatarUrl = avatarUrl || null;
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
      { new: true, runValidators: true }
    ).select("-password -refreshToken");

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * @desc    Change password
 * @route   PUT /api/users/me/password
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

    // Get user with password
    const user = await User.findById(userId).select("+password");

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash and save new password
    user.password = newPassword; // Will be hashed by pre-save hook
    user.refreshToken = null; // Force re-login
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * @desc    Company admin creates rider/driver
 * @route   POST /api/users/companies/:companyId/riders
 * @access  Private (Company Admin)
 */
export const createRider = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const admin = req.user;
    const { companyId } = req.params;
    const {
      name,
      phone,
      email,
      password,
      licenseNumber,
      licenseExpiry,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
    } = req.body;

    // Validate admin permissions
    if (admin.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company admins can create riders",
      });
    }

    if (!admin.companyId || admin.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot create riders for another company",
      });
    }

    // Validate required fields
    if (
      !name ||
      !phone ||
      !password ||
      !licenseNumber ||
      !vehicleType ||
      !plateNumber ||
      !licenseExpiry
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Check for existing user
    const existingUser = await User.findOne({
      $or: [{ email: email?.toLowerCase().trim() }, { phone }],
    }).session(session);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists",
      });
    }

    // Check for existing driver with same license or plate
    const existingDriver = await Driver.findOne({
      $or: [
        { licenseNumber: licenseNumber.toUpperCase() },
        { plateNumber: plateNumber.toUpperCase() },
      ],
    }).session(session);

    if (existingDriver) {
      return res.status(409).json({
        success: false,
        message: "Driver with this license or plate number already exists",
      });
    }

    // Create driver user
    const driverUser = await User.create(
      [
        {
          name: name.trim(),
          phone,
          email:
            email?.toLowerCase().trim() ||
            `driver${Date.now()}@temp.riderr.com`,
          password, // Will be hashed by pre-save hook
          role: "driver",
          companyId,
          isVerified: false,
          isActive: true,
        },
      ],
      { session }
    );

    // Create driver profile
    const driver = await Driver.create(
      [
        {
          userId: driverUser[0]._id,
          companyId,
          licenseNumber,
          licenseExpiry,
          vehicleType,
          vehicleMake,
          vehicleModel,
          vehicleYear,
          vehicleColor,
          plateNumber,
          approvalStatus: "pending",
        },
      ],
      { session }
    );

    // Link driver profile to user
    driverUser[0].driverId = driver[0]._id;
    await driverUser[0].save({ session });

    await session.commitTransaction();

    const result = driverUser[0].toObject();
    delete result.password;
    delete result.refreshToken;

    res.status(201).json({
      success: true,
      message: "Rider created successfully",
      data: {
        user: result,
        driver: driver[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Create rider error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get company riders
 * @route   GET /api/users/companies/:companyId/riders
 * @access  Private (Company Admin)
 */
export const getCompanyRiders = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;

    // Query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;
    const approvalStatus = req.query.approvalStatus;

    // Permission check
    if (admin.role !== "company_admin" && admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (
      admin.role === "company_admin" &&
      admin.companyId.toString() !== companyId
    ) {
      return res.status(403).json({
        success: false,
        message: "Cannot access another company's riders",
      });
    }

    // Build query
    const query = { companyId };

    // Search by approval status
    if (approvalStatus) {
      query.approvalStatus = approvalStatus;
    }

    // Get total count
    const total = await Driver.countDocuments(query);

    // Get paginated drivers with populated user data
    const drivers = await Driver.find(query)
      .populate({
        path: "userId",
        select: "name email phone isActive isVerified avatarUrl",
      })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Apply additional filters on populated data
    let filteredDrivers = drivers;

    if (status === "active") {
      filteredDrivers = drivers.filter((d) => d.userId?.isActive === true);
    } else if (status === "inactive") {
      filteredDrivers = drivers.filter((d) => d.userId?.isActive === false);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filteredDrivers = filteredDrivers.filter(
        (d) =>
          d.userId?.name.toLowerCase().includes(searchLower) ||
          d.userId?.phone.includes(search) ||
          d.userId?.email.toLowerCase().includes(searchLower) ||
          d.plateNumber.toLowerCase().includes(searchLower)
      );
    }

    res.status(200).json({
      success: true,
      message: "Riders fetched successfully",
      data: filteredDrivers,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get company riders error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * @desc    Get single user by ID
 * @route   GET /api/users/:id
 * @access  Private
 */
export const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const requestingUser = req.user;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Check permissions
    if (requestingUser.role === "admin") {
      // Admin can view anyone
    } else if (requestingUser.role === "company_admin") {
      // Company admin can only view users in their company
      const userToView = await User.findById(userId);
      if (
        !userToView ||
        userToView.companyId?.toString() !==
          requestingUser.companyId?.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    } else {
      // Can only view own profile
      if (requestingUser._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own profile",
        });
      }
    }

    const user = await User.findById(userId)
      .select("-password -refreshToken")
      .populate("companyId", "name city status")
      .populate("driverId");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * @desc    Delete/deactivate rider
 * @route   DELETE /api/users/companies/:companyId/riders/:riderId
 * @access  Private (Company Admin)
 */
export const deleteRider = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const admin = req.user;
    const { companyId, riderId } = req.params;

    if (admin.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company admins can delete riders",
      });
    }

    if (admin.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot delete riders from another company",
      });
    }

    // Find driver profile
    const driver = await Driver.findById(riderId)
      .populate("userId")
      .session(session);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Rider not found",
      });
    }

    if (driver.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Rider does not belong to your company",
      });
    }

    // Soft delete: deactivate user and driver
    await User.findByIdAndUpdate(
      driver.userId._id,
      { isActive: false },
      { session }
    );

    driver.isActive = false;
    driver.isOnline = false;
    driver.isAvailable = false;
    await driver.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Rider deactivated successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Delete rider error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get all users (Admin only)
 * @route   GET /api/users
 * @access  Private (Admin)
 */
export const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    // Query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const role = req.query.role;
    const companyId = req.query.companyId;
    const isVerified = req.query.isVerified;
    const isActive = req.query.isActive;
    const search = req.query.search;
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;

    // Build query
    const query = { isDeleted: { $ne: true } };

    if (role) query.role = role;
    if (companyId) query.companyId = companyId;
    if (isVerified !== undefined) query.isVerified = isVerified === "true";
    if (isActive !== undefined) query.isActive = isActive === "true";

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    // Get total count
    const total = await User.countDocuments(query);

    // Get paginated users
    const users = await User.find(query)
      .select("-password -refreshToken")
      .populate("companyId", "name city status")
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder });

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};

/**
 * @desc    Update user status (Admin only)
 * @route   PUT /api/users/:userId/status
 * @access  Private (Admin)
 */
export const updateUserStatus = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const { userId } = req.params;
    const { isActive, isVerified } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user._id.toString() && isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate your own account",
      });
    }

    const updates = {};
    if (isActive !== undefined) updates.isActive = isActive;
    if (isVerified !== undefined) {
      updates.isVerified = isVerified;
      if (isVerified) {
        updates.phoneVerifiedAt = new Date();
        updates.emailVerifiedAt = new Date();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No status fields to update",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password -refreshToken");

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User status updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error",
    });
  }
};
