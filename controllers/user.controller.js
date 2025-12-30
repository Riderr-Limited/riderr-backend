import User from "../models/user.models.js";
import Driver from "../models/riders.models.js";
import Company from "../models/company.models.js";
import Delivery from "../models/delivery.models.js";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { validationResult } from "express-validator";

/**
 * -------------------------------
 * USER CONTROLLERS
 * -------------------------------
 */

/**
 * @desc    Get user profile
 * @route   GET /api/users/profile
 * @access  Private
 */
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -refreshToken -emailVerificationToken -resetPasswordToken')
      .populate('companyId', 'name logo status')
      .populate('driverId');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Get additional data based on role
    let additionalData = {};
    
    if (user.role === "customer") {
      // Get customer stats
      const [deliveryStats, recentDeliveries] = await Promise.all([
        Delivery.aggregate([
          {
            $match: { customerId: user._id }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]),
        Delivery.find({ customerId: user._id })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('status pickup.address dropoff.address fare.totalFare createdAt')
          .populate('driverId', 'vehicleType plateNumber')
          .populate({
            path: 'driverId',
            populate: {
              path: 'userId',
              select: 'name avatarUrl'
            }
          })
      ]);

      additionalData = {
        deliveryStats: deliveryStats.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        recentDeliveries,
        totalSpent: await Delivery.aggregate([
          { $match: { customerId: user._id, status: 'delivered' } },
          { $group: { _id: null, total: { $sum: '$fare.totalFare' } } }
        ]).then(result => result[0]?.total || 0)
      };
    } else if (user.role === "driver" && user.driverId) {
      // Get driver stats
      const driver = await Driver.findById(user.driverId)
        .populate('companyId', 'name logo');
      
      if (driver) {
        const driverStats = await Delivery.aggregate([
          {
            $match: { driverId: driver._id, status: 'delivered' }
          },
          {
            $group: {
              _id: null,
              totalEarnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
              totalDeliveries: { $sum: 1 },
              averageRating: { $avg: '$rating' }
            }
          }
        ]);

        additionalData = {
          driverProfile: driver,
          stats: driverStats[0] || {
            totalEarnings: 0,
            totalDeliveries: 0,
            averageRating: 0
          }
        };
      }
    } else if (user.role === "company_admin" && user.companyId) {
      // Get company stats
      const companyStats = await Promise.all([
        Driver.countDocuments({ companyId: user.companyId._id }),
        Delivery.countDocuments({ companyId: user.companyId._id }),
        Delivery.aggregate([
          { $match: { companyId: user.companyId._id, status: 'delivered' } },
          { $group: { _id: null, totalRevenue: { $sum: '$fare.totalFare' } } }
        ])
      ]);

      additionalData = {
        companyStats: {
          totalDrivers: companyStats[0],
          totalDeliveries: companyStats[1],
          totalRevenue: companyStats[2][0]?.totalRevenue || 0
        }
      };
    }

    res.status(200).json({
      success: true,
      data: {
        user,
        ...additionalData
      }
    });

  } catch (error) {
    console.error("Get user profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user profile"
    });
  }
};

/**
 * @desc    Update user profile
 * @route   PUT /api/users/profile
 * @access  Private
 */
export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array()
      });
    }

    const { 
      name, 
      phone, 
      avatarUrl,
      address,
      city,
      state,
      country,
      postalCode,
      dateOfBirth,
      gender
    } = req.body;

    const updates = {};

    // Name validation
    if (name && name.trim().length >= 2) {
      updates.name = name.trim();
    }

    // Phone validation
    if (phone) {
      // Check if phone is already taken
      const existingUser = await User.findOne({
        phone,
        _id: { $ne: userId }
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Phone number already in use"
        });
      }
      updates.phone = phone;
    }

    // Other fields
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (country !== undefined) updates.country = country;
    if (postalCode !== undefined) updates.postalCode = postalCode;
    if (dateOfBirth !== undefined) updates.dateOfBirth = new Date(dateOfBirth);
    if (gender !== undefined) updates.gender = gender;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update"
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password -refreshToken -emailVerificationToken -resetPasswordToken");

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser
    });

  } catch (error) {
    console.error("Update user profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile"
    });
  }
};

/**
 * @desc    Change password
 * @route   PUT /api/users/change-password
 * @access  Private
 */
