// middlewares/upload.middleware.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allowed file types
const ALLOWED_FILE_TYPES = {
  IMAGE: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  DOCUMENT: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
  ALL: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
};

// File size limits (in bytes)
const FILE_SIZE_LIMITS = {
  IMAGE: 5 * 1024 * 1024, // 5MB
  DOCUMENT: 10 * 1024 * 1024, // 10MB
  ALL: 10 * 1024 * 1024 // 10MB
};

// Ensure upload directories exist
const ensureUploadDirectories = () => {
  const directories = [
    'uploads',
    'uploads/images',
    'uploads/documents',
    'uploads/drivers',
    'uploads/companies',
    'uploads/vehicles',
    'uploads/profiles'
  ];

  directories.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
};

// Call this function to create directories
ensureUploadDirectories();

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = 'uploads/';
    
    // Determine upload directory based on file type or route
    if (file.mimetype.startsWith('image/')) {
      // Check route to determine specific directory
      if (req.originalUrl.includes('/driver/documents')) {
        uploadPath = 'uploads/drivers/';
      } else if (req.originalUrl.includes('/company/documents')) {
        uploadPath = 'uploads/companies/';
      } else if (req.originalUrl.includes('/profile')) {
        uploadPath = 'uploads/profiles/';
      } else {
        uploadPath = 'uploads/images/';
      }
    } else if (file.mimetype === 'application/pdf') {
      uploadPath = 'uploads/documents/';
    }
    
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${filename}-${uniqueSuffix}${ext}`);
  }
});

// File filter function
const fileFilter = (allowedTypes, maxSize) => (req, file, cb) => {
  // Check file type
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
  
  // Check file size
  if (file.size > maxSize) {
    return cb(new Error(`File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`), false);
  }
  
  cb(null, true);
};

// Create different upload configurations
const createUpload = (allowedTypes, maxSize, fieldName = null, maxCount = 1) => {
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: maxSize
    },
    fileFilter: fileFilter(allowedTypes, maxSize)
  });
  
  if (fieldName) {
    if (maxCount > 1) {
      return upload.array(fieldName, maxCount);
    }
    return upload.single(fieldName);
  }
  
  return upload;
};

// Specific upload configurations
const uploadImage = createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE);
const uploadDocument = createUpload(ALLOWED_FILE_TYPES.DOCUMENT, FILE_SIZE_LIMITS.DOCUMENT);
const uploadAny = createUpload(ALLOWED_FILE_TYPES.ALL, FILE_SIZE_LIMITS.ALL);

// Custom upload configurations
export const upload = {
  // Single file uploads
  singleImage: createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE, 'image'),
  singleDocument: createUpload(ALLOWED_FILE_TYPES.DOCUMENT, FILE_SIZE_LIMITS.DOCUMENT, 'document'),
  singleFile: createUpload(ALLOWED_FILE_TYPES.ALL, FILE_SIZE_LIMITS.ALL, 'file'),
  
  // Multiple file uploads
  multipleImages: createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE, 'images', 10),
  multipleDocuments: createUpload(ALLOWED_FILE_TYPES.DOCUMENT, FILE_SIZE_LIMITS.DOCUMENT, 'documents', 10),
  multipleFiles: createUpload(ALLOWED_FILE_TYPES.ALL, FILE_SIZE_LIMITS.ALL, 'files', 10),
  
  // Specific field names for common use cases
  profileImage: createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE, 'avatar'),
  driverLicense: createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE, 'licensePhoto'),
  vehiclePhoto: createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE, 'vehiclePhoto'),
  companyLogo: createUpload(ALLOWED_FILE_TYPES.IMAGE, FILE_SIZE_LIMITS.IMAGE, 'logo'),
  
  // Generic upload (no field name specified - use in controller)
  image: uploadImage,
  document: uploadDocument,
  any: uploadAny
};

// File validation middleware
export const validateFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }
  next();
};

export const validateFiles = (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No files uploaded'
    });
  }
  next();
};

// File cleanup middleware (in case of errors)
export const cleanupFiles = (req, res, next) => {
  // Store original send function
  const originalSend = res.send;
  
  // Override send function
  res.send = function(data) {
    // If there's an error and files were uploaded, delete them
    if (res.statusCode >= 400 && req.files) {
      if (Array.isArray(req.files)) {
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      } else if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }
    
    // Call original send function
    originalSend.call(this, data);
  };
  
  next();
};

// File type validation helper
export const isValidFileType = (file, allowedTypes) => {
  return allowedTypes.includes(file.mimetype);
};

// File size validation helper
export const isValidFileSize = (file, maxSize) => {
  return file.size <= maxSize;
};

// Get file extension
export const getFileExtension = (filename) => {
  return path.extname(filename).toLowerCase();
};

// Generate file URL
export const getFileUrl = (req, filePath) => {
  if (!filePath) return null;
  
  // Remove 'uploads/' from path if present
  const relativePath = filePath.replace(/^uploads[\\/]/, '');
  
  // Construct full URL
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${relativePath}`;
};

// Delete file helper
export const deleteFile = (filePath) => {
  return new Promise((resolve, reject) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve(false);
    }
    
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting file:', err);
        return reject(err);
      }
      resolve(true);
    });
  });
};

// Middleware to handle multer errors
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // A Multer error occurred when uploading
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Please upload a smaller file.'
      });
    }
    
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Please upload fewer files.'
      });
    }
    
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field name for file upload.'
      });
    }
    
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  } else if (err) {
    // An unknown error occurred
    return res.status(500).json({
      success: false,
      message: err.message || 'File upload failed'
    });
  }
  
  next();
};

// Compression middleware (for images)
import sharp from 'sharp';
export const compressImage = async (req, res, next) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) {
    return next();
  }
  
  try {
    const originalPath = req.file.path;
    const compressedPath = `${originalPath}.compressed`;
    
    await sharp(originalPath)
      .resize(1200, 1200, { // Max dimensions
        fit: sharp.fit.inside,
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 }) // For JPEG
      .png({ quality: 80 })  // For PNG
      .toFile(compressedPath);
    
    // Replace original with compressed version
    fs.unlinkSync(originalPath);
    fs.renameSync(compressedPath, originalPath);
    
    // Update file size
    const stats = fs.statSync(originalPath);
    req.file.size = stats.size;
    
    next();
  } catch (error) {
    console.error('Image compression error:', error);
    next(); // Continue even if compression fails
  }
};

export default upload;