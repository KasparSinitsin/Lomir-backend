const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");
const auth = require("../middlewares/auth");
const db = require("../config/database");
const invitationController = require("../controllers/invitationController");
const vacantRoleController = require("../controllers/vacantRoleController");

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
  },
);

// Team routes
router.post("/", auth.authenticateToken, teamController.createTeam);
router.get("/", teamController.getAllTeams);
router.get("/my-teams", auth.authenticateToken, teamController.getUserTeams);

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
  teamController.getUserPendingApplications,
);

router.put(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamController.handleTeamApplication,
);

router.delete(
  "/applications/:applicationId",
  auth.authenticateToken,
  teamController.cancelApplication,
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
        [teamId, userId],
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
        [teamId, memberId],
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
        const client = await db.pool.connect();

        try {
          await client.query("BEGIN");

          // Demote current owner to admin
          await client.query(
            `UPDATE team_members 
       SET role = 'admin' 
       WHERE team_id = $1 AND role = 'owner'`,
            [teamId],
          );

          // Promote target member to owner
          await client.query(
            `UPDATE team_members 
       SET role = 'owner' 
       WHERE team_id = $1 AND user_id = $2`,
            [teamId, memberId],
          );

          // Update teams table owner_id
          await client.query(
            `UPDATE teams 
       SET owner_id = $1 
       WHERE id = $2`,
            [memberId, teamId],
          );

          await client.query("COMMIT");

          console.log(
            `✅ Ownership transferred to user ${memberId} in team ${teamId}`,
          );

          // === NOTIFICATION + SYSTEM MESSAGES ===
          try {
            const {
              createNotification,
            } = require("../controllers/notificationController");

            // Team name
            const teamResult = await db.pool.query(
              `SELECT name FROM teams WHERE id = $1`,
              [teamId],
            );
            const teamName = teamResult.rows[0]?.name || "the team";

            // Previous owner name
            const prevOwnerResult = await db.pool.query(
              `SELECT first_name, last_name, username FROM users WHERE id = $1`,
              [userId],
            );
            const prevOwner = prevOwnerResult.rows[0];
            const prevOwnerName =
              prevOwner.first_name && prevOwner.last_name
                ? `${prevOwner.first_name} ${prevOwner.last_name}`
                : prevOwner.username;

            // New owner name
            const newOwnerResult = await db.pool.query(
              `SELECT first_name, last_name, username FROM users WHERE id = $1`,
              [memberId],
            );
            const newOwner = newOwnerResult.rows[0];
            const newOwnerName =
              newOwner.first_name && newOwner.last_name
                ? `${newOwner.first_name} ${newOwner.last_name}`
                : newOwner.username;

            // ✅ DM system message (tokenized team + users)
            const teamToken = `${teamId}:${teamName}`;
            const prevToken = `${userId}:${prevOwnerName}`;
            const newToken = `${memberId}:${newOwnerName}`;

            const ownershipMessage = `👑 OWNERSHIP_TRANSFERRED: ${teamToken} | ${prevToken} | ${newToken}`;

            await db.pool.query(
              `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
              [userId, memberId, ownershipMessage],
            );

            // Notification for new owner
            await createNotification({
              userId: parseInt(memberId),
              type: "ownership_transferred",
              title: `You are now the owner of ${teamName}`,
              message: null,
              referenceType: "team_member",
              referenceId: parseInt(teamId),
              teamId: parseInt(teamId),
              actorId: parseInt(userId),
            });

            // Socket event
            const io = req.app.get("io");
            if (io) {
              io.to(`user:${memberId}`).emit("notification:new", {
                type: "ownership_transferred",
                teamId: parseInt(teamId),
              });
            }

            // Team chat message for everyone
            const teamChatMessage = `👑 OWNERSHIP_TEAM: ${prevOwnerName} | ${newOwnerName}`;
            await db.pool.query(
              `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
              [userId, teamId, teamChatMessage],
            );
          } catch (notificationError) {
            console.error(
              "Error creating ownership transfer notification:",
              notificationError,
            );
          }

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
          [new_role, teamId, memberId],
        );

        await client.query("COMMIT");

        console.log(
          `✅ Successfully updated user ${memberId} to role ${new_role} in team ${teamId}`,
        );

        // === CREATE NOTIFICATION FOR AFFECTED MEMBER ===
        try {
          const {
            createNotification,
          } = require("../controllers/notificationController");

          // Get team name
          const teamResult = await db.pool.query(
            `SELECT name FROM teams WHERE id = $1`,
            [teamId],
          );
          const teamName = teamResult.rows[0]?.name || "the team";

          // Get changer's name (the admin/owner who made the change)
          const changerResult = await db.pool.query(
            `SELECT first_name, last_name, username FROM users WHERE id = $1`,
            [userId],
          );
          const changer = changerResult.rows[0];
          const changerName =
            changer.first_name && changer.last_name
              ? `${changer.first_name} ${changer.last_name}`
              : changer.username;

          // Get affected member's name
          const memberResult = await db.pool.query(
            `SELECT first_name, last_name, username FROM users WHERE id = $1`,
            [memberId],
          );
          const member = memberResult.rows[0];
          const memberName =
            member.first_name && member.last_name
              ? `${member.first_name} ${member.last_name}`
              : member.username;

          // Determine if promoted or demoted
          const action = new_role === "admin" ? "promoted" : "demoted";

          // Send system message to affected member via DM
          const teamToken = `${teamId}:${teamName}`;

          const roleChangeMessage =
            `🔄 ROLE_CHANGED: ${teamToken} | ` +
            `${userId}:${changerName} | ` +
            `${memberId}:${memberName} | ` +
            `${memberCurrentRole} | ${new_role}`;

          await db.pool.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, memberId, roleChangeMessage],
          );

          // Create notification for affected member
          await createNotification({
            userId: parseInt(memberId),
            type: "role_changed",
            title: `You were ${action} to ${new_role} in ${teamName}`,
            message: null,
            referenceType: "team_member",
            referenceId: parseInt(teamId),
            teamId: parseInt(teamId),
            actorId: parseInt(userId),
          });

          // Emit socket event to affected member
          const io = req.app.get("io");
          if (io) {
            io.to(`user:${memberId}`).emit("notification:new", {
              type: "role_changed",
              teamId: parseInt(teamId),
            });
          }
        } catch (notificationError) {
          console.error(
            "Error creating role change notification:",
            notificationError,
          );
        }
        // === END NOTIFICATION ===

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
  },
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
  teamController.getUserRoleInTeam,
);

router.get(
  "/:id/applications",
  auth.authenticateToken,
  teamController.getTeamApplications,
);

router.post(
  "/:id/apply",
  auth.authenticateToken,
  teamController.applyToJoinTeam,
);

router.get("/:id/badge-awards", teamController.getTeamBadgeAwards);
router.get("/:id/member-badges", teamController.getTeamMemberBadges);
router.get("/:id/member-badge-awards", teamController.getTeamMemberBadgeAwards);
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
