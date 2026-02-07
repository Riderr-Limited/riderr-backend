import User from "../models/user.models.js";
import Driver from "../models/riders.models.js";
import Company from "../models/company.models.js";
import Delivery from "../models/delivery.models.js";
import Payment from "../models/payments.models.js";
import SupportTicket from "../models/supportTicket.model.js";
import Notification from "../models/notificaton.models.js";
import ChatMessage from "../models/chat.model.js";
import VoiceCall from "../models/voiceCall.model.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import { sendNotification } from "../utils/notification.js";

/**
 * ========================================
 * ADMIN DASHBOARD & ANALYTICS
 * ========================================
 */

/**
 * @desc    Get admin dashboard overview
 * @route   GET /api/admin/dashboard
 * @access  Private (Admin)
 */
export const getDashboardOverview = async (req, res) => {
  try {
    const { startDate, endDate, period = "30days" } = req.query;

    // Calculate date range
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    } else {
      const periodDays = period === "7days" ? 7 : period === "90days" ? 90 : 30;
      dateFilter = {
        createdAt: {
          $gte: new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000),
        },
      };
    }

    // Get comprehensive statistics
    const [
      userStats,
      driverStats,
      companyStats,
      deliveryStats,
      revenueStats,
      recentActivities,
    ] = await Promise.all([
      // User statistics
      User.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            byRole: [
              { $group: { _id: "$role", count: { $sum: 1 } } },
            ],
            verified: [
              { $match: { isVerified: true } },
              { $count: "count" },
            ],
            active: [
              { $match: { isActive: true } },
              { $count: "count" },
            ],
            newThisPeriod: [
              { $match: dateFilter },
              { $count: "count" },
            ],
          },
        },
      ]),

      // Driver statistics
      Driver.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            online: [
              { $match: { isOnline: true } },
              { $count: "count" },
            ],
            available: [
              { $match: { isAvailable: true, isOnline: true } },
              { $count: "count" },
            ],
            byVehicleType: [
              { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
            ],
            topRated: [
              { $sort: { rating: -1 } },
              { $limit: 10 },
              {
                $lookup: {
                  from: "users",
                  localField: "userId",
                  foreignField: "_id",
                  as: "userInfo",
                },
              },
              {
                $project: {
                  name: { $arrayElemAt: ["$userInfo.name", 0] },
                  rating: 1,
                  totalDeliveries: 1,
                  vehicleType: 1,
                },
              },
            ],
          },
        },
      ]),

      // Company statistics
      Company.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            active: [
              { $match: { status: "active" } },
              { $count: "count" },
            ],
            pending: [
              { $match: { status: "pending" } },
              { $count: "count" },
            ],
          },
        },
      ]),

      // Delivery statistics
      Delivery.aggregate([
        {
          $facet: {
            total: [{ $count: "count" }],
            byStatus: [
              { $group: { _id: "$status", count: { $sum: 1 } } },
            ],
            thisPeriod: [
              { $match: dateFilter },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  totalRevenue: { $sum: "$fare.totalFare" },
                  avgFare: { $avg: "$fare.totalFare" },
                },
              },
            ],
            byVehicleType: [
              { $group: { _id: "$vehicleType", count: { $sum: 1 } } },
            ],
            dailyStats: [
              { $match: dateFilter },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$createdAt",
                    },
                  },
                  count: { $sum: 1 },
                  revenue: { $sum: "$fare.totalFare" },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]),

      // Revenue statistics
      Payment.aggregate([
        {
          $match: {
            status: "successful",
            ...dateFilter,
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$amount" },
            platformFees: { $sum: "$platformFee" },
            companyRevenue: {
              $sum: { $subtract: ["$amount", "$platformFee"] },
            },
            totalTransactions: { $sum: 1 },
            avgTransactionValue: { $avg: "$amount" },
          },
        },
      ]),

      // Recent activities
      Delivery.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("customerId", "name email")
        .populate({
          path: "driverId",
          populate: {
            path: "userId",
            select: "name",
          },
        })
        .select("status pickup dropoff fare createdAt"),
    ]);

    // Format response
    const dashboard = {
      users: {
        total: userStats[0].total[0]?.count || 0,
        byRole: userStats[0].byRole,
        verified: userStats[0].verified[0]?.count || 0,
        active: userStats[0].active[0]?.count || 0,
        newThisPeriod: userStats[0].newThisPeriod[0]?.count || 0,
      },
      drivers: {
        total: driverStats[0].total[0]?.count || 0,
        online: driverStats[0].online[0]?.count || 0,
        available: driverStats[0].available[0]?.count || 0,
        byVehicleType: driverStats[0].byVehicleType,
        topRated: driverStats[0].topRated,
      },
      companies: {
        total: companyStats[0].total[0]?.count || 0,
        active: companyStats[0].active[0]?.count || 0,
        pending: companyStats[0].pending[0]?.count || 0,
      },
      deliveries: {
        total: deliveryStats[0].total[0]?.count || 0,
        byStatus: deliveryStats[0].byStatus,
        thisPeriod: deliveryStats[0].thisPeriod[0] || {
          count: 0,
          totalRevenue: 0,
          avgFare: 0,
        },
        byVehicleType: deliveryStats[0].byVehicleType,
        dailyStats: deliveryStats[0].dailyStats,
      },
      revenue: revenueStats[0] || {
        totalRevenue: 0,
        platformFees: 0,
        companyRevenue: 0,
        totalTransactions: 0,
        avgTransactionValue: 0,
      },
      recentActivities,
    };

    res.status(200).json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    console.error("Get dashboard overview error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get dashboard overview",
    });
  }
};

