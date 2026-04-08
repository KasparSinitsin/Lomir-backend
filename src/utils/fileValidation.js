// Validates file URLs before saving to database

const https = require("https");
const {
  extractImageKitFilename,
  isImageKitUrl,
} = require("./imagekitUtils");

// Centralized file size limits (in bytes) - keep in sync with frontend
const FILE_LIMITS = {
  chatImage: 10 * 1024 * 1024, // 10MB
  chatFile: 25 * 1024 * 1024, // 25MB
  avatar: 5 * 1024 * 1024, // 5MB
  teamAvatar: 5 * 1024 * 1024, // 5MB
};

// Allowed file extensions
const ALLOWED_EXTENSIONS = {
  chatImage: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  chatFile: [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".ppt",
    ".pptx",
    ".txt",
    ".zip",
    ".rar",
  ],
  avatar: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  teamAvatar: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
};

/**
 * Get file size from URL via HEAD request
 * @param {string} url - The file URL
 * @returns {Promise<number|null>} - File size in bytes, or null if unavailable
 */
const getFileSizeFromUrl = (url) => {
  return new Promise((resolve) => {
    try {
      const request = https.request(
        url,
        { method: "HEAD", timeout: 5000 },
        (response) => {
          const contentLength = response.headers["content-length"];
          resolve(contentLength ? parseInt(contentLength, 10) : null);
        },
      );

      request.on("error", (error) => {
        console.warn(
          `[FILE VALIDATION] Could not get file size: ${error.message}`,
        );
        resolve(null);
      });

      request.on("timeout", () => {
        request.destroy();
        console.warn(`[FILE VALIDATION] Timeout getting file size for: ${url}`);
        resolve(null);
      });

      request.end();
    } catch (error) {
      console.warn(`[FILE VALIDATION] Error: ${error.message}`);
      resolve(null);
    }
  });
};

/**
 * Extract file extension from URL
 * @param {string} url - The file URL
 * @returns {string} - File extension (e.g., '.jpg')
 */
const getExtensionFromUrl = (url) => {
  try {
    const urlWithoutParams = url.split("?")[0];
    const extension = "." + urlWithoutParams.split(".").pop().toLowerCase();
    return extension;
  } catch {
    return "";
  }
};

/**
 * Validate an ImageKit URL for chat messages
 * @param {string} url - The ImageKit URL
 * @param {'chatImage' | 'chatFile'} type - Type of upload
 * @returns {Promise<{valid: boolean, error?: string, size?: number, filename?: string}>}
 */
const validateChatFileUrl = async (url, type = "chatImage") => {
  // Must have a URL
  if (!url || typeof url !== "string") {
    return { valid: false, error: "Invalid file URL" };
  }

  // Must be an ImageKit URL
  if (!isImageKitUrl(url)) {
    console.warn(`[FILE VALIDATION] Rejected non-ImageKit URL: ${url}`);
    return { valid: false, error: "Files must be uploaded through Lomir" };
  }

  const filename = extractImageKitFilename(url);

  if (!filename) {
    return { valid: false, error: "Invalid ImageKit file URL" };
  }

  // Check file extension
  const extension = getExtensionFromUrl(url);
  const allowedExtensions = ALLOWED_EXTENSIONS[type];

  if (allowedExtensions && !allowedExtensions.includes(extension)) {
    console.warn(
      `[FILE VALIDATION] Rejected extension ${extension} for type ${type}`,
    );
    return {
      valid: false,
      error: `File type ${extension} not allowed. Accepted: ${allowedExtensions.join(", ")}`,
    };
  }

  // Check file size
  const fileSize = await getFileSizeFromUrl(url);

  // If we can't verify size, allow it but log a warning
  if (fileSize === null) {
    console.warn(`[FILE VALIDATION] Could not verify file size: ${url}`);
    return { valid: true, warning: "Could not verify file size", filename };
  }

  const limit = FILE_LIMITS[type];
  if (fileSize > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    const actualMB = (fileSize / (1024 * 1024)).toFixed(1);
    console.warn(
      `[FILE VALIDATION] Rejected oversized file: ${actualMB}MB > ${limitMB}MB limit`,
    );
    return {
      valid: false,
      error: `File too large (${actualMB}MB). Maximum allowed: ${limitMB}MB`,
      size: fileSize,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[FILE VALIDATION] Accepted ${type}: ${(fileSize / (1024 * 1024)).toFixed(2)}MB`,
    );
  }
  return { valid: true, size: fileSize, filename };
};

module.exports = {
  FILE_LIMITS,
  ALLOWED_EXTENSIONS,
  getFileSizeFromUrl,
  validateChatFileUrl,
  extractImageKitFilename,
};
