import User from "../models/user.models.js";
import Rider from "../models/riders.models.js"; // Assuming you have this model
import bcrypt from "bcrypt";
import mongoose from "mongoose";

/**
 * -------------------------------
 * GET MY PROFILE
 * -------------------------------
 */
export const getMyProfile = async (req, res, next) => {
  try {
    // req.user is already a plain object
    const user = { ...req.user };
    
    // Remove sensitive data
    delete user.password;
    delete user.refreshToken;

    res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};
/**
 * -------------------------------
 * UPDATE MY PROFILE
 * -------------------------------
 */
export const updateMyProfile = async (req, res, next) => {
  try {
    const { name, phone, avatarUrl } = req.body;
    const userId = req.user._id;
    
    // Build update object with validation
    const updates = {};
    
    if (name) {
      if (name.trim().length < 2) {
        const error = new Error("Name must be at least 2 characters");
        error.statusCode = 400;
        throw error;
      }
      updates.name = name.trim();
    }
    
    if (phone) {
      // Phone validation
      const phoneRegex = /^[+]?[\d\s\-\(\)]{10,}$/;
      if (!phoneRegex.test(phone)) {
        const error = new Error("Invalid phone number format");
        error.statusCode = 400;
        throw error;
      }
      
      // Check if phone is already taken by another user
      const existingPhone = await User.findOne({ 
        phone, 
        _id: { $ne: userId } 
      });
      
      if (existingPhone) {
        const error = new Error("Phone number already in use");
        error.statusCode = 409;
        throw error;
      }
      
      updates.phone = phone;
    }
    
    if (avatarUrl !== undefined) {
      if (avatarUrl && !avatarUrl.startsWith('http')) {
        const error = new Error("Invalid avatar URL");
        error.statusCode = 400;
        throw error;
      }
      updates.avatarUrl = avatarUrl || null;
    }
    
    if (Object.keys(updates).length === 0) {
      const error = new Error("No valid fields to update");
      error.statusCode = 400;
      throw error;
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { 
        new: true,
        runValidators: true 
      }
    ).select('-password -refreshToken');
    
    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * CHANGE PASSWORD
 * -------------------------------
 */
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;
    
    // Validation
    if (!currentPassword || !newPassword) {
      const error = new Error("Current password and new password are required");
      error.statusCode = 400;
      throw error;
    }
    
    if (currentPassword === newPassword) {
      const error = new Error("New password must be different from current password");
      error.statusCode = 400;
      throw error;
    }
    
    // Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      const error = new Error(
        "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
      );
      error.statusCode = 400;
      throw error;
    }
    
    // Get user with password
    const user = await User.findById(userId);
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      const error = new Error("Current password is incorrect");
      error.statusCode = 401;
      throw error;
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password and clear refresh token (forces re-login on all devices)
    user.password = hashedPassword;
    user.refreshToken = null;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * COMPANY ADMIN → CREATE RIDER
 * POST /companies/:companyId/riders
 * -------------------------------
 */
export const createRider = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const admin = req.user;
    const { companyId } = req.params;
    const { name, phone, email, password, vehicleType, plateNumber } = req.body;
    
    // Validate admin permissions
    if (admin.role !== "company_admin") {
      const error = new Error("Only company admins can create riders");
      error.statusCode = 403;
      throw error;
    }
    
    if (!admin.companyId || admin.companyId.toString() !== companyId) {
      const error = new Error("Cannot create riders for another company");
      error.statusCode = 403;
      throw error;
    }
    
    // Validate required fields
    if (!name || !phone || !password) {
      const error = new Error("Name, phone, and password are required");
      error.statusCode = 400;
      throw error;
    }
    
    // Validate phone format
    const phoneRegex = /^[+]?[\d\s\-\(\)]{10,}$/;
    if (!phoneRegex.test(phone)) {
      const error = new Error("Invalid phone number format");
      error.statusCode = 400;
      throw error;
    }
    
    // Validate email if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        const error = new Error("Invalid email format");
        error.statusCode = 400;
        throw error;
      }
    }
    
    // Password strength validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      const error = new Error(
        "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
      );
      error.statusCode = 400;
      throw error;
    }
    
    // Check for existing user
    const existingUser = await User.findOne({
      $or: [
        { email: email?.trim() || '' },
        { phone }
      ]
    }).session(session);
    
    if (existingUser) {
      const error = new Error("User with this email or phone already exists");
      error.statusCode = 409;
      throw error;
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create rider user
    const riderUser = await User.create([{
      name: name.trim(),
      phone,
      email: email?.trim() || null,
      password: hashedPassword,
      role: "rider",
      companyId,
      isVerified: false,
      isActive: true,
    }], { session });
    
    // Create rider profile if you have Rider model
    if (Rider) {
      await Rider.create([{
        userId: riderUser[0]._id,
        companyId,
        vehicleType: vehicleType || "bike",
        plateNumber: plateNumber || "",
        isAvailable: true,
        currentStatus: "idle",
      }], { session });
    }
    
    await session.commitTransaction();
    
    const result = riderUser[0].toObject();
    delete result.password;
    delete result.refreshToken;
    
    res.status(201).json({
      success: true,
      message: "Rider created successfully",
      data: result,
    });
    
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * -------------------------------
 * COMPANY ADMIN → LIST RIDERS WITH PAGINATION
 * GET /companies/:companyId/riders
 * -------------------------------
 */
export const getCompanyRiders = async (req, res, next) => {
  try {
    const admin = req.user;
    const { companyId } = req.params;
    
    // Query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status; // active, inactive, all
    const search = req.query.search;
    
    if (admin.role !== "company_admin") {
      const error = new Error("Only company admins can view riders");
      error.statusCode = 403;
      throw error;
    }
    
    if (!admin.companyId || admin.companyId.toString() !== companyId) {
      const error = new Error("Cannot access another company's riders");
      error.statusCode = 403;
      throw error;
    }
    
    // Build query
    const query = { 
      role: "rider",
      companyId 
    };
    
    // Filter by status
    if (status === 'active') {
      query.isActive = true;
    } else if (status === 'inactive') {
      query.isActive = false;
    }
    
    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Get total count for pagination
    const total = await User.countDocuments(query);
    
    // Get paginated riders
    const riders = await User.find(query)
      .select("-password -refreshToken")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      message: "Riders fetched successfully",
      data: riders,
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
    next(error);
  }
};

/**
 * -------------------------------
 * GET SINGLE USER
 * -------------------------------
 */
export const getUserById = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const requestingUser = req.user;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error("Invalid user ID");
      error.statusCode = 400;
      throw error;
    }
    
    // Check permissions
    if (requestingUser.role === 'admin') {
      // Admin can view anyone
    } else if (requestingUser.role === 'company_admin') {
      // Company admin can only view users in their company
      const userToView = await User.findById(userId);
      if (!userToView || userToView.companyId?.toString() !== requestingUser.companyId?.toString()) {
        const error = new Error("Cannot access this user");
        error.statusCode = 403;
        throw error;
      }
    } else if (requestingUser.role === 'rider' || requestingUser.role === 'customer') {
      // Can only view own profile
      if (requestingUser._id.toString() !== userId) {
        const error = new Error("You can only view your own profile");
        error.statusCode = 403;
        throw error;
      }
    }
    
    const user = await User.findById(userId)
      .select("-password -refreshToken")
      .populate('companyId', 'name city status');
    
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }
    
    res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * DELETE / DEACTIVATE RIDER
 * -------------------------------
 */