/**
 * @desc    Get platform analytics
 * @route   GET /api/admin/analytics
 * @access  Private (Admin)
 */
export const getPlatformAnalytics = async (req, res) => {
  try {
    const { period = "30days", metric = "all" } = req.query;

    const periodDays = period === "7days" ? 7 : period === "90days" ? 90 : 30;
    const dateFilter = {
      createdAt: {
        $gte: new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000),
      },
    };

    const analytics = {};

    // User growth analytics
    if (metric === "all" || metric === "users") {
      const userGrowth = await User.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              role: "$role",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]);
      analytics.userGrowth = userGrowth;
    }

    // Delivery performance analytics
    if (metric === "all" || metric === "deliveries") {
      const deliveryPerformance = await Delivery.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              status: "$status",
            },
            count: { $sum: 1 },
            avgFare: { $avg: "$fare.totalFare" },
            totalRevenue: { $sum: "$fare.totalFare" },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]);

      // Delivery completion rate
      const completionStats = await Delivery.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
      ]);

      analytics.deliveryPerformance = deliveryPerformance;
      analytics.completionRate = completionStats[0]
        ? (completionStats[0].completed / completionStats[0].total) * 100
        : 0;
    }

    // Revenue analytics
    if (metric === "all" || metric === "revenue") {
      const revenueAnalytics = await Payment.aggregate([
        { $match: { status: "successful", ...dateFilter } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            },
            revenue: { $sum: "$amount" },
            platformFees: { $sum: "$platformFee" },
            transactions: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]);
      analytics.revenueAnalytics = revenueAnalytics;
    }

    // Driver analytics
    if (metric === "all" || metric === "drivers") {
      const driverAnalytics = await Delivery.aggregate([
        { $match: { ...dateFilter, driverId: { $exists: true } } },
        {
          $group: {
            _id: "$driverId",
            totalDeliveries: { $sum: 1 },
            totalEarnings: { $sum: { $add: ["$fare.actualTotal", "$tip.amount"] } },
            avgRating: { $avg: "$rating" },
          },
        },
        { $sort: { totalDeliveries: -1 } },
        { $limit: 20 },
        {
          $lookup: {
            from: "drivers",
            localField: "_id",
            foreignField: "_id",
            as: "driverInfo",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "driverInfo.userId",
            foreignField: "_id",
            as: "userInfo",
          },
        },
      ]);
      analytics.topDrivers = driverAnalytics;
    }

    res.status(200).json({
      success: true,
      period,
      data: analytics,
    });
  } catch (error) {
    console.error("Get platform analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get analytics",
    });
  }
};

/**
 * ========================================
 * USER MANAGEMENT
 * ========================================
 */

/**
 * @desc    Get all users with advanced filtering
 * @route   GET /api/admin/users
 * @access  Private (Admin)
 */
export const getAllUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      isVerified,
      isActive,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      companyId,
      startDate,
      endDate,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // Build query filters
    if (role) query.role = role;
    if (companyId) query.companyId = companyId;
    if (isVerified !== undefined) query.isVerified = isVerified === "true";
    if (isActive !== undefined) query.isActive = isActive === "true";

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

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
      .select("-password -refreshToken -emailVerificationToken -resetPasswordToken")
      .populate("companyId", "name logo status")
      .populate("driverId")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 });

    // Enhance with statistics
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const userObj = user.toObject();

        if (user.role === "customer") {
          const stats = await Delivery.aggregate([
            { $match: { customerId: user._id } },
            {
              $group: {
                _id: null,
                totalDeliveries: { $sum: 1 },
                totalSpent: { $sum: "$fare.totalFare" },
                completedDeliveries: {
                  $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
                },
              },
            },
          ]);
          userObj.stats = stats[0] || {
            totalDeliveries: 0,
            totalSpent: 0,
            completedDeliveries: 0,
          };
        } else if (user.role === "driver" && user.driverId) {
          const stats = await Delivery.aggregate([
            { $match: { driverId: user.driverId._id } },
            {
              $group: {
                _id: null,
                totalDeliveries: { $sum: 1 },
                completedDeliveries: {
                  $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
                },
                totalEarnings: {
                  $sum: { $add: ["$fare.actualTotal", "$tip.amount"] },
                },
                avgRating: { $avg: "$rating" },
              },
            },
          ]);
          userObj.stats = stats[0] || {
            totalDeliveries: 0,
            completedDeliveries: 0,
            totalEarnings: 0,
            avgRating: 0,
          };
        }

        return userObj;
      })
    );

    res.status(200).json({
      success: true,
      data: usersWithStats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
        hasNextPage: parseInt(page) * parseInt(limit) < total,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get users",
    });
  }
};

