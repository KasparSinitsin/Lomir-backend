const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const auth = require("../middlewares/auth");
const invitationController = require("../controllers/invitationController");
const vacantRoleController = require("../controllers/vacantRoleController");
const teamBadgeController = require("../controllers/teamBadgeController");
const teamReadController = require("../controllers/teamReadController");
const teamApplicationsController = require("../controllers/teamApplicationsController");

// Team routes
router.post("/", auth.authenticateToken, teamController.createTeam);
router.get("/", teamReadController.getAllTeams);
router.get("/my-teams", auth.authenticateToken, teamReadController.getUserTeams);

// Bulk variant of /:id/member-badges. Must be declared before any /:id route
// so Express doesn't treat "member-badges" as a team id.
router.get("/member-badges", teamBadgeController.getMemberBadgesForTeams);

// DELETE /api/teams/:id/avatar - Delete team's avatar image
router.delete(
  "/:id/avatar",
  auth.authenticateToken,
  teamController.deleteTeamAvatar,
);

// ==================== VACANT ROLE ROUTES ====================

// Get all vacant roles for a team (public, but enriched with match score if authenticated)
router.get("/:teamId/vacant-roles", auth.optionalAuthenticateToken, vacantRoleController.getVacantRoles);

// Get a single vacant role by ID (public)
router.get(
  "/:teamId/vacant-roles/:roleId",
  vacantRoleController.getVacantRoleById,
);

// Create a new vacant role (owner/admin only)
router.post(
  "/:teamId/vacant-roles",
  auth.authenticateToken,
  vacantRoleController.createVacantRole,
);

// Update a vacant role (owner/admin only)
router.put(
  "/:teamId/vacant-roles/:roleId",
  auth.authenticateToken,
  vacantRoleController.updateVacantRole,
);

// Delete a vacant role (owner/admin only)
router.delete(
  "/:teamId/vacant-roles/:roleId",
  auth.authenticateToken,
  vacantRoleController.deleteVacantRole,
);

// Update vacant role status (owner/admin only)
router.put(
  "/:teamId/vacant-roles/:roleId/status",
  auth.authenticateToken,
  vacantRoleController.updateVacantRoleStatus,
);

// ==================== INVITATION ROUTES ====================
// Get teams where current user can invite others
router.get(
  "/can-invite",
  auth.authenticateToken,
  invitationController.getTeamsWhereUserCanInvite,
);

// Get all pending invitations received by current user
router.get(
  "/invitations/received",
  auth.authenticateToken,
  invitationController.getUserReceivedInvitations,
);

// Respond to an invitation (accept or decline)
router.put(
  "/invitations/:invitationId",
  auth.authenticateToken,
  invitationController.respondToInvitation,
);

// Cancel an invitation (by team owner/admin)
router.delete(
  "/invitations/:invitationId/role",
  auth.authenticateToken,
  invitationController.cancelRoleInvitation,
);

router.delete(
  "/invitations/:invitationId",
  auth.authenticateToken,
  invitationController.cancelInvitation,
);

// Get all pending invitations sent by a specific team
router.get(
  "/:teamId/invitations",
  auth.authenticateToken,
  invitationController.getTeamSentInvitations,
);

// Send an invitation to a user
router.post(
  "/:teamId/invitations",
  auth.authenticateToken,
  invitationController.sendTeamInvitation,
);

router.get(
  "/applications/user",
  auth.authenticateToken,
  teamApplicationsController.getUserPendingApplications,
);

router.put(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamApplicationsController.handleTeamApplication,
);

router.delete(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamApplicationsController.cancelApplication,
);

router.put(
  "/:teamId/members/:memberId/role",
  auth.authenticateToken,
  teamController.updateMemberRole,
);

router.post(
  "/:id/members",
  auth.authenticateToken,
  teamController.addTeamMember,
);

router.delete(
  "/:id/members/:userId",
  auth.authenticateToken,
  teamController.removeTeamMember,
);

router.get(
  "/:id/members/:userId/role",
  auth.authenticateToken,
  teamReadController.getUserRoleInTeam,
);

router.get(
  "/:id/applications",
  auth.authenticateToken,
  teamApplicationsController.getTeamApplications,
);

router.post(
  "/:id/apply",
  auth.authenticateToken,
  teamApplicationsController.applyToJoinTeam,
);

router.get("/:id/badge-awards", teamBadgeController.getTeamBadgeAwards);
router.get("/:id/member-badges", teamBadgeController.getTeamMemberBadges);
router.get(
  "/:id/member-badge-awards",
  teamBadgeController.getTeamMemberBadgeAwards,
);
router.get("/:id", teamReadController.getTeamById);
router.put("/:id", auth.authenticateToken, teamController.updateTeam);
router.delete("/:id", auth.authenticateToken, teamController.deleteTeam);

module.exports = router;
