const express = require("express");
const router = express.Router();
const multer = require("multer");
const contactController = require("../controllers/contactController");
const { contactLimiter } = require("../middlewares/rateLimiter");
const {
  CONTACT_ATTACHMENT_LIMITS,
  CONTACT_ATTACHMENT_MAX_MB,
  validateContactAttachmentFile,
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
      cb(new Error(error), false);
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

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        message = `Each file must be ${CONTACT_ATTACHMENT_MAX_MB} MB or smaller.`;
      } else if (
        err.code === "LIMIT_FILE_COUNT" ||
        err.code === "LIMIT_UNEXPECTED_FILE"
      ) {
        message = `You can attach up to ${CONTACT_ATTACHMENT_LIMITS.maxFiles} files.`;
      }
    } else if (err.message) {
      message = err.message;
    }

    return res.status(400).json({ success: false, message });
  });
};

router.post(
  "/",
  contactLimiter,
  handleContactUpload,
  contactController.submitContactForm,
);

module.exports = router;