/**
 * @desc    Get user details by ID
 * @route   GET /api/admin/users/:userId
 * @access  Private (Admin)
 */
export const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const user = await User.findById(userId)
      .select("-password -refreshToken")
      .populate("companyId")
      .populate("driverId");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get comprehensive user data
    const [deliveries, payments, supportTickets] = await Promise.all([
      Delivery.find({
        $or: [{ customerId: userId }, { "driverId.userId": userId }],
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("customerId", "name email")
        .populate({
          path: "driverId",
          populate: { path: "userId", select: "name" },
        }),

      Payment.find({ customerId: userId })
        .sort({ createdAt: -1 })
        .limit(20),

      SupportTicket.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    // Calculate statistics
    let stats = {};
    if (user.role === "customer") {
      stats = await Delivery.aggregate([
        { $match: { customerId: user._id } },
        {
          $group: {
            _id: null,
            totalDeliveries: { $sum: 1 },
            completedDeliveries: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
            },
            cancelledDeliveries: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            totalSpent: { $sum: "$fare.totalFare" },
            avgSpending: { $avg: "$fare.totalFare" },
          },
        },
      ]).then((result) => result[0] || {});
    } else if (user.role === "driver" && user.driverId) {
      stats = await Delivery.aggregate([
        { $match: { driverId: user.driverId._id } },
        {
          $group: {
            _id: null,
            totalDeliveries: { $sum: 1 },
            completedDeliveries: {
              $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
            },
            totalEarnings: {
              $sum: { $add: ["$fare.actualTotal", "$tip.amount"] },
            },
            avgRating: { $avg: "$rating" },
            totalTips: { $sum: "$tip.amount" },
          },
        },
      ]).then((result) => result[0] || {});
    }

    res.status(200).json({
      success: true,
      data: {
        user,
        stats,
        deliveries,
        payments,
        supportTickets,
      },
    });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user details",
    });
  }
};

/**
 * @desc    Update user status and details
 * @route   PUT /api/admin/users/:userId
 * @access  Private (Admin)
 */
export const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      isActive,
      isVerified,
      role,
      companyId,
      name,
      email,
      phone,
      notes,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Prevent admin from modifying themselves
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot modify your own account",
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
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (notes !== undefined) updates.adminNotes = notes;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
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

    // Send notification to user
    await sendNotification({
      userId: updatedUser._id,
      title: "Account Updated",
      message: "Your account has been updated by an administrator",
      type: "account_update",
      data: { updates: Object.keys(updates) },
    });

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
    });
  }
};

/**
 * @desc    Suspend/Unsuspend user
 * @route   PUT /api/admin/users/:userId/suspend
 * @access  Private (Admin)
 */
export const suspendUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { suspend, reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    user.isActive = !suspend;
    user.suspendedAt = suspend ? new Date() : null;
    user.suspensionReason = suspend ? reason : null;
    user.suspendedBy = suspend ? req.user._id : null;
    await user.save();

    // If driver, update driver status
    if (user.role === "driver" && user.driverId) {
      await Driver.findByIdAndUpdate(user.driverId, {
        isActive: !suspend,
        isOnline: false,
        isAvailable: false,
      });
    }

    // Send notification
    await sendNotification({
      userId: user._id,
      title: suspend ? "Account Suspended" : "Account Reactivated",
      message: suspend
        ? `Your account has been suspended. Reason: ${reason}`
        : "Your account has been reactivated",
      type: suspend ? "account_suspended" : "account_reactivated",
    });

    res.status(200).json({
      success: true,
      message: suspend
        ? "User suspended successfully"
        : "User reactivated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Suspend user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to suspend/unsuspend user",
    });
  }
};

/**
 * @desc    Delete user (soft delete)
 * @route   DELETE /api/admin/users/:userId
 * @access  Private (Admin)
 */
export const deleteUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { userId } = req.params;
    const { permanent = false } = req.body;

    if (userId === req.user._id.toString()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (permanent) {
      // Hard delete - remove completely
      await User.findByIdAndDelete(userId).session(session);
      
      // Clean up related data
      if (user.role === "driver" && user.driverId) {
        await Driver.findByIdAndDelete(user.driverId).session(session);
      }
    } else {
      // Soft delete
      user.isActive = false;
      user.isDeleted = true;
      user.deletedAt = new Date();
      user.deletedBy = req.user._id;
      await user.save({ session });

      // Update driver if applicable
      if (user.role === "driver" && user.driverId) {
        await Driver.findByIdAndUpdate(
          user.driverId,
          {
            isActive: false,
            isOnline: false,
            isAvailable: false,
          },
          { session }
        );
      }
    }

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: permanent
        ? "User permanently deleted"
        : "User deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reset user password
 * @route   POST /api/admin/users/:userId/reset-password
 * @access  Private (Admin)
 */
export const resetUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword, sendEmail = true } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.refreshToken = null; // Force logout
    await user.save();

    // Send notification
    await sendNotification({
      userId: user._id,
      title: "Password Reset",
      message: "Your password has been reset by an administrator",
      type: "password_reset",
    });

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset password",
    });
  }
};

