const express = require("express");
const router = express.Router();
const imagekit = require("../config/imagekit");
const auth = require("../middlewares/auth");

// Frontend calls this before every upload to get short-lived credentials
router.get("/auth", auth.authenticateToken, (req, res) => {
  const authParams = imagekit.helper.getAuthenticationParameters();
  res.json(authParams);
});

module.exports = router;
