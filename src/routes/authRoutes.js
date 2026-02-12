const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const auth = require("../middlewares/auth");
const upload = require("../middlewares/uploadMiddleware");
const db = require("../config/database");

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

// --- Optional debug endpoints (keep only in dev) ---
router.get("/db-test-connection", async (req, res) => {
  try {
    const timeResult = await db.query("SELECT NOW() as current_time");
    const tableResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'users'
    `);

    res.json({
      current_time: timeResult.rows[0].current_time,
      users_table_exists: tableResult.rows.length > 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/check-latest-users", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, username, email, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
