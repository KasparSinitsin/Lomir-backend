const db = require("../config/database");
const Joi = require("joi");
const {
  createNotification,
  notifyTeamMembers,
} = require("./notificationController");
const { emitInsertedMessage } = require("../utils/socketMessageEmitter");
const { checkAndCleanupArchivedTeam } = require("./teamController");

const reopenRolesFilledByMember = async (queryRunner, teamId, memberId) => {
  const result = await queryRunner.query(
    `UPDATE team_vacant_roles
     SET status = 'open',
         filled_by = NULL,
         updated_at = NOW()
     WHERE team_id = $1
       AND filled_by = $2
       AND status = 'filled'
     RETURNING id, role_name`,
    [teamId, memberId],
  );

  return result.rows;
};

const buildRoleReopenedLeaveMessage = ({
  teamId,
  teamName,
  roleId,
  roleName,
  memberId,
  memberName,
}) =>
  `🔓 ROLE_REOPENED: ${teamId}:${teamName || "your team"} | ${roleId}:${roleName || "Vacant Role"} | ${memberId}:${memberName || "Someone"}`;

const notifyRemainingMembersOfReopenedRoles = async ({
  req,
  teamId,
  teamName,
  memberId,
  memberName,
  roleEvents,
}) => {
  if (!Array.isArray(roleEvents) || roleEvents.length === 0) return;

  const io = req.app?.get?.("io");

  for (const event of roleEvents) {
    if (event.messageRow) {
      await emitInsertedMessage(req, event.messageRow);
    }

    const membersResult = await db.pool.query(
      `SELECT user_id
       FROM team_members
       WHERE team_id = $1
         AND user_id != $2`,
      [teamId, memberId],
    );

    for (const member of membersResult.rows) {
      await createNotification({
        userId: member.user_id,
        type: "role_reopened",
        title: `${memberName} left the role ${event.roleName || "Vacant Role"} in ${teamName}`,
        message: `${event.roleName || "Vacant Role"} is open again to be filled.`,
        referenceType: "message",
        referenceId: event.messageRow?.id || event.roleId,
        teamId: parseInt(teamId, 10),
        actorId: parseInt(memberId, 10),
      });
    }

    io?.to(`team:${teamId}`).emit("notification:new", {
      type: "role_reopened",
      teamId: parseInt(teamId, 10),
      referenceId: event.messageRow?.id
        ? Number(event.messageRow.id)
        : Number(event.roleId),
      messageId: event.messageRow?.id ? Number(event.messageRow.id) : null,
      actorId: parseInt(memberId, 10),
    });
  }
};

/**
 * @description Delete team's avatar image
 * @route DELETE /api/teams/:id/avatar
 * @access Private (Requires authentication, must be owner or admin)
 */

