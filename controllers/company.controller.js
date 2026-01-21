import Company from "../models/company.models.js";
import User from "../models/user.models.js";
import mongoose from "mongoose";
import { validationResult } from "express-validator";
import Notification from "../models/notificaton.models.js";  

/**
 * @desc    Get company profile
 * @route   GET /api/company/profile
 * @access  Private (Company Admin)
 */
export const getCompanyProfile = async (req, res) => {
  try {
    const user = req.user;

    // Only company admins can access company profile
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can access company profile",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    const company = await Company.findById(user.companyId)
      .populate({
        path: "admins",
        select: "name email phone role lastLoginAt",
      })
      .populate({
        path: "drivers",
        select: "name email phone isActive lastLoginAt",
      });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Get company statistics
    const [totalDrivers, onlineDrivers, totalDeliveries, totalEarnings] = await Promise.all([
      // Total drivers
      User.countDocuments({
        companyId: company._id,
        role: "driver",
        isActive: true,
      }),
      // Online drivers
      User.countDocuments({
        companyId: company._id,
        role: "driver",
        isActive: true,
        // Assuming you have an online status field
        // isOnline: true
      }),
      // Total deliveries (you need to implement this based on your Delivery model)
      // Delivery.countDocuments({ companyId: company._id }),
      0, // Placeholder - replace with actual query
      // Total earnings (you need to implement this based on your Delivery model)
      // Delivery.aggregate([...])
      0, // Placeholder - replace with actual query
    ]);

    const companyProfile = {
      ...company.toObject(),
      stats: {
        totalDrivers,
        onlineDrivers,
        totalDeliveries,
        totalEarnings,
      },
    };

    res.status(200).json({
      success: true,
      data: companyProfile,
    });
  } catch (error) {
    console.error("❌ Get company profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company profile",
    });
  }
};

/**
 * @desc    Update company profile
 * @route   PUT /api/company/profile
 * @access  Private (Company Admin)
 */
export const updateCompanyProfile = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = req.user;
    const updateData = req.body;

    // Only company admins can update company profile
    if (user.role !== "company_admin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only company administrators can update company profile",
      });
    }

    if (!user.companyId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
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
        errors: errors.array(),
      });
    }

    // Fields that can be updated
    const allowedUpdates = [
      "name",
      "businessLicense",
      "taxId",
      "address",
      "city",
      "state",
      "lga",
      "contactPhone",
      "contactEmail",
      "logo",
      "description",
      "website",
    ];

    const filteredUpdates = {};
    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key) && updateData[key] !== undefined) {
        filteredUpdates[key] = updateData[key];
      }
    });

    // Handle bank details separately if provided
    if (updateData.bankDetails) {
      const allowedBankFields = ["accountName", "accountNumber", "bankName"];
      filteredUpdates["bankDetails"] = {};

      Object.keys(updateData.bankDetails).forEach((key) => {
        if (allowedBankFields.includes(key) && updateData.bankDetails[key] !== undefined) {
          filteredUpdates["bankDetails"][key] = updateData.bankDetails[key];
        }
      });

      // Mark as unverified when bank details are updated
      filteredUpdates["bankDetails.verified"] = false;
      filteredUpdates["bankDetails.verifiedAt"] = null;
    }

    // Check for duplicate business license or tax ID
    if (filteredUpdates.businessLicense || filteredUpdates.taxId) {
      const duplicateQuery = {
        _id: { $ne: user.companyId },
        $or: [],
      };

      if (filteredUpdates.businessLicense) {
        duplicateQuery.$or.push({ businessLicense: filteredUpdates.businessLicense });
      }

      if (filteredUpdates.taxId) {
        duplicateQuery.$or.push({ taxId: filteredUpdates.taxId });
      }

      if (duplicateQuery.$or.length > 0) {
        const existingCompany = await Company.findOne(duplicateQuery).session(session);
        if (existingCompany) {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({
            success: false,
            message: "Business license or tax ID already exists",
          });
        }
      }
    }

    // Update company
    const updatedCompany = await Company.findByIdAndUpdate(
      user.companyId,
      { $set: filteredUpdates },
      { new: true, runValidators: true, session }
    );

    if (!updatedCompany) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Company profile updated successfully",
      data: updatedCompany,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Update company profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update company profile",
    });
  }
};