/**
 * ========================================
 * DRIVER MANAGEMENT
 * ========================================
 */

/**
 * @desc    Get all drivers with filtering
 * @route   GET /api/admin/drivers
 * @access  Private (Admin)
 */
export const getAllDrivers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      isOnline,
      isAvailable,
      isActive,
      vehicleType,
      companyId,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      minRating,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // Build query
    if (isOnline !== undefined) query.isOnline = isOnline === "true";
    if (isAvailable !== undefined) query.isAvailable = isAvailable === "true";
    if (isActive !== undefined) query.isActive = isActive === "true";
    if (vehicleType) query.vehicleType = vehicleType;
    if (companyId) query.companyId = companyId;
    if (minRating) query.rating = { $gte: parseFloat(minRating) };

    // Search
    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      query.$or = [
        { userId: { $in: users.map((u) => u._id) } },
        { plateNumber: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Driver.countDocuments(query);

    const drivers = await Driver.find(query)
      .populate("userId", "name email phone avatarUrl isActive")
      .populate("companyId", "name logo")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 });

    // Enhance with statistics
    const driversWithStats = await Promise.all(
      drivers.map(async (driver) => {
        const driverObj = driver.toObject();

        const stats = await Delivery.aggregate([
          { $match: { driverId: driver._id } },
          {
            $group: {
              _id: null,
              totalDeliveries: { $sum: 1 },
              completedDeliveries: {
                $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
              },
              totalEarnings: {
                $sum: { $add: ["$fare.actualTotal", "$tip.amount"] },
              },
              avgRating: { $avg: "$rating" },
              totalTips: { $sum: "$tip.amount" },
            },
          },
        ]);

        driverObj.stats = stats[0] || {
          totalDeliveries: 0,
          completedDeliveries: 0,
          totalEarnings: 0,
          avgRating: 0,
          totalTips: 0,
        };

        return driverObj;
      })
    );

    res.status(200).json({
      success: true,
      data: driversWithStats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get drivers",
    });
  }
};

/**
 * @desc    Get driver details
 * @route   GET /api/admin/drivers/:driverId
 * @access  Private (Admin)
 */
export const getDriverById = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId)
      .populate("userId")
      .populate("companyId");

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    // Get deliveries and earnings
    const [deliveries, earnings, recentActivity] = await Promise.all([
      Delivery.find({ driverId: driver._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("customerId", "name phone"),

      Delivery.aggregate([
        { $match: { driverId: driver._id, status: "delivered" } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m", date: "$createdAt" },
            },
            count: { $sum: 1 },
            earnings: { $sum: { $add: ["$fare.actualTotal", "$tip.amount"] } },
            tips: { $sum: "$tip.amount" },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 12 },
      ]),

      Delivery.find({ driverId: driver._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("status pickup dropoff createdAt"),
    ]);

    res.status(200).json({
      success: true,
      data: {
        driver,
        deliveries,
        earnings,
        recentActivity,
      },
    });
  } catch (error) {
    console.error("Get driver by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver details",
    });
  }
};

/**
 * @desc    Update driver status
 * @route   PUT /api/admin/drivers/:driverId
 * @access  Private (Admin)
 */
export const updateDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const {
      isActive,
      isVerified,
      vehicleType,
      plateNumber,
      companyId,
      notes,
    } = req.body;

    const updates = {};

    if (isActive !== undefined) {
      updates.isActive = isActive;
      if (!isActive) {
        updates.isOnline = false;
        updates.isAvailable = false;
      }
    }
    if (isVerified !== undefined) updates.isVerified = isVerified;
    if (vehicleType !== undefined) updates.vehicleType = vehicleType;
    if (plateNumber !== undefined) updates.plateNumber = plateNumber;
    if (companyId !== undefined) updates.companyId = companyId;
    if (notes !== undefined) updates.adminNotes = notes;

    const driver = await Driver.findByIdAndUpdate(
      driverId,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate("userId companyId");

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    // Notify driver
    if (driver.userId) {
      await sendNotification({
        userId: driver.userId._id,
        title: "Driver Profile Updated",
        message: "Your driver profile has been updated by an administrator",
        type: "driver_update",
      });
    }

    res.status(200).json({
      success: true,
      message: "Driver updated successfully",
      data: driver,
    });
  } catch (error) {
    console.error("Update driver error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update driver",
    });
  }
};

