const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const auth = require("../middlewares/auth");
const db = require("../config/database");
const invitationController = require("../controllers/invitationController");

// Debugging middleware to log incoming requests
router.use((req, res, next) => {
  console.log(`🔍 teamRoutes Debug: ${req.method} ${req.originalUrl}`);
  console.log(`🔍 Route path: ${req.path}`);
  console.log(`🔍 Route params:`, req.params);
  next();
});

router.put(
  "/test-role-update/:teamId/:memberId",
  auth.authenticateToken,
  (req, res) => {
    console.log("🎯 TEST ROLE ROUTE HIT!");
    console.log("Params:", req.params);
    console.log("Body:", req.body);

    res.json({
      success: true,
      message: "Test route works!",
      params: req.params,
      body: req.body,
    });
  }
);

// Team routes
router.post("/", auth.authenticateToken, teamController.createTeam);
router.get("/", teamController.getAllTeams);
router.get("/my-teams", auth.authenticateToken, teamController.getUserTeams);

// ==================== INVITATION ROUTES ====================
// Get teams where current user can invite others
router.get(
  "/can-invite",
  auth.authenticateToken,
  invitationController.getTeamsWhereUserCanInvite
);

// Get all pending invitations received by current user
router.get(
  "/invitations/received",
  auth.authenticateToken,
  invitationController.getUserReceivedInvitations
);

// Respond to an invitation (accept or decline)
router.put(
  "/invitations/:invitationId",
  auth.authenticateToken,
  invitationController.respondToInvitation
);

// Cancel an invitation (by team owner/admin)
router.delete(
  "/invitations/:invitationId",
  auth.authenticateToken,
  invitationController.cancelInvitation
);

// Get all pending invitations sent by a specific team
router.get(
  "/:teamId/invitations",
  auth.authenticateToken,
  invitationController.getTeamSentInvitations
);

// Send an invitation to a user
router.post(
  "/:teamId/invitations",
  auth.authenticateToken,
  invitationController.sendTeamInvitation
);

router.get(
  "/applications/user",
  auth.authenticateToken,
  teamController.getUserPendingApplications
);

router.put(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamController.handleTeamApplication
);

router.delete(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamController.cancelApplication
);

router.put(
  "/:teamId/members/:memberId/role",
  auth.authenticateToken,
  async (req, res) => {
    try {
      console.log("🔥 ROLE UPDATE ROUTE HIT!");
      const { teamId, memberId } = req.params;
      const userId = req.user.id;
      const { new_role } = req.body;

      console.log("Extracted:", {
        teamId,
        memberId,
        role: new_role,
        requesterId: userId,
      });

      // Validate role
      const validRoles = ["member", "admin", "owner"];
      if (!validRoles.includes(new_role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role. Must be 'member', 'admin', or 'owner'",
          received: new_role,
        });
      }

      // Check if the user making the request is authorized (owner or admin)
      const authCheck = await db.pool.query(
        `
        SELECT tm.role 
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.id
        WHERE tm.team_id = $1 
        AND tm.user_id = $2
        AND (tm.role = 'owner' OR tm.role = 'admin')
        AND t.archived_at IS NULL
      `,
        [teamId, userId]
      );

      if (authCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to change member roles in this team",
        });
      }

      const userRole = authCheck.rows[0].role;

      // Check if target member exists and get their current role
      const memberCheck = await db.pool.query(
        `
        SELECT role FROM team_members 
        WHERE team_id = $1 AND user_id = $2
      `,
        [teamId, memberId]
      );

      if (memberCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this team",
        });
      }

      const memberCurrentRole = memberCheck.rows[0].role;

      // Commented out restrictions for team role changes to enable more flexible role management

      // // Only owners can change admin roles
      // if (memberCurrentRole === "admin" && userRole !== "owner") {
      //   return res.status(403).json({
      //     success: false,
      //     message: "Only team owners can change admin roles",
      //   });
      // }

      // // Only owners can promote to admin
      // if (new_role === "admin" && userRole !== "owner") {
      //   return res.status(403).json({
      //     success: false,
      //     message: "Only team owners can promote members to admin",
      //   });
      // }

      // Only owner can transfer ownership
      if (new_role === "owner" && userRole !== "owner") {
        return res.status(403).json({
          success: false,
          message: "Only the team owner can transfer ownership",
        });
      }

      // Handle ownership transfer
      if (new_role === "owner") {
        // Start transaction for ownership transfer
        const client = await db.pool.connect();

        try {
          await client.query("BEGIN");

          // Demote current owner to admin
          await client.query(
            `UPDATE team_members 
       SET role = 'admin' 
       WHERE team_id = $1 AND role = 'owner'`,
            [teamId]
          );

          // Promote target member to owner
          await client.query(
            `UPDATE team_members 
       SET role = 'owner' 
       WHERE team_id = $1 AND user_id = $2`,
            [teamId, memberId]
          );

          // Update the teams table owner_id as well
          await client.query(
            `UPDATE teams 
       SET owner_id = $1 
       WHERE id = $2`,
            [memberId, teamId]
          );

          await client.query("COMMIT");

          console.log(
            `✅ Ownership transferred to user ${memberId} in team ${teamId}`
          );

          return res.status(200).json({
            success: true,
            message: "Team ownership transferred successfully",
          });
        } catch (dbError) {
          await client.query("ROLLBACK");
          console.error("Database error during ownership transfer:", dbError);
          return res.status(500).json({
            success: false,
            message: "Database error during ownership transfer",
          });
        } finally {
          client.release();
        }
      }

      // Update member role
      const client = await db.pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `
          UPDATE team_members 
          SET role = $1 
          WHERE team_id = $2 AND user_id = $3
        `,
          [new_role, teamId, memberId]
        );

        await client.query("COMMIT");

        console.log(
          `✅ Successfully updated user ${memberId} to role ${new_role} in team ${teamId}`
        );

        res.status(200).json({
          success: true,
          message: `Member role updated to ${new_role} successfully`,
        });
      } catch (dbError) {
        await client.query("ROLLBACK");
        console.error("Database error while updating member role:", dbError);
        res.status(500).json({
          success: false,
          message: "Database error while updating member role",
          errorDetails: dbError.message,
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Update member role error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating member role",
        error: error.message,
      });
    }
  }
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
  "/:id/applications",
  auth.authenticateToken,
  teamController.getTeamApplications
);

router.post(
  "/:id/apply",
  auth.authenticateToken,
  teamController.applyToJoinTeam
);

router.get("/:id", teamController.getTeamById);
router.put("/:id", auth.authenticateToken, teamController.updateTeam);
router.delete("/:id", auth.authenticateToken, teamController.deleteTeam);

// Test route for debugging purposes
router.put("/:teamId/test-role", auth.authenticateToken, (req, res) => {
  console.log("🧪 TEST ROUTE CALLED!");
  res.json({ message: "Test route works!" });
});

// Debugging catch-all route for unmatched paths
router.all("*", (req, res) => {
  console.log("🚨 CATCH-ALL ROUTE HIT");
  console.log("Method:", req.method);
  console.log("Path:", req.path);
  console.log("Params:", req.params);
  console.log("Body:", req.body);

  res.status(404).json({
    message: "Route not found in teamRoutes",
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
  });
});

module.exports = router;