export const changePassword = async (req, res) => {
  try {
    const userId = req.user._id;
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current and new passwords are required"
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    // Get user with password
    const user = await User.findById(userId).select("+password");

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    // Hash and save new password
    user.password = await bcrypt.hash(newPassword, 10);
    user.refreshToken = null; // Force re-login on all devices
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again."
    });

  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to change password"
    });
  }
};

/**
 * @desc    Deactivate account
 * @route   DELETE /api/users/deactivate
 * @access  Private
 */
export const deactivateAccount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { reason } = req.body;

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if user has active deliveries
    if (user.role === "driver") {
      const driver = await Driver.findOne({ userId }).session(session);
      if (driver && driver.currentDeliveryId) {
        const delivery = await Delivery.findById(driver.currentDeliveryId).session(session);
        if (delivery && !['delivered', 'cancelled', 'failed'].includes(delivery.status)) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: "Cannot deactivate account while on an active delivery"
          });
        }
      }
    }

    // Deactivate user
    user.isActive = false;
    user.deactivatedAt = new Date();
    user.deactivationReason = reason;
    user.refreshToken = null;

    // If user is a driver, deactivate driver profile too
    if (user.role === "driver") {
      const driver = await Driver.findOne({ userId }).session(session);
      if (driver) {
        driver.isActive = false;
        driver.isOnline = false;
        driver.isAvailable = false;
        await driver.save({ session });
      }
    }

    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Account deactivated successfully"
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Deactivate account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate account"
    });
  }
};

/**
 * @desc    Reactivate account
 * @route   POST /api/users/reactivate
 * @access  Public
 */
export const reactivateAccount = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found"
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Check if account is deactivated
    if (user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Account is already active"
      });
    }

    // Reactivate account
    user.isActive = true;
    user.reactivatedAt = new Date();
    await user.save();

    // If user is a driver, reactivate driver profile
    if (user.role === "driver") {
      await Driver.findOneAndUpdate(
        { userId: user._id },
        { isActive: true }
      );
    }

    res.status(200).json({
      success: true,
      message: "Account reactivated successfully"
    });

  } catch (error) {
    console.error("Reactivate account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reactivate account"
    });
  }
};

/**
 * @desc    Get user notifications
 * @route   GET /api/users/notifications
 * @access  Private
 */
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { userId };

    if (unreadOnly === 'true') {
      query.read = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      // Get notifications
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      // Total count
      Notification.countDocuments(query),
      // Unread count
      Notification.countDocuments({ userId, read: false })
    ]);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        },
        unreadCount
      }
    });

  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get notifications"
    });
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/users/notifications/:notificationId/read
 * @access  Private
 */
