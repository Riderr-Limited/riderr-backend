// config/upload.config.js
export const UPLOAD_CONFIG = {
  // Allowed MIME types
  MIME_TYPES: {
    IMAGES: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ],
    DOCUMENTS: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    ALL: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]
  },
  
  // File size limits (in bytes)
  SIZE_LIMITS: {
    PROFILE_IMAGE: 2 * 1024 * 1024, // 2MB
    VEHICLE_PHOTO: 5 * 1024 * 1024, // 5MB
    DOCUMENT: 10 * 1024 * 1024, // 10MB
    LOGO: 1 * 1024 * 1024, // 1MB
    GENERAL: 5 * 1024 * 1024 // 5MB
  },
  
  // Upload directories
  DIRECTORIES: {
    PROFILES: 'uploads/profiles',
    DRIVERS: 'uploads/drivers',
    COMPANIES: 'uploads/companies',
    VEHICLES: 'uploads/vehicles',
    DOCUMENTS: 'uploads/documents',
    LOGOS: 'uploads/logos',
    GENERAL: 'uploads/general'
  },
  
  // File naming
  FILENAME_PREFIXES: {
    PROFILE: 'profile',
    LICENSE: 'license',
    VEHICLE: 'vehicle',
    COMPANY: 'company',
    DOCUMENT: 'doc'
  }
};

// File type validation function
export const isAllowedFileType = (file, category = 'ALL') => {
  const allowedTypes = UPLOAD_CONFIG.MIME_TYPES[category.toUpperCase()] || UPLOAD_CONFIG.MIME_TYPES.ALL;
  return allowedTypes.includes(file.mimetype);
};

// File size validation function
export const isAllowedFileSize = (file, limitType = 'GENERAL') => {
  const limit = UPLOAD_CONFIG.SIZE_LIMITS[limitType.toUpperCase()] || UPLOAD_CONFIG.SIZE_LIMITS.GENERAL;
  return file.size <= limit;
};

// Get file category based on field name
export const getFileCategory = (fieldName) => {
  const field = fieldName.toLowerCase();
  
  if (field.includes('profile') || field.includes('avatar')) {
    return 'PROFILE_IMAGE';
  } else if (field.includes('license')) {
    return 'DOCUMENT';
  } else if (field.includes('vehicle')) {
    return 'VEHICLE_PHOTO';
  } else if (field.includes('logo')) {
    return 'LOGO';
  } else if (field.includes('document')) {
    return 'DOCUMENT';
  }
  
  return 'GENERAL';
};