export const deleteRider = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const admin = req.user;
    const { companyId, riderId } = req.params;
    
    if (admin.role !== "company_admin") {
      const error = new Error("Only company admins can delete riders");
      error.statusCode = 403;
      throw error;
    }
    
    if (!admin.companyId || admin.companyId.toString() !== companyId) {
      const error = new Error("Cannot delete riders for another company");
      error.statusCode = 403;
      throw error;
    }
    
    const rider = await User.findById(riderId).session(session);
    
    if (!rider) {
      const error = new Error("Rider not found");
      error.statusCode = 404;
      throw error;
    }
    
    if (rider.role !== "rider") {
      const error = new Error("User is not a rider");
      error.statusCode = 400;
      throw error;
    }
    
    if (rider.companyId?.toString() !== companyId) {
      const error = new Error("Rider does not belong to your company");
      error.statusCode = 403;
      throw error;
    }
    
    // Soft delete: deactivate user and rider profile
    rider.isActive = false;
    await rider.save({ session });
    
    // Also update rider profile if exists
    if (Rider) {
      await Rider.findOneAndUpdate(
        { userId: riderId },
        { isAvailable: false, currentStatus: 'offline' },
        { session }
      );
    }
    
    await session.commitTransaction();
    
    res.status(200).json({
      success: true,
      message: "Rider deactivated successfully",
    });
    
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * -------------------------------
 * ADMIN: GET ALL USERS WITH PAGINATION
 * -------------------------------
 */
export const getAllUsers = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      const error = new Error("Only admins can access all users");
      error.statusCode = 403;
      throw error;
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
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    
    // Build query
    const query = {};
    
    if (role) query.role = role;
    if (companyId) query.companyId = companyId;
    if (isVerified !== undefined) query.isVerified = isVerified === 'true';
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Get total count
    const total = await User.countDocuments(query);
    
    // Get paginated users
    const users = await User.find(query)
      .select("-password -refreshToken")
      .populate('companyId', 'name')
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
        hasPrevPage: page > 1
      }
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * -------------------------------
 * ADMIN: UPDATE USER STATUS
 * -------------------------------
 */
export const updateUserStatus = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      const error = new Error("Only admins can update user status");
      error.statusCode = 403;
      throw error;
    }
    
    const { userId } = req.params;
    const { isActive, isVerified } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error("Invalid user ID");
      error.statusCode = 400;
      throw error;
    }
    
    // Prevent admin from deactivating themselves
    if (userId === req.user._id.toString() && isActive === false) {
      const error = new Error("Cannot deactivate your own account");
      error.statusCode = 400;
      throw error;
    }
    
    const updates = {};
    if (isActive !== undefined) updates.isActive = isActive;
    if (isVerified !== undefined) updates.isVerified = isVerified;
    
    if (Object.keys(updates).length === 0) {
      const error = new Error("No status fields to update");
      error.statusCode = 400;
      throw error;
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password -refreshToken");
    
    if (!updatedUser) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }
    
    res.status(200).json({
      success: true,
      message: "User status updated successfully",
      data: updatedUser,
    });
    
  } catch (error) {
    next(error);
  }
};