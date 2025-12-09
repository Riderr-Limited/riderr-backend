import Company from "../models/company.models.js";
import User from "../models/user.models.js";
import mongoose from "mongoose";

/**
 * Get all pending company registrations (Admin only)
 */
export const getPendingCompanies = async (req, res) => {
  try {
    const admin = req.user;
    
    if (admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admins can view pending companies"
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [companies, total] = await Promise.all([
      Company.find({ status: "pending" })
        .populate("registeredBy", "name email phone")
        .skip(skip)
        .limit(limit)
        .sort({ registrationDate: -1 }),
      Company.countDocuments({ status: "pending" })
    ]);

    res.status(200).json({
      success: true,
      message: "Pending companies fetched successfully",
      data: companies,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

/**
 * Approve company registration (Admin only)
 */
export const approveCompany = async (req, res) => {
  try {
    const admin = req.user;
    
    if (admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admins can approve companies"
      });
    }

    const { companyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company ID"
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update company status
      const company = await Company.findByIdAndUpdate(
        companyId,
        { 
          status: "active",
          $unset: { rejectionReason: 1 } // Remove rejection reason if exists
        },
        { new: true, session }
      ).populate("registeredBy", "name email phone");

      if (!company) {
        const error = new Error("Company not found");
        error.statusCode = 404;
        throw error;
      }

      // Verify and activate the company admin user
      await User.findOneAndUpdate(
        { companyId: company._id, role: "company_admin" },
        { isVerified: true, isActive: true },
        { session }
      );

      await session.commitTransaction();

      res.status(200).json({
        success: true,
        message: "Company approved successfully",
        data: company
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * Reject company registration (Admin only)
 */
export const rejectCompany = async (req, res) => {
  try {
    const admin = req.user;
    
    if (admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only admins can reject companies"
      });
    }

    const { companyId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company ID"
      });
    }

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason must be at least 10 characters"
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update company status with rejection reason
      const company = await Company.findByIdAndUpdate(
        companyId,
        { 
          status: "rejected",
          rejectionReason: reason.trim()
        },
        { new: true, session }
      ).populate("registeredBy", "name email phone");

      if (!company) {
        const error = new Error("Company not found");
        error.statusCode = 404;
        throw error;
      }

      // Deactivate the company admin user
      await User.findOneAndUpdate(
        { companyId: company._id, role: "company_admin" },
        { isActive: false },
        { session }
      );

      await session.commitTransaction();

      res.status(200).json({
        success: true,
        message: "Company rejected successfully",
        data: company
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};

/**
 * Get company registration status (for registered company)
 */
export const getRegistrationStatus = async (req, res) => {
  try {
    const user = req.user;
    
    if (user.role !== "company_admin") {
      return res.status(403).json({
        success: false,
        message: "Only company admins can check registration status"
      });
    }

    const company = await Company.findById(user.companyId)
      .select("name status rejectionReason createdAt");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Registration status fetched successfully",
      data: {
        companyName: company.name,
        status: company.status,
        rejectionReason: company.rejectionReason,
        registeredDate: company.createdAt,
        nextSteps: company.status === "pending" 
          ? "Your registration is under review. You'll be notified once approved."
          : company.status === "active"
          ? "Your company is active. You can now add riders and start operations."
          : "Your registration was rejected. Please contact support for more information."
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};