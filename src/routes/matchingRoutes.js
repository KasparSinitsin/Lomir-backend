const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const matchingController = require("../controllers/matchingController");

// GET /api/matching/roles — Find vacant roles matching the authenticated user
router.get(
  "/roles",
  auth.authenticateToken,
  matchingController.getMatchingRoles
);

// GET /api/matching/role/:roleId/candidates — Find users matching a specific role (admin only)
router.get(
  "/role/:roleId/candidates",
  auth.authenticateToken,
  matchingController.getMatchingCandidates
);

module.exports = router;