export const markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { $set: { read: true, readAt: new Date() } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification
    });

  } catch (error) {
    console.error("Mark notification as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read"
    });
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/users/notifications/read-all
 * @access  Private
 */
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`
    });

  } catch (error) {
    console.error("Mark all notifications as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read"
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/users/notifications/:notificationId
 * @access  Private
 */
export const deleteNotification = async (req, res) => {
  try {
    const userId = req.user._id;
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully"
    });

  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification"
    });
  }
};

/**
 * @desc    Get user preferences
 * @route   GET /api/users/preferences
 * @access  Private
 */
export const getUserPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('preferences notifications settings');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      data: {
        preferences: user.preferences || {},
        notifications: user.notifications || {},
        settings: user.settings || {}
      }
    });

  } catch (error) {
    console.error("Get user preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get preferences"
    });
  }
};

/**
 * @desc    Update user preferences
 * @route   PUT /api/users/preferences
 * @access  Private
 */
export const updateUserPreferences = async (req, res) => {
  try {
    const userId = req.user._id;
    const { preferences, notifications, settings } = req.body;

    const updates = {};
    
    if (preferences !== undefined) updates.preferences = preferences;
    if (notifications !== undefined) updates.notifications = notifications;
    if (settings !== undefined) updates.settings = settings;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No preferences to update"
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true }
    ).select('preferences notifications settings');

    res.status(200).json({
      success: true,
      message: "Preferences updated successfully",
      data: {
        preferences: updatedUser.preferences,
        notifications: updatedUser.notifications,
        settings: updatedUser.settings
      }
    });

  } catch (error) {
    console.error("Update user preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update preferences"
    });
  }
};

/**
 * @desc    Get user activity log
 * @route   GET /api/users/activity
 * @access  Private
 */
export const getUserActivity = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, type } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { userId };

    if (type) {
      query.type = type;
    }

    const [activities, total] = await Promise.all([
      ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ActivityLog.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        activities,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error("Get user activity error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get activity log"
    });
  }
};

/**
 * @desc    Company admin: Get company drivers
 * @route   GET /api/users/companies/:companyId/drivers
 * @access  Private (Company Admin)
 */
export const getCompanyDrivers = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;

    // Permission check
    if (admin.role !== "company_admin" && admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    if (admin.role === "company_admin" && admin.companyId?.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot access another company's drivers"
      });
    }

    // Query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const status = req.query.status;
    const approvalStatus = req.query.approvalStatus;
    const search = req.query.search;
    const isOnline = req.query.isOnline;

    // Build query
    const query = { companyId };

    if (status) {
      if (status === 'active') {
        query.isActive = true;
      } else if (status === 'inactive') {
        query.isActive = false;
      }
    }

    if (approvalStatus) query.approvalStatus = approvalStatus;
    if (isOnline !== undefined) query.isOnline = isOnline === 'true';

    // Get total count
    const total = await Driver.countDocuments(query);

    // Get paginated drivers with user data
    let drivers = await Driver.find(query)
      .populate({
        path: 'userId',
        select: 'name email phone avatarUrl isActive lastLoginAt',
        match: search ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } }
          ]
        } : {}
      })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Filter out drivers whose user didn't match search
    if (search) {
      drivers = drivers.filter(driver => driver.userId !== null);
    }

    // Get driver stats
    const driversWithStats = await Promise.all(
      drivers.map(async (driver) => {
        const stats = await Delivery.aggregate([
          {
            $match: { 
              driverId: driver._id,
              status: 'delivered',
              deliveredAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
            }
          },
          {
            $group: {
              _id: null,
              totalEarnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
              totalDeliveries: { $sum: 1 },
              averageRating: { $avg: '$rating' }
            }
          }
        ]);

        const driverObj = driver.toObject();
        driverObj.stats = stats[0] || {
          totalEarnings: 0,
          totalDeliveries: 0,
          averageRating: 0
        };

        return driverObj;
      })
    );

    res.status(200).json({
      success: true,
      message: "Drivers fetched successfully",
      data: driversWithStats,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error("Get company drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company drivers"
    });
  }
};

/**
 * @desc    Company admin: Create driver
 * @route   POST /api/users/companies/:companyId/drivers
 * @access  Private (Company Admin)
 */
export const createCompanyDriver = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const admin = req.user;
    const { companyId } = req.params;

    // Validate admin permissions
    if (admin.role !== "company_admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only company admins can create drivers"
      });
    }

    if (!admin.companyId || admin.companyId.toString() !== companyId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Cannot create drivers for another company"
      });
    }

    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array()
      });
    }

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
      plateNumber
    } = req.body;

    // Validate required fields
    if (!name || !phone || !password || !licenseNumber || !vehicleType || !plateNumber || !licenseExpiry) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Check for existing user
    const existingUser = await User.findOne({
      $or: [{ email: email?.toLowerCase().trim() }, { phone }]
    }).session(session);

    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "User with this email or phone already exists"
      });
    }

    // Check for existing driver with same license or plate
    const existingDriver = await Driver.findOne({
      $or: [
        { licenseNumber: licenseNumber.toUpperCase() },
        { plateNumber: plateNumber.toUpperCase() }
      ]
    }).session(session);

    if (existingDriver) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "Driver with this license or plate number already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create driver user
    const driverUser = await User.create([{
      name: name.trim(),
      phone,
      email: email?.toLowerCase().trim() || `driver${Date.now()}@company.com`,
      password: hashedPassword,
      role: "driver",
      companyId,
      isVerified: false,
      isActive: true
    }], { session });

    // Create driver profile
    const driver = await Driver.create([{
      userId: driverUser[0]._id,
      companyId,
      licenseNumber: licenseNumber.toUpperCase(),
      licenseExpiry: new Date(licenseExpiry),
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber: plateNumber.toUpperCase(),
      approvalStatus: "pending",
      isOnline: false,
      isAvailable: false,
      canAcceptDeliveries: true
    }], { session });

    // Link driver profile to user
    driverUser[0].driverId = driver[0]._id;
    await driverUser[0].save({ session });

    await session.commitTransaction();
    session.endSession();

    // Remove sensitive data
    const userData = driverUser[0].toObject();
    delete userData.password;
    delete userData.refreshToken;

    res.status(201).json({
      success: true,
      message: "Driver created successfully",
      data: {
        user: userData,
        driver: driver[0]
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Create company driver error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create driver"
    });
  }
};

/**
 * @desc    Company admin: Update driver status
 * @route   PUT /api/users/companies/:companyId/drivers/:driverId/status
 * @access  Private (Company Admin)
 */
export const updateDriverStatus = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId, driverId } = req.params;
    const { approvalStatus, isActive, notes } = req.body;

    // Permission check
    if (admin.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company admins can update driver status"
      });
    }

    if (admin.companyId?.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot update drivers from another company"
      });
    }

    // Find driver
    const driver = await Driver.findOne({
      _id: driverId,
      companyId
    }).populate('userId');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found"
      });
    }

    const updates = {};
    
    if (approvalStatus !== undefined) {
      if (!['pending', 'approved', 'rejected', 'suspended'].includes(approvalStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid approval status"
        });
      }
      updates.approvalStatus = approvalStatus;
      
      // If approved, mark as verified
      if (approvalStatus === 'approved') {
        updates.isVerified = true;
        driver.userId.isVerified = true;
        await driver.userId.save();
        
        // Notify driver
        await sendNotification({
          userId: driver.userId._id,
          title: "Profile Approved",
          message: "Your driver profile has been approved by the company",
          data: {
            type: "driver_approved",
            driverId: driver._id
          }
        });
      }
    }

    if (isActive !== undefined) {
      updates.isActive = isActive;
      
      // Update user status as well
      if (driver.userId) {
        driver.userId.isActive = isActive;
        await driver.userId.save();
      }

      // If deactivating, take driver offline
      if (!isActive) {
        updates.isOnline = false;
        updates.isAvailable = false;
      }
    }

    if (notes !== undefined) {
      updates.adminNotes = notes;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No status fields to update"
      });
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('userId', 'name email phone');

    res.status(200).json({
      success: true,
      message: "Driver status updated successfully",
      data: updatedDriver
    });

  } catch (error) {
    console.error("Update driver status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update driver status"
    });
  }
};

/**
 * @desc    Company admin: Get driver details
 * @route   GET /api/users/companies/:companyId/drivers/:driverId
 * @access  Private (Company Admin)
 */
export const getDriverDetails = async (req, res) => {
  try {
    const admin = req.user;
    const { companyId, driverId } = req.params;

    // Permission check
    if (admin.role !== "company_admin" && admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    if (admin.role === "company_admin" && admin.companyId?.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: "Cannot access driver from another company"
      });
    }

    const driver = await Driver.findOne({
      _id: driverId,
      companyId
    })
    .populate('userId', 'name email phone avatarUrl rating createdAt lastLoginAt')
    .populate('companyId', 'name logo');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found"
      });
    }

    // Get driver statistics
    const [stats, recentDeliveries, documents] = await Promise.all([
      // Delivery stats
      Delivery.aggregate([
        {
          $match: { 
            driverId: driver._id,
            status: 'delivered'
          }
        },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: { $add: ['$fare.actualTotal', '$tip.amount'] } },
            totalDeliveries: { $sum: 1 },
            totalDistance: { $sum: '$estimatedDistanceKm' },
            averageRating: { $avg: '$rating' }
          }
        }
      ]),
      // Recent deliveries
      Delivery.find({ driverId: driver._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('status pickup.address dropoff.address fare.totalFare createdAt deliveredAt rating')
        .populate('customerId', 'name phone'),
      // Document status
      (() => {
        const docs = {};
        const requiredDocs = ['licensePhoto', 'vehiclePhoto', 'insurancePhoto', 'idCardPhoto', 'vehicleRegistrationPhoto'];
        requiredDocs.forEach(doc => {
          docs[doc] = !!driver[doc];
        });
        return docs;
      })()
    ]);

    const driverStats = stats[0] || {
      totalEarnings: 0,
      totalDeliveries: 0,
      totalDistance: 0,
      averageRating: 0
    };

    res.status(200).json({
      success: true,
      data: {
        driver,
        stats: driverStats,
        recentDeliveries,
        documents,
        performance: {
          acceptanceRate: driver.totalRequests 
            ? Math.round((driver.acceptedRequests / driver.totalRequests) * 100)
            : 0,
          onlineHours: driver.totalOnlineHours || 0,
          cancellationRate: driver.totalDeliveries 
            ? Math.round(((driver.cancelledDeliveries || 0) / driver.totalDeliveries) * 100)
            : 0
        }
      }
    });

  } catch (error) {
    console.error("Get driver details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver details"
    });
  }
};

/**
 * @desc    Admin: Get all users
 * @route   GET /api/users
 * @access  Private (Admin)
 */
export const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required"
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
    const query = {};

    if (role) query.role = role;
    if (companyId) query.companyId = companyId;
    if (isVerified !== undefined) query.isVerified = isVerified === "true";
    if (isActive !== undefined) query.isActive = isActive === "true";

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } }
      ];
    }

    // Get total count
    const total = await User.countDocuments(query);

    // Get paginated users
    const users = await User.find(query)
      .select("-password -refreshToken -emailVerificationToken -resetPasswordToken")
      .populate("companyId", "name city status")
      .populate("driverId")
      .skip(skip)
      .limit(limit)
      .sort({ [sortBy]: sortOrder });

    // Get additional stats for each user
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const userObj = user.toObject();
        
        if (user.role === "customer") {
          const stats = await Delivery.aggregate([
            { $match: { customerId: user._id } },
            { $group: { 
              _id: null, 
              totalDeliveries: { $sum: 1 },
              totalSpent: { $sum: "$fare.totalFare" }
            }}
          ]);
          userObj.stats = stats[0] || { totalDeliveries: 0, totalSpent: 0 };
        } else if (user.role === "driver" && user.driverId) {
          const stats = await Delivery.aggregate([
            { $match: { driverId: user.driverId._id, status: "delivered" } },
            { $group: { 
              _id: null, 
              totalDeliveries: { $sum: 1 },
              totalEarnings: { $sum: { $add: ["$fare.actualTotal", "$tip.amount"] } }
            }}
          ]);
          userObj.stats = stats[0] || { totalDeliveries: 0, totalEarnings: 0 };
        }

        return userObj;
      })
    );

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: usersWithStats,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get users"
    });
  }
};

/**
 * @desc    Admin: Update user
 * @route   PUT /api/users/:userId
 * @access  Private (Admin)
 */
export const updateUser = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required"
      });
    }

    const { userId } = req.params;
    const { isActive, isVerified, role, companyId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user._id.toString() && isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate your own account"
      });
    }

    const updates = {};
    
    if (isActive !== undefined) updates.isActive = isActive;
    if (isVerified !== undefined) {
      updates.isVerified = isVerified;
      if (isVerified) {
        updates.emailVerifiedAt = new Date();
        updates.phoneVerifiedAt = new Date();
      }
    }
    if (role !== undefined) updates.role = role;
    if (companyId !== undefined) updates.companyId = companyId;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update"
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
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser
    });

  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user"
    });
  }
};

/**
 * @desc    Admin: Delete user
 * @route   DELETE /api/users/:userId
 * @access  Private (Admin)
 */
export const deleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.user.role !== "admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Admin access required"
      });
    }

    const { userId } = req.params;

    // Prevent admin from deleting themselves
    if (userId === req.user._id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account"
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Soft delete: mark as deleted
    user.isActive = false;
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user._id;

    // If user is a driver, deactivate driver profile
    if (user.role === "driver") {
      const driver = await Driver.findOne({ userId }).session(session);
      if (driver) {
        driver.isActive = false;
        driver.isOnline = false;
        driver.isAvailable = false;
        await driver.save({ session });
      }
    }

    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user"
    });
  }
};

// Helper function to send notifications
const sendNotification = async ({ userId, title, message, data }) => {
  try {
    // This would integrate with your notification service
    // For now, we'll just log it
    console.log(`Notification to ${userId}: ${title} - ${message}`);
    
    // In a real implementation, you would:
    // 1. Save to database
    // 2. Send push notification via Firebase/APNS
    // 3. Send email/SMS if configured
    
    return true;
  } catch (error) {
    console.error("Send notification error:", error);
    return false;
  }
};