/**
 * @desc    Approve/Reject driver application
 * @route   PUT /api/admin/drivers/:driverId/approve
 * @access  Private (Admin)
 */
export const approveDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { approve, reason } = req.body;

    const driver = await Driver.findById(driverId).populate("userId");

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    driver.isVerified = approve;
    driver.isActive = approve;
    driver.verificationStatus = approve ? "approved" : "rejected";
    driver.verificationNotes = reason;
    driver.verifiedAt = approve ? new Date() : null;
    driver.verifiedBy = req.user._id;
    await driver.save();

    // Update user verification status
    if (driver.userId) {
      await User.findByIdAndUpdate(driver.userId._id, {
        isVerified: approve,
      });

      // Send notification
      await sendNotification({
        userId: driver.userId._id,
        title: approve
          ? "Driver Application Approved"
          : "Driver Application Rejected",
        message: approve
          ? "Congratulations! Your driver application has been approved. You can now start accepting deliveries."
          : `Your driver application has been rejected. Reason: ${reason}`,
        type: approve ? "driver_approved" : "driver_rejected",
      });
    }

    res.status(200).json({
      success: true,
      message: approve
        ? "Driver approved successfully"
        : "Driver rejected successfully",
      data: driver,
    });
  } catch (error) {
    console.error("Approve driver error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve/reject driver",
    });
  }
};

/**
 * ========================================
 * COMPANY MANAGEMENT  
 * ========================================
 */
 

 

/**
 * @desc    Get all companies
 * @route   GET /api/admin/companies
 * @access  Private (Admin)
 */
export const getAllCompanies = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    if (status) query.status = status;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { contactPhone: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Company.countDocuments(query);

    const companies = await Company.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 });

    // Enhance with statistics
    const companiesWithStats = await Promise.all(
      companies.map(async (company) => {
        const companyObj = company.toObject();

        const [driverCount, deliveryStats, earnings] = await Promise.all([
          Driver.countDocuments({ companyId: company._id }),

          Delivery.aggregate([
            { $match: { companyId: company._id } },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                completed: {
                  $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
                },
              },
            },
          ]),

          Payment.aggregate([
            { $match: { companyId: company._id, status: "successful" } },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$amount" },
              },
            },
          ]),
        ]);

        companyObj.stats = {
          totalDrivers: driverCount,
          totalDeliveries: deliveryStats[0]?.total || 0,
          completedDeliveries: deliveryStats[0]?.completed || 0,
          totalRevenue: earnings[0]?.totalRevenue || 0,
        };

        return companyObj;
      })
    );

    res.status(200).json({
      success: true,
      data: companiesWithStats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all companies error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get companies",
    });
  }
};

/**
 * @desc    Get company details
 * @route   GET /api/admin/companies/:companyId
 * @access  Private (Admin)
 */
export const getCompanyById = async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Get comprehensive company data
    const [drivers, deliveries, payments, admins] = await Promise.all([
      Driver.find({ companyId: company._id })
        .populate("userId", "name email phone")
        .limit(20),

      Delivery.find({ companyId: company._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("customerId", "name")
        .populate({
          path: "driverId",
          populate: { path: "userId", select: "name" },
        }),

      Payment.find({ companyId: company._id })
        .sort({ createdAt: -1 })
        .limit(20),

      User.find({ companyId: company._id, role: "company_admin" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        company,
        drivers,
        deliveries,
        payments,
        admins,
      },
    });
  } catch (error) {
    console.error("Get company by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company details",
    });
  }
};

/**
 * @desc    Update company status
 * @route   PUT /api/admin/companies/:companyId
 * @access  Private (Admin)
 */
export const updateCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { status, name, email, contactPhone, address, notes } = req.body;

    const updates = {};

    if (status !== undefined) updates.status = status;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    if (address !== undefined) updates.address = address;
    if (notes !== undefined) updates.adminNotes = notes;

    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // If company is suspended, deactivate all drivers
    if (status === "suspended") {
      await Driver.updateMany(
        { companyId: company._id },
        {
          $set: {
            isActive: false,
            isOnline: false,
            isAvailable: false,
          },
        }
      );
    }

    // Notify company admins
    const admins = await User.find({
      companyId: company._id,
      role: "company_admin",
    });
    
    for (const admin of admins) {
      await sendNotification({
        userId: admin._id,
        title: "Company Profile Updated",
        message: "Your company profile has been updated by an administrator",
        type: "company_update",
      });
    }

    res.status(200).json({
      success: true,
      message: "Company updated successfully",
      data: company,
    });
  } catch (error) {
    console.error("Update company error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update company",
    });
  }
};

/**
 * @desc    Approve/Reject company
 * @route   PUT /api/admin/companies/:companyId/approve
 * @access  Private (Admin)
 */