const addTeamMember = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Validate request body
    const schema = Joi.object({
      memberId: Joi.number().required(),
      role: Joi.string().valid("member", "admin").default("member"),
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data", // More specific message
        errors: error.details.map((detail) => detail.message),
      });
    }

    const newMemberId = value.memberId;
    const role = value.role;

    // First check if the user is trying to remove themselves from an archived team
    const teamStatusCheck = await db.pool.query(
      `SELECT archived_at FROM teams WHERE id = $1`,
      [teamId],
    );

    const isArchivedTeam = teamStatusCheck.rows[0]?.archived_at !== null;
    const isSelfRemoval = userId == memberId;

    // For archived teams, only allow self-removal
    if (isArchivedTeam) {
      if (!isSelfRemoval) {
        return res.status(403).json({
          success: false,
          message: "Cannot remove other members from an archived team",
        });
      }

      // Verify user is actually a member
      const memberCheck = await db.pool.query(
        `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId],
      );

      if (memberCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this team",
        });
      }

      // Skip the rest of the authorization logic for archived team self-removal
      // Just delete the membership
      await db.pool.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId],
      );

      return res.status(200).json({
        success: true,
        message: "Successfully left the archived team",
      });
    }

    // Original authorization check for non-archived teams
    const authCheck = await db.pool.query(
      `
  SELECT tm.role 
  FROM team_members tm
  JOIN teams t ON tm.team_id = t.id
  WHERE tm.team_id = $1 
  AND tm.user_id = $2
  AND t.archived_at IS NULL
`,
      [teamId, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to add members to this team",
      });
    }

    // Check if team exists and isn't full
    const teamCheck = await db.pool.query(
      `
      SELECT t.max_members, COUNT(tm.id) AS current_members
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1 AND t.archived_at IS NULL
      GROUP BY t.id, t.max_members
    `,
      [teamId],
    );

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const maxMembers = teamCheck.rows[0].max_members;
    if (
      maxMembers !== null &&
      teamCheck.rows[0].current_members >= maxMembers
    ) {
      return res.status(400).json({
        success: false,
        message: "Team is already at maximum capacity",
      });
    }

    // Check if user exists
    const userCheck = await db.pool.query(
      `
      SELECT id FROM users WHERE id = $1
    `,
      [newMemberId],
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user is already a member
    const memberCheck = await db.pool.query(
      `
      SELECT id FROM team_members 
      WHERE team_id = $1 AND user_id = $2
    `,
      [teamId, newMemberId],
    );

    if (memberCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User is already a member of this team",
      });
    }

    // Add member
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, $3)
      `,
        [teamId, newMemberId, role],
      );

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: "Member added successfully",
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error while adding member:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while adding team member",
        ...(process.env.NODE_ENV === "development" && { error: dbError.message }),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Add team member error:", error);
    res.status(500).json({
      success: false,
      message: "Error adding team member",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


const removeTeamMember = async (req, res) => {
  try {
    const teamId = req.params.id;
    const memberId = req.params.userId;
    const userId = req.user.id;

    // === Handle archived team self-removal ===
    const teamStatusCheck = await db.pool.query(
      `SELECT archived_at FROM teams WHERE id = $1`,
      [teamId],
    );

    const isArchivedTeam = teamStatusCheck.rows[0]?.archived_at !== null;
    const isSelfRemoval = String(userId) === String(memberId);

    if (isArchivedTeam) {
      // For archived teams, check if user has permission to remove members
      const authCheckArchived = await db.pool.query(
        `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, userId],
      );

      if (authCheckArchived.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Not authorized - you are not a member of this team",
        });
      }

      const userRole = authCheckArchived.rows[0].role;

      // Self-removal is always allowed
      // Owners can remove anyone
      // Admins can remove regular members
      if (!isSelfRemoval) {
        if (userRole !== "owner" && userRole !== "admin") {
          return res.status(403).json({
            success: false,
            message: "Not authorized to remove other members",
          });
        }

        // Check the target member's role
        const targetCheck = await db.pool.query(
          `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
          [teamId, memberId],
        );

        if (targetCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Member not found in this team",
          });
        }

        const targetRole = targetCheck.rows[0].role;

        // Admins cannot remove other admins or owners
        if (
          userRole === "admin" &&
          (targetRole === "admin" || targetRole === "owner")
        ) {
          return res.status(403).json({
            success: false,
            message: "Admins cannot remove other admins or owners",
          });
        }

        // Owners cannot remove other owners
        if (targetRole === "owner" && userRole !== "owner") {
          return res.status(403).json({
            success: false,
            message: "Only owners can remove other owners",
          });
        }
      }

      // Get member info for the leave/removal message
      const memberInfo = await db.pool.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [memberId],
      );

      const m = memberInfo.rows[0];
      const memberName =
        m?.first_name && m?.last_name
          ? `${m.first_name} ${m.last_name}`
          : m?.username || "A member";

      const teamResult = await db.pool.query(
        `SELECT name FROM teams WHERE id = $1`,
        [teamId],
      );
      const teamName = teamResult.rows[0]?.name || "the team";

      // Remove membership
      await db.pool.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId],
      );

      const reopenedRoles = await reopenRolesFilledByMember(db.pool, teamId, memberId);
      const roleEvents = [];

      // Insert appropriate messages
      if (isSelfRemoval) {
        const leaveMessage = `🚪 MEMBER_LEFT:${memberId}:${memberName}`;
        const leaveMessageResult = await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, team_id, content, sent_at`,
          [memberId, teamId, leaveMessage],
        );
        await emitInsertedMessage(req, leaveMessageResult.rows[0]);
      } else {
        // Get team name and remover name for proper message formatting
        const removerInfo = await db.pool.query(
          `SELECT first_name, last_name, username FROM users WHERE id = $1`,
          [userId],
        );
        const r = removerInfo.rows[0];
        const removerName =
          r?.first_name && r?.last_name
            ? `${r.first_name} ${r.last_name}`
            : r?.username || "An admin";

        // 1. Send DM to removed member
        const teamToken = `${teamId}:${teamName}`;
        const removerToken = `${userId}:${removerName}`;
        const memberToken = `${memberId}:${memberName}`;
        const dmMessage = `🚫 MEMBER_REMOVED: ${teamToken} | ${removerToken} | ${memberToken}`;

        await db.pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, memberId, dmMessage],
        );

        // 2. Send message to team chat
        const teamChatMessage = `🚫 MEMBER_REMOVED_PUBLIC: ${teamToken} | ${memberToken}`;
        const teamChatMessageResult = await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, team_id, content, sent_at`,
          [userId, teamId, teamChatMessage],
        );
        await emitInsertedMessage(req, teamChatMessageResult.rows[0]);
      }

      for (const role of reopenedRoles) {
        const roleMessageResult = await db.pool.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, team_id, content, sent_at`,
          [
            memberId,
            teamId,
            buildRoleReopenedLeaveMessage({
              teamId,
              teamName: teamName ?? "the team",
              roleId: role.id,
              roleName: role.role_name,
              memberId,
              memberName,
            }),
          ],
        );
        roleEvents.push({
          roleId: role.id,
          roleName: role.role_name,
          messageRow: roleMessageResult.rows[0],
        });
      }

      // Cleanup archived team if empty
      try {
        await checkAndCleanupArchivedTeam(parseInt(teamId));
      } catch (cleanupError) {
        console.error("Cleanup check failed:", cleanupError);
      }

      // === Socket events for archived team member removal ===
      const io = req.app.get("io");

      if (!isSelfRemoval && io) {
        // Remove all stale unread team notifications for the removed member
        try {
          await db.pool.query(
            `DELETE FROM notifications WHERE user_id = $1 AND team_id = $2 AND read_at IS NULL`,
            [memberId, teamId],
          );
        } catch (cleanupError) {
          console.error("Error cleaning up stale notifications for removed member:", cleanupError);
        }

        // Notify the removed member to kick them from the chat
        io.to(`user:${memberId}`).emit("team:member_kicked", {
          teamId: parseInt(teamId),
          memberId: parseInt(memberId),
        });

        io.to(`user:${memberId}`).emit("notification:updated");
      }

      try {
        await notifyRemainingMembersOfReopenedRoles({
          req,
          teamId,
          teamName,
          memberId,
          memberName,
          roleEvents,
        });
      } catch (roleNotificationError) {
        console.error("Error creating role reopened notifications:", roleNotificationError);
      }

      return res.status(200).json({
        success: true,
        message: isSelfRemoval
          ? "Successfully left the archived team"
          : "Member removed successfully",
        data: {
          reopenedRoles: roleEvents.map((event) => ({
            id: event.roleId,
            role_name: event.roleName,
          })),
        },
      });
    }

    // === Non-archived team ===
    const authCheck = await db.pool.query(
      `
      SELECT tm.role 
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.team_id = $1 
      AND tm.user_id = $2
      AND t.archived_at IS NULL
      `,
      [teamId, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to remove members from this team",
      });
    }

    const userRole = authCheck.rows[0].role;

    if (!isSelfRemoval && userRole !== "owner" && userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to remove other members",
      });
    }

    const targetMemberCheck = await db.pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, memberId],
    );

    if (targetMemberCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found in this team",
      });
    }

    const memberRole = targetMemberCheck.rows[0].role;

    if (
      !isSelfRemoval &&
      (memberRole === "owner" || memberRole === "admin") &&
      userRole !== "owner"
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to remove team administrators",
      });
    }

    if (memberRole === "owner") {
      const ownerCount = await db.pool.query(
        `SELECT COUNT(*) FROM team_members WHERE team_id = $1 AND role = 'owner'`,
        [teamId],
      );

      if (parseInt(ownerCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot remove the last team owner. Transfer ownership first.",
        });
      }
    }

    const client = await db.pool.connect();

    let teamName = "the team";
    let memberName = "A member";
    let removerName = "Someone";
    let teamChatMessageRow = null;
    let roleEvents = [];

    try {
      await client.query("BEGIN");

      // Fetch names inside the transaction so we can write the correct system message ONCE
      const teamResult = await client.query(
        `SELECT name FROM teams WHERE id = $1`,
        [teamId],
      );
      teamName = teamResult.rows[0]?.name || "the team";

      const memberInfo = await client.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [memberId],
      );
      const m = memberInfo.rows[0];
      memberName =
        m?.first_name && m?.last_name
          ? `${m.first_name} ${m.last_name}`
          : m?.username || "A member";

      const removerInfo = await client.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [userId],
      );
      const r = removerInfo.rows[0];
      removerName =
        r?.first_name && r?.last_name
          ? `${r.first_name} ${r.last_name}`
          : r?.username || "Someone";

      // Delete membership
      await client.query(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, memberId],
      );

      const reopenedRoles = await reopenRolesFilledByMember(client, teamId, memberId);

      // Insert ONE team-chat system message
      let teamChatMessage;
      let senderForTeamChat;

      if (isSelfRemoval) {
        teamChatMessage = `🚪 MEMBER_LEFT:${memberId}:${memberName}`;
        senderForTeamChat = memberId;
      } else {
        const teamToken = `${teamId}:${teamName}`;
        const memberToken = `${memberId}:${memberName}`;
        teamChatMessage = `🚫 MEMBER_REMOVED_PUBLIC: ${teamToken} | ${memberToken}`;
        senderForTeamChat = userId;
      }

      const teamChatMessageResult = await client.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, team_id, content, sent_at`,
        [senderForTeamChat, teamId, teamChatMessage],
      );
      teamChatMessageRow = teamChatMessageResult.rows[0];

      for (const role of reopenedRoles) {
        const roleMessageResult = await client.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, team_id, content, sent_at`,
          [
            memberId,
            teamId,
            buildRoleReopenedLeaveMessage({
              teamId,
              teamName,
              roleId: role.id,
              roleName: role.role_name,
              memberId,
              memberName,
            }),
          ],
        );

        roleEvents.push({
          roleId: role.id,
          roleName: role.role_name,
          messageRow: roleMessageResult.rows[0],
        });
      }

      await client.query("COMMIT");
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }

    // === After commit: notifications + DM ===
    const io = req.app.get("io");
    await emitInsertedMessage(req, teamChatMessageRow);

    try {
      await notifyRemainingMembersOfReopenedRoles({
        req,
        teamId,
        teamName,
        memberId,
        memberName,
        roleEvents,
      });
    } catch (roleNotificationError) {
      console.error("Error creating role reopened notifications:", roleNotificationError);
    }

    if (isSelfRemoval) {
      try {
        await notifyTeamMembers({
          teamId: parseInt(teamId),
          excludeUserId: parseInt(memberId),
          type: "member_left",
          title: `${memberName} left ${teamName}`,
          referenceType: "message",
          referenceId: teamChatMessageRow?.id || parseInt(memberId),
          actorId: parseInt(memberId),
        });

        io?.to(`team:${teamId}`).emit("notification:new", {
          type: "member_left",
          teamId: parseInt(teamId),
        });
      } catch (e) {
        console.error("Error creating leave notification:", e);
      }
    } else {
      try {
        // Remove all stale unread team notifications for the removed member
        await db.pool.query(
          `DELETE FROM notifications WHERE user_id = $1 AND team_id = $2 AND read_at IS NULL`,
          [memberId, teamId],
        );

        // DM to removed member
        const teamToken = `${teamId}:${teamName}`;
        const removerToken = `${userId}:${removerName}`;
        const memberToken = `${memberId}:${memberName}`;
        const removeSystemMessage = `🚫 MEMBER_REMOVED: ${teamToken} | ${removerToken} | ${memberToken}`;

        const removedMemberMessageResult = await db.pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, receiver_id, content, sent_at`,
          [userId, memberId, removeSystemMessage],
        );
        await emitInsertedMessage(req, removedMemberMessageResult.rows[0]);

        await createNotification({
          userId: parseInt(memberId),
          type: "member_removed",
          title: `You were removed from ${teamName}`,
          message: null,
          referenceType: "message",
          referenceId: removedMemberMessageResult.rows[0]?.id || parseInt(teamId),
          teamId: parseInt(teamId),
          actorId: parseInt(userId),
        });

        io?.to(`user:${memberId}`).emit("notification:new", {
          type: "member_removed",
          teamId: parseInt(teamId),
          title: `You were removed from ${teamName}`,
          actorName: removerName,
        });

        // notify remaining members
        await notifyTeamMembers({
          teamId: parseInt(teamId),
          excludeUserId: parseInt(memberId),
          type: "member_left",
          title: `${memberName} was removed from ${teamName}`,
          referenceType: "message",
          referenceId: teamChatMessageRow?.id || parseInt(memberId),
          actorId: parseInt(userId),
        });

        io?.to(`team:${teamId}`).emit("notification:new", {
          type: "member_left",
          teamId: parseInt(teamId),
        });
      } catch (e) {
        console.error("Error creating removal notification:", e);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Member removed successfully",
      data: {
        reopenedRoles: roleEvents.map((event) => ({
          id: event.roleId,
          role_name: event.roleName,
        })),
      },
    });
  } catch (error) {
    console.error("Remove team member error:", error);
    return res.status(500).json({
      success: false,
      message: "Error removing team member",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


const updateMemberRole = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const memberId = req.params.memberId;
    const userId = req.user.id;
    const { new_role } = req.body;

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

        // === NOTIFICATION + SYSTEM MESSAGES ===
        try {
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

          const ownershipDmResult = await db.pool.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, receiver_id, content, sent_at`,
            [userId, memberId, ownershipMessage],
          );
          await emitInsertedMessage(req, ownershipDmResult.rows[0]);

          // Notification for new owner
          await createNotification({
            userId: parseInt(memberId),
            type: "ownership_transferred",
            title: `You are now the owner of ${teamName}`,
            message: null,
            referenceType: "message",
            referenceId: ownershipDmResult.rows[0]?.id || parseInt(teamId),
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
          const ownershipTeamMessageResult = await db.pool.query(
            `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, team_id, content, sent_at`,
            [userId, teamId, teamChatMessage],
          );
          await emitInsertedMessage(req, ownershipTeamMessageResult.rows[0]);
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

      // === CREATE NOTIFICATION FOR AFFECTED MEMBER ===
      try {
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

        const roleChangeMessageResult = await db.pool.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, sender_id, receiver_id, content, sent_at`,
          [userId, memberId, roleChangeMessage],
        );
        await emitInsertedMessage(req, roleChangeMessageResult.rows[0]);

        // Create notification for affected member
        await createNotification({
          userId: parseInt(memberId),
          type: "role_changed",
          title: `You were ${action} to ${new_role} in ${teamName}`,
          message: null,
          referenceType: "message",
          referenceId: roleChangeMessageResult.rows[0]?.id || parseInt(teamId),
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
        ...(process.env.NODE_ENV === "development" && { error: dbError.message }),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update member role error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating member role",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


module.exports = {
  addTeamMember,
  removeTeamMember,
  updateMemberRole,
};
