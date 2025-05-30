const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const auth = require("../middlewares/auth");

// Team routes
router.post("/", auth.authenticateToken, teamController.createTeam);
router.get("/", teamController.getAllTeams);
router.get("/my-teams", auth.authenticateToken, teamController.getUserTeams);
router.get("/:id", teamController.getTeamById);
router.put("/:id", auth.authenticateToken, teamController.updateTeam);
router.delete("/:id", auth.authenticateToken, teamController.deleteTeam);
router.get(
  "/:id/applications",
  auth.authenticateToken,
  teamController.getTeamApplications
);
router.put(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamController.handleTeamApplication
);
router.post(
  "/:id/apply",
  auth.authenticateToken,
  teamController.applyToJoinTeam
);
router.post(
  "/:id/members",
  auth.authenticateToken,
  teamController.addTeamMember
);
router.delete(
  "/:id/members/:userId",
  auth.authenticateToken,
  teamController.removeTeamMember
);
router.get(
  "/:id/members/:userId/role",
  auth.authenticateToken,
  teamController.getUserRoleInTeam
);

router.get(
  "/applications/user",
  auth.authenticateToken,
  teamController.getUserPendingApplications
);

router.delete(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamController.cancelApplication
);

module.exports = router;