export const approveCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { approve, reason } = req.body;

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    company.status = approve ? "active" : "rejected";
    company.verificationNotes = reason;
    company.verifiedAt = approve ? new Date() : null;
    company.verifiedBy = req.user._id;
    await company.save();

    // Notify company admins
    const admins = await User.find({
      companyId: company._id,
      role: "company_admin",
    });

    for (const admin of admins) {
      await sendNotification({
        userId: admin._id,
        title: approve ? "Company Approved" : "Company Rejected",
        message: approve
          ? "Your company has been approved and is now active"
          : `Your company registration has been rejected. Reason: ${reason}`,
        type: approve ? "company_approved" : "company_rejected",
      });
    }

    res.status(200).json({
      success: true,
      message: approve
        ? "Company approved successfully"
        : "Company rejected successfully",
      data: company,
    });
  } catch (error) {
    console.error("Approve company error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to approve/reject company",
    });
  }
};

/**
 * ========================================
 * DELIVERY MANAGEMENT
 * ========================================
 */

/**
 * @desc    Get all deliveries with advanced filtering
 * @route   GET /api/admin/deliveries
 * @access  Private (Admin)
 */
export const getAllDeliveries = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      vehicleType,
      customerId,
      driverId,
      companyId,
      startDate,
      endDate,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // Build query
    if (status) query.status = status;
    if (vehicleType) query.vehicleType = vehicleType;
    if (customerId) query.customerId = customerId;
    if (driverId) query.driverId = driverId;
    if (companyId) query.companyId = companyId;

    // Date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Search by delivery ID or tracking number
    if (search) {
      query.$or = [
        { deliveryId: { $regex: search, $options: "i" } },
        { trackingNumber: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Delivery.countDocuments(query);

    const deliveries = await Delivery.find(query)
      .populate("customerId", "name email phone")
      .populate({
        path: "driverId",
        populate: {
          path: "userId",
          select: "name phone",
        },
      })
      .populate("companyId", "name")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 });

    res.status(200).json({
      success: true,
      data: deliveries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all deliveries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get deliveries",
    });
  }
};

/**
 * @desc    Get delivery details
 * @route   GET /api/admin/deliveries/:deliveryId
 * @access  Private (Admin)
 */
export const getDeliveryById = async (req, res) => {
  try {
    const { deliveryId } = req.params;

    const delivery = await Delivery.findById(deliveryId)
      .populate("customerId")
      .populate({
        path: "driverId",
        populate: {
          path: "userId companyId",
        },
      })
      .populate("companyId");

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // Get related data
    const [payment, chatMessages, voiceCalls] = await Promise.all([
      Payment.findOne({ deliveryId: delivery._id }),
      ChatMessage.find({ deliveryId: delivery._id }).populate(
        "senderId",
        "name"
      ),
      VoiceCall.find({ deliveryId: delivery._id }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        delivery,
        payment,
        chatMessages,
        voiceCalls,
      },
    });
  } catch (error) {
    console.error("Get delivery by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get delivery details",
    });
  }
};

/**
 * @desc    Update delivery status
 * @route   PUT /api/admin/deliveries/:deliveryId/status
 * @access  Private (Admin)
 */
export const updateDeliveryStatus = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, reason } = req.body;

    const validStatuses = [
      "created",
      "pending_driver",
      "driver_assigned",
      "picked_up",
      "in_transit",
      "delivered",
      "cancelled",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
        validStatuses,
      });
    }

    const delivery = await Delivery.findById(deliveryId)
      .populate("customerId", "name")
      .populate({
        path: "driverId",
        populate: { path: "userId", select: "name" },
      });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const oldStatus = delivery.status;
    delivery.status = status;
    delivery.adminUpdatedStatus = true;
    delivery.adminUpdateReason = reason;

    // Update timestamps based on status
    if (status === "picked_up" && !delivery.pickupTime) {
      delivery.pickupTime = new Date();
    } else if (status === "delivered" && !delivery.deliveryTime) {
      delivery.deliveryTime = new Date();
    } else if (status === "cancelled" && !delivery.cancelledAt) {
      delivery.cancelledAt = new Date();
      delivery.cancellationReason = reason;
    }

    await delivery.save();

    // Notify customer
    if (delivery.customerId) {
      await sendNotification({
        userId: delivery.customerId._id,
        title: "Delivery Status Updated",
        message: `Your delivery status has been updated to: ${status}`,
        type: "delivery_status_update",
        data: {
          deliveryId: delivery._id,
          oldStatus,
          newStatus: status,
        },
      });
    }

    // Notify driver
    if (delivery.driverId?.userId) {
      await sendNotification({
        userId: delivery.driverId.userId._id,
        title: "Delivery Status Updated",
        message: `Delivery status has been updated by admin to: ${status}`,
        type: "delivery_status_update",
        data: {
          deliveryId: delivery._id,
          oldStatus,
          newStatus: status,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Delivery status updated successfully",
      data: delivery,
    });
  } catch (error) {
    console.error("Update delivery status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update delivery status",
    });
  }
};

