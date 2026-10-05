const express = require("express");
const userController = require("../controllers/userController");
const userBlockingController = require("../controllers/userBlockingController");
const userTagsBadgesController = require("../controllers/userTagsBadgesController");
const userDeletionController = require("../controllers/userDeletionController");
// Import your authentication middleware
const auth = require("../middlewares/auth");

const router = express.Router();

// === Core User Routes ===

// GET /api/users - Get all users
// Access: Public (or add auth.authenticateToken if needed)
router.get("/", userController.getUsers);

// POST /api/users/resolve-names - the names a batch of ids display under today
// Access: Private (any authenticated user)
//
// ⚠️ Registered ABOVE the "/:id" routes on purpose. Nothing shadows it today
// because "/:id" has no POST handler, but a literal path placed after a
// parameterized one is a trap waiting for the next person who adds
// `router.post("/:id", ...)` - at which point "resolve-names" would start
// arriving as an id, and `Number.parseInt("resolve-names")` is NaN, so the
// controller would answer 200 with an empty result and every mention would
// quietly render as a deleted account. Keep it here.
router.post(
  "/resolve-names",
  auth.authenticateToken,
  userController.resolveDisplayNames,
);

// GET /api/users/:id - Get a specific user by their ID
// Access: Public, with optional auth for own-profile hidden award visibility
router.get("/:id", auth.optionalAuthenticateToken, userController.getUserById);

// PUT /api/users/:id - Update a specific user by their ID
// Access: Private (Requires valid token)
router.put("/:id", auth.authenticateToken, userController.updateUser);

// POST /api/users/:id/deletion-preview - Preview account deletion impact
// Access: Private (Requires valid token)
router.post(
  "/:id/deletion-preview",
  auth.authenticateToken,
  userDeletionController.deletionPreview,
);

// DELETE /api/users/:id - Delete a specific user by their ID
// Access: Private (Requires valid token)
router.delete(
  "/:id",
  auth.authenticateToken,
  userDeletionController.deleteUser,
);

// DELETE /api/users/:id/avatar - Delete user's avatar image
router.delete(
  "/:id/avatar",
  auth.authenticateToken,
  userController.deleteAvatar,
);

// === User Blocks ===

// GET /api/users/:id/blocks - List users the current user has blocked
// Access: Private (self only)
router.get(
  "/:id/blocks",
  auth.authenticateToken,
  userBlockingController.getBlockedUsers,
);

// POST /api/users/:id/blocks - Block a user
// Access: Private (self only)
router.post(
  "/:id/blocks",
  auth.authenticateToken,
  userBlockingController.blockUser,
);

// DELETE /api/users/:id/blocks/:blockedId - Unblock a user
// Access: Private (self only)
router.delete(
  "/:id/blocks/:blockedId",
  auth.authenticateToken,
  userBlockingController.unblockUser,
);

// GET /api/users/:id/block-relationships - Ids in a block relationship (either direction)
// Access: Private (self only)
router.get(
  "/:id/block-relationships",
  auth.authenticateToken,
  userBlockingController.getBlockRelationships,
);

// === User-Specific Sub-Resources ===

// GET /api/users/:id/teams - Get teams associated with a specific user
// Access: Private (Requires valid token - added assumption, adjust if needed)
// router.get("/:id/teams", auth.authenticateToken, userController.getUserTeams);

// GET /api/users/:id/tags - Get tags associated with a specific user
// Access: Public, with optional auth for own-profile hidden award visibility
router.get(
  "/:id/tags",
  auth.optionalAuthenticateToken,
  userTagsBadgesController.getUserTags,
);

// PUT /api/users/:id/tags - Update tags associated with a specific user
// Access: Private (Requires valid token)
router.put(
  "/:id/tags",
  auth.authenticateToken,
  userTagsBadgesController.updateUserTags,
);

// PATCH /api/users/:id/badges/awards/:awardId/visibility - Hide/show one award on own profile
// Access: Private (Requires valid token)
router.patch(
  "/:id/badges/awards/:awardId/visibility",
  auth.authenticateToken,
  userTagsBadgesController.updateUserBadgeVisibility,
);

// GET /api/users/:id/badges - Get badges for a specific user
// Access: Public, with optional auth for own-profile hidden award visibility
router.get(
  "/:id/badges",
  auth.optionalAuthenticateToken,
  userTagsBadgesController.getUserBadges,
);

// Export the router for use in app.js
module.exports = router;
