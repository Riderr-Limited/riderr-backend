// middleware/validation.middleware.js
import { body, param, query, validationResult } from "express-validator";

// Middleware to handle validation errors
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  
  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

  return res.status(422).json({
    success: false,
    message: "Validation failed",
    errors: extractedErrors
  });
};

// ==================== AUTH VALIDATION ====================

// Signup validation
export const validateSignup = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
    .withMessage("Please provide a valid Nigerian phone number (e.g., 08012345678)"),
  
  body("password")
    .trim()
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  
  body("role")
    .optional()
    .isIn(["customer", "company_admin", "driver", "admin"])
    .withMessage("Role must be customer, company_admin, driver, or admin"),
  
  // Company admin specific validation
  body("companyName")
    .if(body("role").equals("company_admin"))
    .trim()
    .notEmpty()
    .withMessage("Company name is required for company admin"),
  
  body("businessLicense")
    .if(body("role").equals("company_admin"))
    .trim()
    .notEmpty()
    .withMessage("Business license is required for company admin"),
  
  // Driver specific validation
  body("companyId")
    .if(body("role").equals("driver"))
    .notEmpty()
    .withMessage("Company ID is required for driver registration")
    .isMongoId()
    .withMessage("Invalid company ID format"),
  
  body("licenseNumber")
    .if(body("role").equals("driver"))
    .trim()
    .notEmpty()
    .withMessage("License number is required for driver"),
  
  body("vehicleType")
    .if(body("role").equals("driver"))
    .notEmpty()
    .withMessage("Vehicle type is required for driver")
    .isIn(["bike", "car", "van", "truck"])
    .withMessage("Vehicle type must be bike, car, van, or truck"),
  
  body("plateNumber")
    .if(body("role").equals("driver"))
    .trim()
    .notEmpty()
    .withMessage("Plate number is required for driver"),
  
  validate
];

// Login validation
export const validateLogin = [
  body("email").optional().trim().isEmail().withMessage("Please provide a valid email"),
  body("phone").optional().trim(),
  body("emailOrPhone").optional().trim(),
  body("password").trim().notEmpty().withMessage("Password is required"),
  
  (req, res, next) => {
    const { email, phone, emailOrPhone } = req.body;
    
    if (!email && !phone && !emailOrPhone) {
      return res.status(400).json({
        success: false,
        message: "Email, phone, or emailOrPhone is required"
      });
    }
    
    next();
  },
  validate
];

// Verify email validation
export const validateVerifyEmail = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  body("token")
    .trim()
    .notEmpty()
    .withMessage("Verification code is required")
    .isLength({ min: 6, max: 6 })
    .withMessage("Verification code must be 6 digits"),
  
  validate
];

// Forgot password validation
export const validateForgotPassword = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  validate
];

// Reset password validation
export const validateResetPassword = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  body("otp")
    .trim()
    .notEmpty()
    .withMessage("OTP is required")
    .isLength({ min: 6, max: 6 })
    .withMessage("OTP must be 6 digits"),
  
  body("newPassword")
    .trim()
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  
  validate
];

// Change password validation
export const validateChangePassword = [
  body("currentPassword")
    .trim()
    .notEmpty()
    .withMessage("Current password is required"),
  
  body("newPassword")
    .trim()
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters")
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) {
        throw new Error("New password must be different from current password");
      }
      return true;
    }),
  
  validate
];

// Resend verification validation
export const validateResendVerification = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  validate
];

// Refresh token validation
export const validateRefreshToken = [
  body("refreshToken")
    .trim()
    .notEmpty()
    .withMessage("Refresh token is required"),
  
  validate
];

// ==================== USER VALIDATION ====================

// Update profile validation
export const validateUpdateProfile = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  
  body("phone")
    .optional()
    .trim()
    .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
    .withMessage("Please provide a valid Nigerian phone number"),
  
  body("avatarUrl")
    .optional()
    .isURL()
    .withMessage("Please provide a valid URL for avatar"),
  
  body("gender")
    .optional()
    .isIn(["male", "female", "other"])
    .withMessage("Gender must be male, female, or other"),
  
  body("dateOfBirth")
    .optional()
    .isISO8601()
    .toDate()
    .withMessage("Please provide a valid date"),
  
  body("address").optional().trim(),
  body("city").optional().trim(),
  body("state").optional().trim(),
  body("country").optional().trim(),
  body("postalCode").optional().trim(),
  
  validate
];

