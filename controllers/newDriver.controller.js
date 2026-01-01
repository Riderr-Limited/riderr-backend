import Driver from "../models/riders.models.js";
import User from "../models/user.models.js";
import Delivery from "../models/delivery.models.js";

// ========== DRIVER REGISTRATION & ONBOARDING ==========

// Register new driver
export const registerDriver = async (req, res) => {
  try {
    const {
      userId,
      companyId,
      licenseNumber,
      licenseExpiry,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      emergencyContact,
      bankDetails
    } = req.body;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if driver already exists
    const existingDriver = await Driver.findOne({ userId });
    if (existingDriver) {
      return res.status(400).json({ success: false, message: 'Driver already registered' });
    }

    // Check for duplicate license or plate number
    const duplicateCheck = await Driver.findOne({
      $or: [{ licenseNumber }, { plateNumber }]
    });
    if (duplicateCheck) {
      return res.status(400).json({ 
        success: false, 
        message: 'License number or plate number already exists' 
      });
    }

    // Create driver
    const driver = new Driver({
      userId,
      companyId,
      licenseNumber,
      licenseExpiry,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      plateNumber,
      emergencyContact,
      bankDetails,
      approvalStatus: 'pending'
    });

    await driver.save();

    res.status(201).json({
      success: true,
      message: 'Driver registered successfully. Pending approval.',
      data: driver
    });
  } catch (error) {
    console.error('Register driver error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Upload driver documents
export const uploadDocument = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { type, url, expiryDate } = req.body;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    // Check if document type already exists
    const existingDocIndex = driver.documents.findIndex(doc => doc.type === type);
    
    if (existingDocIndex > -1) {
      // Update existing document
      driver.documents[existingDocIndex] = {
        type,
        url,
        uploadedAt: new Date(),
        expiryDate,
        verified: false
      };
    } else {
      // Add new document
      driver.documents.push({
        type,
        url,
        uploadedAt: new Date(),
        expiryDate,
        verified: false
      });
    }

    await driver.save();

    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: driver
    });
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DRIVER APPROVAL & VERIFICATION ==========

// Approve driver (Admin/Company)
export const approveDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { approvedBy } = req.body; // Admin/Company user ID

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    // Check if all required documents are uploaded and verified
    if (!driver.isDocumentsComplete) {
      return res.status(400).json({ 
        success: false, 
        message: 'Driver has not uploaded all required documents' 
      });
    }

    if (!driver.isDocumentsVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'All documents must be verified before approval' 
      });
    }

    driver.approvalStatus = 'approved';
    driver.isVerified = true;
    driver.approvedBy = approvedBy;
    driver.approvedAt = new Date();

    await driver.save();

    res.status(200).json({
      success: true,
      message: 'Driver approved successfully',
      data: driver
    });
  } catch (error) {
    console.error('Approve driver error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verify document
export const verifyDocument = async (req, res) => {
  try {
    const { driverId, documentId } = req.params;
    const { verified, verifiedBy, rejectionReason } = req.body;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const document = driver.documents.id(documentId);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    document.verified = verified;
    document.verifiedBy = verifiedBy;
    document.verifiedAt = new Date();
    
    if (!verified && rejectionReason) {
      document.rejectionReason = rejectionReason;
    }

    await driver.save();

    res.status(200).json({
      success: true,
      message: verified ? 'Document verified successfully' : 'Document rejected',
      data: driver
    });
  } catch (error) {
    console.error('Verify document error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DRIVER STATUS & LOCATION ==========

// Update driver location
export const updateLocation = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { latitude, longitude, address } = req.body;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    await driver.updateLocation(latitude, longitude, address);

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        location: driver.location,
        lastLocationUpdate: driver.lastLocationUpdate
      }
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Go online
export const goOnline = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    await driver.goOnline();

    res.status(200).json({
      success: true,
      message: 'Driver is now online',
      data: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        currentStatus: driver.currentStatus
      }
    });
  } catch (error) {
    console.error('Go online error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Go offline
export const goOffline = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    await driver.goOffline();

    res.status(200).json({
      success: true,
      message: 'Driver is now offline',
      data: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        currentStatus: driver.currentStatus
      }
    });
  } catch (error) {
    console.error('Go offline error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ========== DRIVER QUERIES ==========

// Get driver profile
export const getDriverProfile = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId)
      .populate('userId', 'name email phone profilePhoto')
      .populate('companyId', 'name logo');

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    res.status(200).json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Get driver profile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get available drivers near location
export const getNearbyDrivers = async (req, res) => {
  try {
    const { longitude, latitude, vehicleType, maxDistance = 5000 } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Longitude and latitude are required' 
      });
    }

    const drivers = await Driver.findNearby(
      parseFloat(longitude),
      parseFloat(latitude),
      parseInt(maxDistance),
      vehicleType
    );

    res.status(200).json({
      success: true,
      count: drivers.length,
      data: drivers
    });
  } catch (error) {
    console.error('Get nearby drivers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get driver statistics
export const getDriverStats = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        stats: driver.stats,
        rating: driver.rating,
        completionRate: driver.completionRate,
        canAcceptRides: driver.canAcceptRides
      }
    });
  } catch (error) {
    console.error('Get driver stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get drivers by company
export const getCompanyDrivers = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { status, isOnline, approvalStatus } = req.query;

    const filters = {};
    if (status) filters.currentStatus = status;
    if (isOnline !== undefined) filters.isOnline = isOnline === 'true';
    if (approvalStatus) filters.approvalStatus = approvalStatus;

    const drivers = await Driver.findByCompany(companyId, filters);

    res.status(200).json({
      success: true,
      count: drivers.length,
      data: drivers
    });
  } catch (error) {
    console.error('Get company drivers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get pending approval drivers
export const getPendingDrivers = async (req, res) => {
  try {
    const { companyId } = req.query;

    const drivers = await Driver.findPendingApproval(companyId);

    res.status(200).json({
      success: true,
      count: drivers.length,
      data: drivers
    });
  } catch (error) {
    console.error('Get pending drivers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DRIVER MANAGEMENT ==========

// Update driver profile
export const updateDriverProfile = async (req, res) => {
  try {
    const { driverId } = req.params;
    const updates = req.body;

    // Prevent updating sensitive fields
    delete updates.userId;
    delete updates.companyId;
    delete updates.rating;
    delete updates.stats;
    delete updates.approvalStatus;

    const driver = await Driver.findByIdAndUpdate(
      driverId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Driver profile updated successfully',
      data: driver
    });
  } catch (error) {
    console.error('Update driver profile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Suspend driver
export const suspendDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason, suspendedUntil } = req.body;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    driver.isSuspended = true;
    driver.suspensionReason = reason;
    driver.suspendedAt = new Date();
    driver.suspendedUntil = suspendedUntil;
    driver.isOnline = false;
    driver.isAvailable = false;

    await driver.save();

    res.status(200).json({
      success: true,
      message: 'Driver suspended successfully',
      data: driver
    });
  } catch (error) {
    console.error('Suspend driver error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get driver's delivery history
export const getDriverDeliveries = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status, limit = 50 } = req.query;

    const query = { driverId };
    if (status) query.status = status;

    const deliveries = await Delivery.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('customerId', 'name phone');

    res.status(200).json({
      success: true,
      count: deliveries.length,
      data: deliveries
    });
  } catch (error) {
    console.error('Get driver deliveries error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};