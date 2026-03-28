const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const auth = require("../middlewares/auth");
<<<<<<< HEAD
const { upload } = require('../middlewares/uploadMiddleware');
const db = require("../config/database");
=======
const upload = require("../middlewares/uploadMiddleware");
>>>>>>> 2c3fe7db35a1c5fd3e768db6d05d7d7ddd09a44f

// Register a new user (with optional avatar upload)
router.post("/register", upload.single("avatar"), authController.register);

// Login existing user
router.post("/login", authController.login);

// Email verification routes (query-param based: /verify-email?token=...)
router.get("/verify-email", authController.verifyEmail);
router.post("/resend-verification", authController.resendVerification);

// Get current user (requires token)
router.get("/me", auth.authenticateToken, authController.getCurrentUser);

// Password reset routes
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// Change password (authenticated)
router.put(
  "/change-password",
  auth.authenticateToken,
  authController.changePassword,
);

// Change email (authenticated)
router.put("/change-email", auth.authenticateToken, authController.changeEmail);

module.exports = router;