// Create driver validation (for company admin)
export const validateCreateDriver = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
    .withMessage("Please provide a valid Nigerian phone number"),
  
  body("email")
    .optional()
    .trim()
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  body("password")
    .trim()
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  
  body("licenseNumber")
    .trim()
    .notEmpty()
    .withMessage("License number is required")
    .matches(/^[A-Z0-9]+$/)
    .withMessage("License number must contain only uppercase letters and numbers"),
  
  body("licenseExpiry")
    .notEmpty()
    .withMessage("License expiry date is required")
    .isISO8601()
    .toDate()
    .withMessage("Please provide a valid date"),
  
  body("vehicleType")
    .notEmpty()
    .withMessage("Vehicle type is required")
    .isIn(["bike", "car", "van", "truck"])
    .withMessage("Vehicle type must be bike, car, van, or truck"),
  
  body("plateNumber")
    .trim()
    .notEmpty()
    .withMessage("Plate number is required")
    .matches(/^[A-Z0-9-]+$/)
    .withMessage("Plate number must contain only uppercase letters, numbers, and hyphens"),
  
  body("vehicleMake").optional().trim(),
  body("vehicleModel").optional().trim(),
  body("vehicleYear")
    .optional()
    .isInt({ min: 1900, max: new Date().getFullYear() + 1 })
    .withMessage(`Vehicle year must be between 1900 and ${new Date().getFullYear() + 1}`),
  body("vehicleColor").optional().trim(),
  
  validate
];

// Update driver status validation
export const validateUpdateDriverStatus = [
  body("approvalStatus")
    .optional()
    .isIn(["pending", "approved", "rejected", "suspended"])
    .withMessage("Invalid approval status"),
  
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),
  
  body("notes").optional().trim(),
  
  validate
];

// Update user validation (for admin)
export const validateUpdateUser = [
  param("userId")
    .isMongoId()
    .withMessage("Invalid user ID format"),
  
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),
  
  body("isVerified")
    .optional()
    .isBoolean()
    .withMessage("isVerified must be a boolean"),
  
  body("role")
    .optional()
    .isIn(["customer", "company_admin", "driver", "admin"])
    .withMessage("Invalid role"),
  
  body("companyId")
    .optional()
    .isMongoId()
    .withMessage("Invalid company ID format"),
  
  validate
];

// ==================== QUERY PARAM VALIDATION ====================

// Pagination validation
export const validatePagination = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer")
    .toInt(),
  
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
  
  query("sortBy")
    .optional()
    .trim()
    .isIn(["createdAt", "updatedAt", "name", "email", "role", "fare.totalFare", "estimatedDistanceKm"])
    .withMessage("Invalid sort field"),
  
  query("sortOrder")
    .optional()
    .trim()
    .isIn(["asc", "desc"])
    .withMessage("Sort order must be asc or desc"),
  
  validate
];

// ID parameter validation
export const validateIdParam = [
  param("userId")
    .optional()
    .isMongoId()
    .withMessage("Invalid user ID format"),
  
  param("companyId")
    .optional()
    .isMongoId()
    .withMessage("Invalid company ID format"),
  
  param("driverId")
    .optional()
    .isMongoId()
    .withMessage("Invalid driver ID format"),
  
  param("notificationId")
    .optional()
    .isMongoId()
    .withMessage("Invalid notification ID format"),
  
  param("deliveryId")
    .optional()
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  validate
];

// Notification query validation
export const validateNotificationQuery = [
  query("unreadOnly")
    .optional()
    .isIn(["true", "false"])
    .withMessage("unreadOnly must be true or false"),
  
  query("type")
    .optional()
    .trim()
    .isIn(["system", "delivery", "payment", "security", "promotion"])
    .withMessage("Invalid notification type"),
  
  validate
];

// Driver query validation
export const validateDriverQuery = [
  query("status")
    .optional()
    .trim()
    .isIn(["active", "inactive", "all"])
    .withMessage("Status must be active, inactive, or all"),
  
  query("approvalStatus")
    .optional()
    .trim()
    .isIn(["pending", "approved", "rejected", "suspended"])
    .withMessage("Invalid approval status"),
  
  query("isOnline")
    .optional()
    .isIn(["true", "false"])
    .withMessage("isOnline must be true or false"),
  
  query("search").optional().trim(),
  
  validate
];

