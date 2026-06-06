const express = require("express");
const router = express.Router();
const multer = require("multer");
const contactController = require("../controllers/contactController");
const { contactLimiter } = require("../middlewares/rateLimiter");
const { FILE_LIMITS, ALLOWED_EXTENSIONS } = require("../utils/fileValidation");

const CONTACT_ALLOWED_EXTENSIONS = new Set([
  ...ALLOWED_EXTENSIONS.chatImage,
  ...ALLOWED_EXTENSIONS.chatFile,
]);

const contactUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_LIMITS.chatFile },
  fileFilter: (req, file, cb) => {
    const ext = "." + file.originalname.split(".").pop().toLowerCase();
    if (CONTACT_ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("File type not supported."), false);
    }
  },
});

router.post(
  "/",
  contactLimiter,
  contactUpload.array("attachments", 5),
  contactController.submitContactForm,
);

module.exports = router;