/**
 * @desc    Assign/Reassign driver to delivery
 * @route   PUT /api/admin/deliveries/:deliveryId/assign-driver
 * @access  Private (Admin)
 */
export const assignDriver = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { driverId } = req.body;

    const [delivery, driver] = await Promise.all([
      Delivery.findById(deliveryId).populate("customerId", "name"),
      Driver.findById(driverId).populate("userId", "name"),
    ]);

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    if (!driver.isActive || !driver.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Driver is not active or verified",
      });
    }

    const oldDriverId = delivery.driverId;
    delivery.driverId = driver._id;
    delivery.status = "driver_assigned";
    delivery.driverAssignedAt = new Date();
    delivery.adminAssigned = true;
    await delivery.save();

    // Notify new driver
    if (driver.userId) {
      await sendNotification({
        userId: driver.userId._id,
        title: "New Delivery Assigned",
        message: "You have been assigned a new delivery by admin",
        type: "delivery_assigned",
        data: { deliveryId: delivery._id },
      });
    }

    // Notify old driver if exists
    if (oldDriverId) {
      const oldDriver = await Driver.findById(oldDriverId).populate("userId");
      if (oldDriver?.userId) {
        await sendNotification({
          userId: oldDriver.userId._id,
          title: "Delivery Reassigned",
          message: "Your delivery has been reassigned to another driver",
          type: "delivery_reassigned",
          data: { deliveryId: delivery._id },
        });
      }
    }

    // Notify customer
    if (delivery.customerId) {
      await sendNotification({
        userId: delivery.customerId._id,
        title: "Driver Assigned",
        message: `${driver.userId.name} has been assigned to your delivery`,
        type: "driver_assigned",
        data: { deliveryId: delivery._id },
      });
    }

    res.status(200).json({
      success: true,
      message: "Driver assigned successfully",
      data: delivery,
    });
  } catch (error) {
    console.error("Assign driver error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to assign driver",
    });
  }
};

/**
 * ========================================
 * PAYMENT MANAGEMENT
 * ========================================
 */

/**
 * @desc    Get all payments with filtering
 * @route   GET /api/admin/payments
 * @access  Private (Admin)
 */
export const getAllPayments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      customerId,
      driverId,
      companyId,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // Build query
    if (status) query.status = status;
    if (customerId) query.customerId = customerId;
    if (driverId) query.driverId = driverId;
    if (companyId) query.companyId = companyId;

    // Date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Amount range
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }

    const total = await Payment.countDocuments(query);

    const payments = await Payment.find(query)
      .populate("customerId", "name email")
      .populate("deliveryId", "deliveryId trackingNumber")
      .populate({
        path: "driverId",
        populate: { path: "userId", select: "name" },
      })
      .populate("companyId", "name")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 });

    // Calculate totals
    const totals = await Payment.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          totalPlatformFees: { $sum: "$platformFee" },
          totalCompanyRevenue: {
            $sum: { $subtract: ["$amount", "$platformFee"] },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: payments,
      totals: totals[0] || {
        totalAmount: 0,
        totalPlatformFees: 0,
        totalCompanyRevenue: 0,
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payments",
    });
  }
};

/**
 * @desc    Get payment details
 * @route   GET /api/admin/payments/:paymentId
 * @access  Private (Admin)
 */
export const getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId)
      .populate("customerId")
      .populate("deliveryId")
      .populate({
        path: "driverId",
        populate: { path: "userId" },
      })
      .populate("companyId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    console.error("Get payment by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payment details",
    });
  }
};

/**
 * @desc    Issue refund
 * @route   POST /api/admin/payments/:paymentId/refund
 * @access  Private (Admin)
 */
export const issueRefund = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;

    const payment = await Payment.findById(paymentId).populate(
      "customerId",
      "name email"
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.status !== "successful") {
      return res.status(400).json({
        success: false,
        message: "Can only refund successful payments",
      });
    }

    if (payment.refundStatus === "refunded") {
      return res.status(400).json({
        success: false,
        message: "Payment already refunded",
      });
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      return res.status(400).json({
        success: false,
        message: "Refund amount cannot exceed payment amount",
      });
    }

    // Update payment record
    payment.refundStatus = "refunded";
    payment.refundAmount = refundAmount;
    payment.refundReason = reason;
    payment.refundedAt = new Date();
    payment.refundedBy = req.user._id;
    await payment.save();

    // Notify customer
    if (payment.customerId) {
      await sendNotification({
        userId: payment.customerId._id,
        title: "Refund Processed",
        message: `A refund of ₦${refundAmount} has been processed for your payment`,
        type: "refund_processed",
        data: {
          paymentId: payment._id,
          amount: refundAmount,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      data: payment,
    });
  } catch (error) {
    console.error("Issue refund error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process refund",
    });
  }
};

/**
 * ========================================
 * SUPPORT TICKET MANAGEMENT
 * ========================================
 */

/**
 * @desc    Get all support tickets
 * @route   GET /api/admin/support-tickets
 * @access  Private (Admin)
 */