// User query validation (for admin)
export const validateUserQuery = [
  query("role")
    .optional()
    .trim()
    .isIn(["customer", "company_admin", "driver", "admin"])
    .withMessage("Invalid role"),
  
  query("companyId")
    .optional()
    .isMongoId()
    .withMessage("Invalid company ID format"),
  
  query("isVerified")
    .optional()
    .isIn(["true", "false"])
    .withMessage("isVerified must be true or false"),
  
  query("isActive")
    .optional()
    .isIn(["true", "false"])
    .withMessage("isActive must be true or false"),
  
  query("search").optional().trim(),
  
  validate
];

// ==================== DELIVERY VALIDATION ====================

// Create delivery validation (updated to match your controller)
export const validateCreateDelivery = [
  body("pickupAddress")
    .trim()
    .notEmpty()
    .withMessage("Pickup address is required"),
  
  body("pickupLat")
    .notEmpty()
    .withMessage("Pickup latitude is required")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Pickup latitude must be between -90 and 90"),
  
  body("pickupLng")
    .notEmpty()
    .withMessage("Pickup longitude is required")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Pickup longitude must be between -180 and 180"),
  
  body("dropoffAddress")
    .trim()
    .notEmpty()
    .withMessage("Dropoff address is required"),
  
  body("dropoffLat")
    .notEmpty()
    .withMessage("Dropoff latitude is required")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Dropoff latitude must be between -90 and 90"),
  
  body("dropoffLng")
    .notEmpty()
    .withMessage("Dropoff longitude is required")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Dropoff longitude must be between -180 and 180"),
  
  body("pickupName").optional().trim(),
  
  body("pickupPhone")
    .optional()
    .trim()
    .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
    .withMessage("Invalid pickup phone number"),
  
  body("pickupInstructions").optional().trim(),
  
  body("dropoffName").optional().trim(),
  
  body("dropoffPhone")
    .optional()
    .trim()
    .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
    .withMessage("Invalid dropoff phone number"),
  
  body("dropoffInstructions").optional().trim(),
  
  body("itemType")
    .trim()
    .notEmpty()
    .withMessage("Item type is required")
    .isIn(["document", "small_package", "medium_package", "large_package", "fragile", "food", "electronics", "other", "parcel"])
    .withMessage("Invalid item type"),
  
  body("itemDescription").optional().trim(),
  
  body("itemWeight")
    .optional()
    .isFloat({ min: 0.1, max: 50 })
    .withMessage("Item weight must be between 0.1 and 50 kg")
    .toFloat(),
  
  body("itemDimensions").optional().trim(),
  
  body("itemValue")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Item value must be a positive number")
    .toFloat(),
  
  body("isFragile")
    .optional()
    .isBoolean()
    .withMessage("isFragile must be a boolean"),
  
  body("itemImages")
    .optional()
    .isArray()
    .withMessage("Item images must be an array"),
  
  body("paymentMethod")
    .optional()
    .trim()
    .isIn(["cash", "card", "wallet", "bank_transfer"])
    .withMessage("Invalid payment method"),
  
  body("estimatedValue")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Estimated value must be a positive number")
    .toFloat(),
  
  body("specialInstructions").optional().trim(),
  
  body("vehicleType")
    .optional()
    .trim()
    .isIn(["bike", "car", "van", "truck"])
    .withMessage("Invalid vehicle type"),
  
  body("scheduleFor")
    .optional()
    .isISO8601()
    .withMessage("Invalid schedule date format")
    .toDate(),
  
  validate
];

// Update delivery status validation
export const validateUpdateDeliveryStatus = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("status")
    .notEmpty()
    .withMessage("Status is required")
    .isIn([
      "pending",
      "accepted",
      "picked_up",
      "in_transit",
      "arrived",
      "delivered",
      "cancelled",
      "failed"
    ])
    .withMessage("Invalid delivery status"),
  
  body("notes").optional().trim(),
  
  validate
];

// Rate delivery validation
export const validateRateDelivery = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("rating")
    .notEmpty()
    .withMessage("Rating is required")
    .isInt({ min: 1, max: 5 })
    .withMessage("Rating must be between 1 and 5"),
  
  body("review").optional().trim(),
  
  body("tip")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Tip must be a positive number")
    .toFloat(),
  
  validate
];

