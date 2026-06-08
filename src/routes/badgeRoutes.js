const express = require("express");
const badgeController = require("../controllers/badgeController");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth");

const router = express.Router();

// Get all badges (public)
router.get("/", badgeController.getAllBadges);

// Award a badge to a user (requires auth)
router.post("/award", authenticateToken, badgeController.awardBadge);

// Delete one received badge award (requires auth; recipient only)
router.delete(
  "/awards/:awardId",
  authenticateToken,
  badgeController.deleteBadgeAward,
);

// Get shared teams between authenticated user and target user (requires auth)
// Used by BadgeAwardModal to populate the team context dropdown
router.get(
  "/shared-teams/:userId",
  authenticateToken,
  badgeController.getSharedTeams,
);

// Get badges for a specific user (optional auth so owner sees hidden awards)
router.get("/user/:userId", optionalAuthenticateToken, badgeController.getUserBadges);

module.exports = router;