export const getAllSupportTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      issueType,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // Build query
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (issueType) query.issueType = issueType;

    // Search
    if (search) {
      query.$or = [
        { ticketId: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const total = await SupportTicket.countDocuments(query);

    const tickets = await SupportTicket.find(query)
      .populate("user", "name email phone role")
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 });

    res.status(200).json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get all support tickets error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get support tickets",
    });
  }
};

/**
 * @desc    Get support ticket details
 * @route   GET /api/admin/support-tickets/:ticketId
 * @access  Private (Admin)
 */
export const getSupportTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findById(ticketId).populate(
      "user",
      "name email phone role"
    );

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("Get support ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get support ticket",
    });
  }
};

/**
 * @desc    Update support ticket
 * @route   PUT /api/admin/support-tickets/:ticketId
 * @access  Private (Admin)
 */
export const updateSupportTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, priority, assignedTo, response, internalNotes } = req.body;

    const updates = {};

    if (status !== undefined) {
      updates.status = status;
      if (status === "resolved") {
        updates.resolvedAt = new Date();
        updates.resolvedBy = req.user._id;
      }
    }
    if (priority !== undefined) updates.priority = priority;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (response !== undefined) {
      updates.response = response;
      updates.respondedAt = new Date();
      updates.respondedBy = req.user._id;
    }
    if (internalNotes !== undefined) updates.internalNotes = internalNotes;

    const ticket = await SupportTicket.findByIdAndUpdate(
      ticketId,
      { $set: updates },
      { new: true }
    ).populate("user", "name email");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found",
      });
    }

    // Notify user if status changed or response added
    if ((status || response) && ticket.user) {
      await sendNotification({
        userId: ticket.user._id,
        title: "Support Ticket Updated",
        message:
          response ||
          `Your support ticket status has been updated to: ${status}`,
        type: "ticket_update",
        data: {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketId,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Support ticket updated successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Update support ticket error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update support ticket",
    });
  }
};

/**
 * ========================================
 * SYSTEM SETTINGS & CONFIGURATION
 * ========================================
 */

/**
 * @desc    Get system statistics
 * @route   GET /api/admin/system/stats
 * @access  Private (Admin)
 */
export const getSystemStats = async (req, res) => {
  try {
    const stats = await Promise.all([
      User.estimatedDocumentCount(),
      Driver.estimatedDocumentCount(),
      Company.estimatedDocumentCount(),
      Delivery.estimatedDocumentCount(),
      Payment.estimatedDocumentCount(),
      SupportTicket.estimatedDocumentCount(),
      ChatMessage.estimatedDocumentCount(),
      VoiceCall.estimatedDocumentCount(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: stats[0],
        drivers: stats[1],
        companies: stats[2],
        deliveries: stats[3],
        payments: stats[4],
        supportTickets: stats[5],
        chatMessages: stats[6],
        voiceCalls: stats[7],
      },
    });
  } catch (error) {
    console.error("Get system stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get system statistics",
    });
  }
};

/**
 * @desc    Send bulk notification
 * @route   POST /api/admin/notifications/bulk
 * @access  Private (Admin)
 */
export const sendBulkNotification = async (req, res) => {
  try {
    const { title, message, userIds, roles, type = "announcement" } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required",
      });
    }

    let targetUsers = [];

    if (userIds && userIds.length > 0) {
      targetUsers = await User.find({ _id: { $in: userIds } }).select("_id");
    } else if (roles && roles.length > 0) {
      targetUsers = await User.find({ role: { $in: roles } }).select("_id");
    } else {
      targetUsers = await User.find({ isActive: true }).select("_id");
    }

    // Send notifications
    const notificationPromises = targetUsers.map((user) =>
      sendNotification({
        userId: user._id,
        title,
        message,
        type,
      })
    );

    await Promise.all(notificationPromises);

    res.status(200).json({
      success: true,
      message: `Notification sent to ${targetUsers.length} users`,
      data: { recipientCount: targetUsers.length },
    });
  } catch (error) {
    console.error("Send bulk notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send bulk notification",
    });
  }
};

/**
 * @desc    Export data
 * @route   GET /api/admin/export/:dataType
 * @access  Private (Admin)
 */
export const exportData = async (req, res) => {
  try {
    const { dataType } = req.params;
    const { format = "json", startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    let data = [];
    const query = startDate || endDate ? { createdAt: dateFilter } : {};

    switch (dataType) {
      case "users":
        data = await User.find(query).select("-password -refreshToken");
        break;
      case "drivers":
        data = await Driver.find(query).populate("userId", "name email");
        break;
      case "deliveries":
        data = await Delivery.find(query)
          .populate("customerId", "name email")
          .populate("driverId");
        break;
      case "payments":
        data = await Payment.find(query);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Invalid data type",
        });
    }

    res.status(200).json({
      success: true,
      dataType,
      format,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Export data error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export data",
    });
  }
};