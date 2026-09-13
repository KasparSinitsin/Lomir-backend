const express = require("express");
const router = express.Router();
const multer = require("multer");
const contactController = require("../controllers/contactController");
const { CONTACT_ERROR_CODES } = require("../config/contactErrors");
const { contactLimiter } = require("../middlewares/rateLimiter");
const {
  CONTACT_ATTACHMENT_LIMITS,
  CONTACT_ATTACHMENT_MAX_MB,
  validateContactAttachmentFile,
  getContactAttachmentFileErrorCode,
} = require("../utils/contactAttachments");

const contactUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CONTACT_ATTACHMENT_LIMITS.maxBytesPerFile,
    files: CONTACT_ATTACHMENT_LIMITS.maxFiles,
  },
  fileFilter: (req, file, cb) => {
    const error = validateContactAttachmentFile(file);
    if (error) {
      // multer's fileFilter can only reject with an Error, so the code rides
      // on the error object. ⚠️ The alternative — re-deriving the code from
      // the message text downstream — is exactly the "English as control flow"
      // defect this change exists to remove, and it was written that way for a
      // few minutes before being caught.
      const rejection = new Error(error);
      rejection.contactCode = getContactAttachmentFileErrorCode(file);
      rejection.fileName = file.originalname;
      cb(rejection, false);
    } else {
      cb(null, true);
    }
  },
});

const uploadContactAttachments = contactUpload.array(
  "attachments",
  CONTACT_ATTACHMENT_LIMITS.maxFiles,
);

// Wrap multer so its errors return a clean 400 instead of a generic 500.
const handleContactUpload = (req, res, next) => {
  uploadContactAttachments(req, res, (err) => {
    if (!err) {
      return next();
    }

    let message = "Attachment upload failed.";
    let code = CONTACT_ERROR_CODES.ATTACHMENT_UPLOAD_FAILED;
    let values;

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        message = `Each file must be ${CONTACT_ATTACHMENT_MAX_MB} MB or smaller.`;
        code = CONTACT_ERROR_CODES.ATTACHMENT_TOO_LARGE;
      } else if (
        err.code === "LIMIT_FILE_COUNT" ||
        err.code === "LIMIT_UNEXPECTED_FILE"
      ) {
        message = `You can attach up to ${CONTACT_ATTACHMENT_LIMITS.maxFiles} files.`;
        code = CONTACT_ERROR_CODES.ATTACHMENT_TOO_MANY;
      }
    } else if (err.message) {
      message = err.message;
      if (err.contactCode) code = err.contactCode;
      if (err.fileName) values = { fileName: err.fileName };
    }

    return res.status(400).json({ success: false, code, values, message });
  });
};

router.post(
  "/",
  contactLimiter,
  handleContactUpload,
  contactController.submitContactForm,
);

module.exports = router;
