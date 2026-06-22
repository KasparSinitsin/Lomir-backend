const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const auth = require("../middlewares/auth");
const {
  authLimiter,
  registerLimiter,
  accountChangeLimiter,
  usernameAvailabilityLimiter,
} = require("../middlewares/rateLimiter");
const { upload } = require("../middlewares/uploadMiddleware");

// Register a new user (with optional avatar upload)
router.post(
  "/register",
  registerLimiter,
  upload.single("avatar"),
  authController.register,
);

// Login existing user
router.post("/login", authLimiter, authController.login);

// Log out (clears the session cookie)
router.post("/logout", authController.logout);

router.post(
  "/check-username",
  usernameAvailabilityLimiter,
  authController.checkUsername,
);

// Email verification routes (query-param based: /verify-email?token=...)
router.get("/verify-email", authController.verifyEmail);
router.get("/verify-email-change", authController.verifyEmailChange);
router.post(
  "/resend-verification",
  authLimiter,
  authController.resendVerification,
);

// Get current user (requires token)
router.get("/me", auth.authenticateToken, authController.getCurrentUser);

// Password reset routes
router.post("/forgot-password", authLimiter, authController.forgotPassword);
router.post("/reset-password", authLimiter, authController.resetPassword);

// Change password (authenticated) — dedicated limiter so a mistyped current
// password can't lock the user out of login (which uses authLimiter).
router.put(
  "/change-password",
  accountChangeLimiter,
  auth.authenticateToken,
  authController.changePassword,
);

// Change email (authenticated) — same dedicated limiter as change-password.
router.put(
  "/change-email",
  accountChangeLimiter,
  auth.authenticateToken,
  authController.changeEmail,
);

module.exports = router;