/**
 * @desc    Update company settings
 * @route   PUT /api/company/settings
 * @access  Private (Company Admin)
 */
export const updateCompanySettings = async (req, res) => {
  try {
    const user = req.user;
    const settings = req.body;

    // Only company admins can update settings
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can update settings",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    // Validate settings
    const allowedSettings = ["operatingHours", "autoAccept", "commissionRate", "notificationChannels"];
    const filteredSettings = {};

    allowedSettings.forEach((key) => {
      if (settings[key] !== undefined) {
        filteredSettings[key] = settings[key];
      }
    });

    // Additional validation
    if (filteredSettings.commissionRate !== undefined) {
      if (filteredSettings.commissionRate < 0 || filteredSettings.commissionRate > 100) {
        return res.status(400).json({
          success: false,
          message: "Commission rate must be between 0 and 100",
        });
      }
    }

    if (filteredSettings.operatingHours) {
      if (!filteredSettings.operatingHours.start || !filteredSettings.operatingHours.end) {
        return res.status(400).json({
          success: false,
          message: "Operating hours must include start and end times",
        });
      }
    }

    // Update company settings
    const updatedCompany = await Company.findByIdAndUpdate(
      user.companyId,
      { $set: { settings: filteredSettings } },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Company settings updated successfully",
      data: filteredSettings,
    });
  } catch (error) {
    console.error("❌ Update company settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update company settings",
    });
  }
};

/**
 * @desc    Upload company document
 * @route   POST /api/company/documents
 * @access  Private (Company Admin)
 */
export const uploadCompanyDocument = async (req, res) => {
  try {
    const user = req.user;
    const { type } = req.body;
    const file = req.file;

    // Only company admins can upload documents
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can upload documents",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Document type is required",
      });
    }

    const allowedTypes = [
      "business_license",
      "tax_certificate",
      "bank_statement",
      "proof_of_address",
      "id_card",
      "insurance_certificate",
      "vehicle_registration",
      "other",
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid document type",
      });
    }

    // In production, you would upload to cloud storage (S3, Cloudinary, etc.)
    // For now, we'll simulate with a local path
    const documentUrl = `/uploads/documents/${file.filename}`;

    const newDocument = {
      name: file.originalname,
      url: documentUrl,
      type,
      uploadedAt: new Date(),
      verified: false,
      verifiedBy: null,
      verifiedAt: null,
    };

    // Add document to company's onboardingDocs array
    const updatedCompany = await Company.findByIdAndUpdate(
      user.companyId,
      {
        $push: { onboardingDocs: newDocument },
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Document uploaded successfully",
      data: newDocument,
    });
  } catch (error) {
    console.error("❌ Upload document error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload document",
    });
  }
};

/**
 * @desc    Get company drivers
 * @route   GET /api/company/drivers
 * @access  Private (Company Admin)
 */
export const getCompanyDrivers = async (req, res) => {
  try {
    const user = req.user;

    // Only company admins can access drivers
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can access drivers",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    const { page = 1, limit = 20, status, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {
      companyId: user.companyId,
      role: "driver",
    };

    if (status === "active") {
      query.isActive = true;
    } else if (status === "inactive") {
      query.isActive = false;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const [drivers, total] = await Promise.all([
      User.find(query)
        .select("-password -refreshToken")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 }),
      User.countDocuments(query),
    ]);

    // Get driver profiles
    const driversWithProfiles = await Promise.all(
      drivers.map(async (driver) => {
        const driverProfile = await Driver.findOne({
          userId: driver._id,
          companyId: user.companyId,
        }).select("licenseNumber vehicleType plateNumber isOnline isAvailable approvalStatus");

        return {
          ...driver.toObject(),
          driverProfile,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: driversWithProfiles,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get company drivers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company drivers",
    });
  }
};

/**
 * @desc    Get company statistics
 * @route   GET /api/company/stats
 * @access  Private (Company Admin)
 */