// Delivery query validation
export const validateDeliveryQuery = [
  query("status")
    .optional()
    .trim()
    .isIn([
      "created",
      "searching",
      "assigned",
      "picked_up",
      "in_transit",
      "delivered",
      "cancelled",
      "failed",
      "all"
    ])
    .withMessage("Invalid delivery status"),
  
  query("vehicleType")
    .optional()
    .trim()
    .isIn(["bike", "car", "van", "truck", "all"])
    .withMessage("Invalid vehicle type"),
  
  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("Invalid start date format"),
  
  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("Invalid end date format"),
  
  query("minFare")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Minimum fare must be a positive number"),
  
  query("maxFare")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Maximum fare must be a positive number"),
  
  query("sortBy")
    .optional()
    .trim()
    .isIn(["createdAt", "updatedAt", "fare.totalFare", "estimatedDistanceKm"])
    .withMessage("Invalid sort field"),
  
  query("sortOrder")
    .optional()
    .trim()
    .isIn(["asc", "desc"])
    .withMessage("Sort order must be asc or desc"),
  
  validate
];

// Update delivery location validation
export const validateUpdateLocation = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("lat")
    .notEmpty()
    .withMessage("Latitude is required")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude must be between -90 and 90"),
  
  body("lng")
    .notEmpty()
    .withMessage("Longitude is required")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude must be between -180 and 180"),
  
  body("accuracy")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Accuracy must be a positive number"),
  
  validate
];

// OTP generation validation
export const validateOTPGeneration = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("type")
    .trim()
    .notEmpty()
    .withMessage("Type is required")
    .isIn(["pickup", "delivery"])
    .withMessage("Type must be 'pickup' or 'delivery'"),
  
  validate
];

// Nearby drivers validation
export const validateNearbyDrivers = [
  query("lat")
    .notEmpty()
    .withMessage("Latitude is required")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude must be between -90 and 90"),
  
  query("lng")
    .notEmpty()
    .withMessage("Longitude is required")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude must be between -180 and 180"),
  
  query("radius")
    .optional()
    .isFloat({ min: 1, max: 50 })
    .withMessage("Radius must be between 1 and 50 km"),
  
  query("vehicleType")
    .optional()
    .trim()
    .isIn(["bike", "car", "van", "truck"])
    .withMessage("Invalid vehicle type"),
  
  validate
];

// Cancel delivery validation
export const validateCancelDelivery = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("reason")
    .trim()
    .notEmpty()
    .withMessage("Cancellation reason is required")
    .isLength({ min: 5, max: 500 })
    .withMessage("Reason must be between 5 and 500 characters"),
  
  validate
];

// Start delivery validation (for OTP verification)
export const validateStartDelivery = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("otp")
    .optional()
    .trim()
    .isLength({ min: 4, max: 6 })
    .withMessage("OTP must be between 4 and 6 digits"),
  
  validate
];

// Complete delivery validation
export const validateCompleteDelivery = [
  param("deliveryId")
    .isMongoId()
    .withMessage("Invalid delivery ID format"),
  
  body("otp")
    .optional()
    .trim()
    .isLength({ min: 4, max: 6 })
    .withMessage("OTP must be between 4 and 6 digits"),
  
  body("recipientName")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Recipient name must be between 2 and 100 characters"),
  
  body("recipientSignature")
    .optional()
    .trim(),
  
  body("deliveryProof.photos")
    .optional()
    .isArray()
    .withMessage("Delivery proof photos must be an array"),
  
  body("deliveryProof.notes")
    .optional()
    .trim(),
  
  validate
];
// Add this to your validation.middleware.js

// Sign up company driver validation
export const validateSignUpCompanyDriver = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Driver name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),
  
  body("password")
    .trim()
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^(\+234|0)[7-9][0-1]\d{8}$/)
    .withMessage("Please provide a valid Nigerian phone number"),
  
  body("licenseNumber")
    .trim()
    .notEmpty()
    .withMessage("License number is required"),
  
  body("licenseExpiry")
    .notEmpty()
    .withMessage("License expiry date is required")
    .isISO8601()
    .toDate()
    .withMessage("Please provide a valid date"),
  
  body("vehicleType")
    .notEmpty()
    .withMessage("Vehicle type is required")
    .isIn(["bike", "car", "van", "truck"])
    .withMessage("Vehicle type must be bike, car, van, or truck"),
  
  body("plateNumber")
    .trim()
    .notEmpty()
    .withMessage("Plate number is required"),
  
  body("vehicleMake").optional().trim(),
  body("vehicleModel").optional().trim(),
  body("vehicleYear").optional().isInt({ min: 1900, max: new Date().getFullYear() + 1 }),
  body("vehicleColor").optional().trim(),
  
  validate
];