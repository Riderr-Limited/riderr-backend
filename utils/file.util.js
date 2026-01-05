// utils/file.util.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * File Utility Functions
 */

/**
 * Get absolute path from relative path
 */
export const getAbsolutePath = (relativePath) => {
  return path.join(__dirname, '..', relativePath);
};

/**
 * Check if file exists
 */
export const fileExists = (filePath) => {
  return fs.existsSync(getAbsolutePath(filePath));
};

/**
 * Delete file if exists
 */
export const deleteFileIfExists = (filePath) => {
  const absolutePath = getAbsolutePath(filePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
    return true;
  }
  return false;
};

/**
 * Move file to new location
 */
export const moveFile = (oldPath, newPath) => {
  const oldAbsolute = getAbsolutePath(oldPath);
  const newAbsolute = getAbsolutePath(newPath);
  
  // Create directory if it doesn't exist
  const newDir = path.dirname(newAbsolute);
  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true });
  }
  
  fs.renameSync(oldAbsolute, newAbsolute);
  return newPath;
};

/**
 * Copy file to new location
 */
export const copyFile = (sourcePath, destPath) => {
  const sourceAbsolute = getAbsolutePath(sourcePath);
  const destAbsolute = getAbsolutePath(destPath);
  
  // Create directory if it doesn't exist
  const destDir = path.dirname(destAbsolute);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  fs.copyFileSync(sourceAbsolute, destAbsolute);
  return destPath;
};

/**
 * Get file information
 */
export const getFileInfo = (filePath) => {
  const absolutePath = getAbsolutePath(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  
  const stats = fs.statSync(absolutePath);
  const ext = path.extname(filePath).toLowerCase();
  
  return {
    path: filePath,
    absolutePath,
    filename: path.basename(filePath),
    extension: ext,
    size: stats.size,
    sizeFormatted: formatFileSize(stats.size),
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
    isImage: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext),
    isDocument: ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx'].includes(ext)
  };
};

/**
 * Format file size
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Create directory if it doesn't exist
 */
export const ensureDirectoryExists = (dirPath) => {
  const absolutePath = getAbsolutePath(dirPath);
  
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }
  
  return absolutePath;
};

/**
 * List files in directory
 */
export const listFilesInDirectory = (dirPath, options = {}) => {
  const absolutePath = getAbsolutePath(dirPath);
  
  if (!fs.existsSync(absolutePath)) {
    return [];
  }
  
  const files = fs.readdirSync(absolutePath);
  
  if (options.withInfo) {
    return files.map(filename => {
      const filePath = path.join(dirPath, filename);
      return getFileInfo(filePath);
    }).filter(Boolean);
  }
  
  return files;
};

/**
 * Generate unique filename
 */
export const generateUniqueFilename = (originalName, prefix = '') => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext).replace(/\s+/g, '_');
  
  if (prefix) {
    return `${prefix}_${name}_${timestamp}_${random}${ext}`;
  }
  
  return `${name}_${timestamp}_${random}${ext}`;
};

/**
 * Validate file path is within uploads directory
 */
export const isSafePath = (filePath) => {
  const absolutePath = path.resolve(getAbsolutePath(filePath));
  const uploadsPath = path.resolve(getAbsolutePath('uploads'));
  
  return absolutePath.startsWith(uploadsPath);
};

/**
 * Get file URL for client access
 */
export const getPublicFileUrl = (req, filePath) => {
  if (!filePath || !isSafePath(filePath)) {
    return null;
  }
  
  // Remove 'uploads/' prefix
  const relativePath = filePath.replace(/^uploads[\\/]/, '');
  
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${relativePath}`;
};

export default {
  getAbsolutePath,
  fileExists,
  deleteFileIfExists,
  moveFile,
  copyFile,
  getFileInfo,
  formatFileSize,
  ensureDirectoryExists,
  listFilesInDirectory,
  generateUniqueFilename,
  isSafePath,
  getPublicFileUrl
};