export const getCompanyStats = async (req, res) => {
  try {
    const user = req.user;

    // Only company admins can access stats
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can access statistics",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    const company = await Company.findById(user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Calculate statistics (you'll need to implement these based on your models)
    const stats = {
      totalDrivers: await User.countDocuments({
        companyId: user.companyId,
        role: "driver",
        isActive: true,
      }),
      onlineDrivers: await User.countDocuments({
        companyId: user.companyId,
        role: "driver",
        isActive: true,
        // Add your online status logic here
      }),
      totalDeliveries: 0, // Implement based on your Delivery model
      completedDeliveries: 0, // Implement based on your Delivery model
      pendingDeliveries: 0, // Implement based on your Delivery model
      totalEarnings: 0, // Implement based on your Delivery model
      thisMonthEarnings: 0, // Implement based on your Delivery model
      documentStatus: {
        total: company.onboardingDocs?.length || 0,
        verified: company.onboardingDocs?.filter((doc) => doc.verified).length || 0,
      },
    };

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Get company stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get company statistics",
    });
  }
};

/**
 * @desc    Request company verification
 * @route   POST /api/company/request-verification
 * @access  Private (Company Admin)
 */
export const requestCompanyVerification = async (req, res) => {
  try {
    const user = req.user;

    // Only company admins can request verification
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can request verification",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    const company = await Company.findById(user.companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Check if company already has a pending verification request
    if (company.verificationStatus === "pending") {
      return res.status(400).json({
        success: false,
        message: "Verification request already pending",
      });
    }

    // Check if company is already verified
    if (company.verificationStatus === "verified") {
      return res.status(400).json({
        success: false,
        message: "Company is already verified",
      });
    }

    // Check if required documents are uploaded
    const requiredDocs = company.onboardingDocs?.filter(
      (doc) => doc.verified
    ).length;

    if (!requiredDocs || requiredDocs < 3) {
      return res.status(400).json({
        success: false,
        message: "Please upload and verify at least 3 required documents",
      });
    }

    // Update verification status
    company.verificationStatus = "pending";
    company.verificationRequestedAt = new Date();
    await company.save();

    // TODO: Send notification to admin for review

    res.status(200).json({
      success: true,
      message: "Verification request submitted successfully",
      data: {
        verificationStatus: company.verificationStatus,
        verificationRequestedAt: company.verificationRequestedAt,
      },
    });
  } catch (error) {
    console.error("❌ Request company verification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit verification request",
    });
  }
};

/**
 * @desc    Get company notifications
 * @route   GET /api/company/notifications
 * @access  Private (Company Admin)
 */
// In company.controller.js, update the getCompanyNotifications function:

/**
 * @desc    Get company notifications
 * @route   GET /api/company/notifications
 * @access  Private (Company Admin)
 */
/**
 * @desc    Get company notifications
 * @route   GET /api/company/notifications
 * @access  Private (Company Admin)
 */
export const getCompanyNotifications = async (req, res) => {
  try {
    const user = req.user;

    // Only company admins can access notifications
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company administrators can access notifications",
      });
    }

    if (!user.companyId) {
      return res.status(404).json({
        success: false,
        message: "Company not found for this user",
      });
    }

    const { page = 1, limit = 20, unreadOnly = false, type } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query for company notifications
    const query = {
      $or: [
        // Direct company notifications to this user
        { userId: user._id, type: 'company' },
        // Company-wide notifications
        { 'data.companyId': user.companyId, type: 'company' },
        // If companyId is stored differently
        { type: 'company', 'metadata.companyId': user.companyId }
      ]
    };

    // Add read filter if requested
    if (unreadOnly === "true") {
      query.read = false;
    }

    // Filter by notification type if specified
    if (type) {
      query.subType = type;
    }

    console.log('Company notification query:', JSON.stringify(query, null, 2)); // Debug log

    // Get notifications from database
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ ...query, read: false })
    ]);

    // Format response
    const formattedNotifications = notifications.map(notification => ({
      id: notification._id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      subType: notification.subType,
      read: notification.read,
      priority: notification.priority,
      actionUrl: notification.actionUrl,
      actionLabel: notification.actionLabel,
      createdAt: notification.createdAt,
      timeAgo: notification.timeAgo, // Virtual field from your model
      data: notification.data || {}
    }));

    res.status(200).json({
      success: true,
      data: {
        notifications: formattedNotifications,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
        unreadCount,
      },
    });
  } catch (error) {
    console.error("❌ Get company notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get notifications",
      error: error.message  
    });
  }
};

export default {
  getCompanyProfile,
  updateCompanyProfile,
  updateCompanySettings,
  uploadCompanyDocument,
  getCompanyDrivers,
  getCompanyStats,
  requestCompanyVerification,
  getCompanyNotifications,
};// controllers/notification.controller.js

 