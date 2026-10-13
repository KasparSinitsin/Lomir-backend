const { CONTACT_ERROR_CODES } = require("../config/contactErrors");
// Contact form attachment rules - keep in sync with the frontend hardening in
// Lomir-frontend/src/pages/Contact.jsx. These are the server-side enforcement
// of the same limits so the rules cannot be bypassed by skipping the UI.

const MEGABYTE = 1024 * 1024;

const CONTACT_ATTACHMENT_LIMITS = {
  maxFiles: 3,
  maxBytesPerFile: 5 * MEGABYTE,
  maxTotalBytes: 10 * MEGABYTE,
};

const CONTACT_ATTACHMENT_MAX_MB = CONTACT_ATTACHMENT_LIMITS.maxBytesPerFile / MEGABYTE;
const CONTACT_ATTACHMENT_TOTAL_MAX_MB = CONTACT_ATTACHMENT_LIMITS.maxTotalBytes / MEGABYTE;

const CONTACT_ALLOWED_LABEL = "JPG, PNG, WebP, PDF, TXT, CSV";

const CONTACT_ALLOWED_FILE_TYPES = [
  {
    extensions: [".jpg", ".jpeg"],
    mimeTypes: ["image/jpeg", "image/pjpeg"],
  },
  {
    extensions: [".png"],
    mimeTypes: ["image/png", "image/x-png"],
  },
  {
    extensions: [".webp"],
    mimeTypes: ["image/webp"],
  },
  {
    extensions: [".pdf"],
    mimeTypes: ["application/pdf", "application/x-pdf"],
  },
  {
    extensions: [".txt"],
    mimeTypes: ["text/plain"],
  },
  {
    extensions: [".csv"],
    mimeTypes: [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "text/plain",
    ],
  },
];

const CONTACT_ALLOWED_BY_EXTENSION = CONTACT_ALLOWED_FILE_TYPES.reduce(
  (map, fileType) => {
    fileType.extensions.forEach((extension) => {
      map.set(extension, new Set(fileType.mimeTypes));
    });
    return map;
  },
  new Map(),
);

const getFileExtension = (fileName = "") => {
  const match = fileName.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
};

const hasUnsafeFileName = (fileName = "") => {
  const trimmedFileName = fileName.trim();

  return (
    !trimmedFileName ||
    fileName.length > 120 ||
    trimmedFileName.startsWith(".") ||
    /[\u0000-\u001f\u007f/\\]/.test(fileName)
  );
};

const isAllowedAttachmentType = (fileName, mimeType) => {
  const extension = getFileExtension(fileName);
  const allowedMimeTypes = CONTACT_ALLOWED_BY_EXTENSION.get(extension);

  if (!allowedMimeTypes) {
    return false;
  }

  const normalizedMimeType = (mimeType || "").toLowerCase();
  return !normalizedMimeType || allowedMimeTypes.has(normalizedMimeType);
};

/**
 * Per-file validation used by the multer fileFilter (name + type only - the
 * file size is not yet known at the fileFilter stage).
 * @param {{ originalname: string, mimetype: string }} file
 * @returns {string} empty string when valid, otherwise an error message
 */
const validateContactAttachmentFile = (file) => {
  if (hasUnsafeFileName(file.originalname)) {
    return "File name is not supported.";
  }

  if (!isAllowedAttachmentType(file.originalname, file.mimetype)) {
    return `File type not supported. Accepted: ${CONTACT_ALLOWED_LABEL}.`;
  }

  return "";
};

/**
 * The same check, as a code. Kept beside the message-returning version rather
 * than replacing it: multer's `fileFilter` can only reject with an Error, so
 * that path still needs a sentence. The controller path uses this.
 */
const getContactAttachmentFileErrorCode = (file) => {
  if (hasUnsafeFileName(file.originalname)) {
    return CONTACT_ERROR_CODES.ATTACHMENT_NAME_UNSUPPORTED;
  }

  if (!isAllowedAttachmentType(file.originalname, file.mimetype)) {
    return CONTACT_ERROR_CODES.ATTACHMENT_TYPE_UNSUPPORTED;
  }

  return "";
};

/**
 * Full validation of the uploaded files, run in the controller after multer
 * has parsed the request. Enforces count, per-file size, empty files and the
 * combined total size that multer cannot check on its own.
 * @param {Array<{ originalname: string, mimetype: string, size: number }>} files
 * @returns {{ valid: boolean, error?: string }}
 */
const validateContactAttachments = (files = []) => {
  if (!files || files.length === 0) {
    return { valid: true };
  }

  if (files.length > CONTACT_ATTACHMENT_LIMITS.maxFiles) {
    return {
      valid: false,
      code: CONTACT_ERROR_CODES.ATTACHMENT_TOO_MANY,
      error: `You can attach up to ${CONTACT_ATTACHMENT_LIMITS.maxFiles} files.`,
    };
  }

  let totalBytes = 0;

  for (const file of files) {
    const fileError = validateContactAttachmentFile(file);
    if (fileError) {
      return {
        valid: false,
        code: getContactAttachmentFileErrorCode(file),
        values: { fileName: file.originalname },
        error: `${file.originalname}: ${fileError}`,
      };
    }

    if (!file.size || file.size <= 0) {
      return {
        valid: false,
        code: CONTACT_ERROR_CODES.ATTACHMENT_EMPTY,
        values: { fileName: file.originalname },
        error: `${file.originalname}: File is empty and cannot be attached.`,
      };
    }

    if (file.size > CONTACT_ATTACHMENT_LIMITS.maxBytesPerFile) {
      return {
        valid: false,
        code: CONTACT_ERROR_CODES.ATTACHMENT_TOO_LARGE,
        values: { fileName: file.originalname },
        error: `${file.originalname}: Each file must be ${CONTACT_ATTACHMENT_MAX_MB} MB or smaller.`,
      };
    }

    totalBytes += file.size;
  }

  if (totalBytes > CONTACT_ATTACHMENT_LIMITS.maxTotalBytes) {
    return {
      valid: false,
      code: CONTACT_ERROR_CODES.ATTACHMENT_TOTAL_TOO_LARGE,
      error: `Attachments must be ${CONTACT_ATTACHMENT_TOTAL_MAX_MB} MB total or smaller.`,
    };
  }

  return { valid: true };
};

module.exports = {
  getContactAttachmentFileErrorCode,
  CONTACT_ATTACHMENT_LIMITS,
  CONTACT_ATTACHMENT_MAX_MB,
  CONTACT_ATTACHMENT_TOTAL_MAX_MB,
  CONTACT_ALLOWED_LABEL,
  validateContactAttachmentFile,
  validateContactAttachments,
};
