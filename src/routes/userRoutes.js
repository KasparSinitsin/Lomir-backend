const express = require("express");
const userController = require("../controllers/userController");
// Import your authentication middleware
const auth = require("../middlewares/auth");

const router = express.Router();

// === Core User Routes ===

// GET /api/users - Get all users
// Access: Public (or add auth.authenticateToken if needed)
router.get("/", userController.getUsers);

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
  userController.deletionPreview,
);

// DELETE /api/users/:id - Delete a specific user by their ID
// Access: Private (Requires valid token)
router.delete("/:id", auth.authenticateToken, userController.deleteUser);

// DELETE /api/users/:id/avatar - Delete user's avatar image
router.delete(
  "/:id/avatar",
  auth.authenticateToken,
  userController.deleteAvatar,
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
  userController.getUserTags,
);

// PUT /api/users/:id/tags - Update tags associated with a specific user
// Access: Private (Requires valid token)
router.put("/:id/tags", auth.authenticateToken, userController.updateUserTags);

// PATCH /api/users/:id/badges/awards/:awardId/visibility - Hide/show one award on own profile
// Access: Private (Requires valid token)
router.patch(
  "/:id/badges/awards/:awardId/visibility",
  auth.authenticateToken,
  userController.updateUserBadgeVisibility,
);

// GET /api/users/:id/badges - Get badges for a specific user
// Access: Public, with optional auth for own-profile hidden award visibility
router.get(
  "/:id/badges",
  auth.optionalAuthenticateToken,
  userController.getUserBadges,
);

// Export the router for use in app.js
module.exports = router;
