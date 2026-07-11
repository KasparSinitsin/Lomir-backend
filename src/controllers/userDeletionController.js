const db = require("../config/database");
const { pool } = db;
const bcrypt = require("bcrypt");
const { deleteImageKitFile } = require("../utils/imagekitUtils");
const {
  buildUserDisplayName,
  toIsoString,
} = require("../utils/user/userControllerHelpers");

const DELETED_USER_DISPLAY_NAME = "Former Lomir User";

const logDeletionPhase = (phase, details) => {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  if (details !== undefined) {
    console.log(`[deleteUser] ${phase}`, details);
    return;
  }

  console.log(`[deleteUser] ${phase}`);
};

const insertNotificationRecord = async (
  client,
  {
    userId,
    type,
    title,
    message = null,
    referenceType = null,
    referenceId = null,
    teamId = null,
    actorId = null,
  },
) => {
  await client.query(
    `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, team_id, actor_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      type,
      title,
      message,
      referenceType,
      referenceId,
      teamId,
      actorId,
    ],
  );
};

const getSuccessorCandidatesByTeam = async (queryable, teamIds, excludedUserId) => {
  if (teamIds.length === 0) {
    return new Map();
  }

  const result = await queryable.query(
    `
    SELECT
      tm.team_id,
      tm.user_id,
      tm.role,
      tm.joined_at,
      u.first_name,
      u.last_name,
      u.username
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ANY($1::int[])
      AND tm.user_id != $2
      AND tm.role IN ('admin', 'member')
    ORDER BY
      tm.team_id ASC,
      CASE
        WHEN tm.role = 'admin' THEN 0
        WHEN tm.role = 'member' THEN 1
        ELSE 2
      END,
      tm.joined_at ASC NULLS LAST,
      tm.user_id ASC
    `,
    [teamIds, excludedUserId],
  );

  const candidatesByTeamId = new Map();

  for (const row of result.rows) {
    const teamId = Number(row.team_id);
    const existingCandidates = candidatesByTeamId.get(teamId) || [];

    existingCandidates.push({
      userId: Number(row.user_id),
      name: buildUserDisplayName(row),
      role: row.role,
      joinedAt: toIsoString(row.joined_at),
    });

    candidatesByTeamId.set(teamId, existingCandidates);
  }

  return candidatesByTeamId;
};

/**
 * @description Delete a user's account
 * @route DELETE /api/users/:id
 * @access Private (Requires authentication and authorization)
 */
const deleteUser = async (req, res) => {
  let client = null;
  let transactionOpen = false;
  let avatarUrl = null;
  let avatarFileId = null;
  let teamIdsForSockets = [];
  let dmPartnerIds = [];
  let ownershipTransferEvents = [];
  let reopenedRoleEvents = [];

  try {
    const userId = parseInt(req.params.id, 10);
    const body = req.body || {};
    const { password } = body;
    // The frontend request interceptor serializes all request bodies to
    // snake_case, so the wire payload is `ownership_overrides` with `team_id` /
    // `successor_id`. Accept both casings so real requests AND direct/camelCase
    // callers (e.g. tests) work.
    const ownershipOverrides = body.ownershipOverrides ?? body.ownership_overrides ?? [];

    // Verify the user making the request is the same as the user being deleted
    if (Number(req.user.id) !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own account",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    if (!Array.isArray(ownershipOverrides)) {
      return res.status(400).json({
        success: false,
        message: "ownershipOverrides must be an array",
      });
    }

    const ownershipOverrideMap = new Map();

    for (const override of ownershipOverrides) {
      const teamId = Number(override?.teamId ?? override?.team_id);
      const successorId = Number(override?.successorId ?? override?.successor_id);

      if (!Number.isInteger(teamId) || !Number.isInteger(successorId)) {
        return res.status(400).json({
          success: false,
          message: "Each ownership override must include teamId and successorId",
        });
      }

      ownershipOverrideMap.set(teamId, successorId);
    }

    client = await db.pool.connect();

    const rollbackAndRespond = async (status, payload) => {
      if (transactionOpen) {
        await client.query("ROLLBACK");
        transactionOpen = false;
      }

      return res.status(status).json(payload);
    };

    await client.query("BEGIN");
    transactionOpen = true;

    logDeletionPhase("Phase A - gather context", { userId });

    const userResult = await client.query(
      `SELECT id, first_name, last_name, username, avatar_url, avatar_file_id, password_hash
       FROM users
       WHERE id = $1`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return rollbackAndRespond(404, {
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return rollbackAndRespond(401, {
        success: false,
        message: "Password is incorrect",
      });
    }

    avatarUrl = user.avatar_url;
    avatarFileId = user.avatar_file_id;

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const userDisplayName = fullName || user.username;

    const [
      membershipsResult,
      ownedTeamsResult,
      filledRolesResult,
      dmPartnersResult,
    ] = await Promise.all([
      client.query(
        `
        SELECT
          tm.team_id,
          tm.role,
          tm.joined_at,
          t.name AS team_name
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = $1
        ORDER BY t.name ASC, tm.team_id ASC
        `,
        [userId],
      ),
      client.query(
        `
        SELECT
          t.id AS team_id,
          t.name AS team_name,
          COUNT(tm_all.user_id)::int AS member_count,
          (COUNT(tm_all.user_id) FILTER (WHERE tm_all.user_id != $1))::int AS other_member_count
        FROM teams t
        JOIN team_members tm_owner
          ON tm_owner.team_id = t.id
         AND tm_owner.user_id = $1
         AND tm_owner.role = 'owner'
        JOIN team_members tm_all ON tm_all.team_id = t.id
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `,
        [userId],
      ),
      client.query(
        `
        SELECT
          vr.id AS role_id,
          vr.role_name,
          vr.team_id,
          t.name AS team_name
        FROM team_vacant_roles vr
        JOIN teams t ON t.id = vr.team_id
        WHERE vr.filled_by = $1
          AND vr.status = 'filled'
        ORDER BY t.name ASC, vr.role_name ASC, vr.id ASC
        `,
        [userId],
      ),
      client.query(
        `
        SELECT DISTINCT
          CASE
            WHEN sender_id = $1 THEN receiver_id
            ELSE sender_id
          END AS partner_id
        FROM messages
        WHERE team_id IS NULL
          AND (sender_id = $1 OR receiver_id = $1)
          AND (
            CASE
              WHEN sender_id = $1 THEN receiver_id
              ELSE sender_id
            END
          ) IS NOT NULL
        `,
        [userId],
      ),
    ]);

    const memberships = membershipsResult.rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      role: row.role,
      joinedAt: toIsoString(row.joined_at),
    }));

    const ownedTeams = ownedTeamsResult.rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      memberCount: Number(row.member_count),
      otherMemberCount: Number(row.other_member_count),
    }));

    const teamsToDelete = ownedTeams.filter((team) => team.otherMemberCount === 0);
    const teamsToTransfer = ownedTeams.filter((team) => team.otherMemberCount > 0);
    const teamsToTransferIdSet = new Set(
      teamsToTransfer.map((team) => team.teamId),
    );

    const invalidOverrideTeamIds = Array.from(ownershipOverrideMap.keys()).filter(
      (teamId) => !teamsToTransferIdSet.has(teamId),
    );

    if (invalidOverrideTeamIds.length > 0) {
      return rollbackAndRespond(400, {
        success: false,
        message:
          "Ownership overrides can only be provided for teams that require ownership transfer",
      });
    }

    const filledRoles = filledRolesResult.rows.map((row) => ({
      roleId: Number(row.role_id),
      roleName: row.role_name,
      teamId: Number(row.team_id),
      teamName: row.team_name,
    }));

    teamIdsForSockets = Array.from(
      new Set(memberships.map((membership) => membership.teamId)),
    );
    dmPartnerIds = dmPartnersResult.rows
      .map((row) => Number(row.partner_id))
      .filter((partnerId) => Number.isInteger(partnerId));

    logDeletionPhase("Phase B - messages and chat cleanup", {
      teamCount: memberships.length,
      dmPartnerCount: dmPartnerIds.length,
    });

    await client.query(
      `DELETE FROM messages
       WHERE (sender_id = $1 OR receiver_id = $1)
         AND team_id IS NULL`,
      [userId],
    );

    for (const membership of memberships) {
      await client.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          null,
          membership.teamId,
          `🚪 ${DELETED_USER_DISPLAY_NAME} has left Lomir.`,
        ],
      );
    }

    await client.query(
      `
      UPDATE messages
      SET content = CASE
        WHEN $2 <> ''
          THEN REPLACE(REPLACE(content, $2, 'Former Lomir User'), $3, 'Former Lomir User')
        ELSE REPLACE(content, $3, 'Former Lomir User')
      END
      WHERE sender_id = $1
        AND team_id IS NOT NULL
        AND (
          content LIKE '%👋%'
          OR content LIKE '%🚪%'
          OR content LIKE '%👑%'
          OR content LIKE '%🎯%'
          OR content LIKE '%✅%'
          OR content LIKE '%❌%'
          OR content LIKE '%🎉%'
          OR content LIKE '%🔓%'
        )
      `,
      [userId, fullName, user.username],
    );

    logDeletionPhase("Phase C - team ownership cleanup", {
      teamsToDelete: teamsToDelete.length,
      teamsToTransfer: teamsToTransfer.length,
    });

    const deletedTeamIds = new Set();

    for (const team of teamsToDelete) {
      const dissolutionTitle = `The team ${team.teamName} has been dissolved`;

      await client.query(
        `
        UPDATE badge_awards
        SET custom_team_name = (SELECT name FROM teams WHERE id = $1),
            team_id = NULL
        WHERE team_id = $1
          AND team_id IS NOT NULL
        `,
        [team.teamId],
      );

      const pendingApplicantsResult = await client.query(
        `
        SELECT DISTINCT applicant_id
        FROM team_applications
        WHERE team_id = $1
          AND status = 'pending'
        `,
        [team.teamId],
      );

      for (const applicant of pendingApplicantsResult.rows) {
        await insertNotificationRecord(client, {
          userId: Number(applicant.applicant_id),
          type: "team_dissolved",
          title: dissolutionTitle,
          actorId: userId,
        });
      }

      const pendingInviteesResult = await client.query(
        `
        SELECT DISTINCT invitee_id
        FROM team_invitations
        WHERE team_id = $1
          AND status = 'pending'
        `,
        [team.teamId],
      );

      for (const invitee of pendingInviteesResult.rows) {
        await insertNotificationRecord(client, {
          userId: Number(invitee.invitee_id),
          type: "team_dissolved",
          title: dissolutionTitle,
          actorId: userId,
        });
      }

      await client.query("DELETE FROM team_invitations WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM team_applications WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM messages WHERE team_id = $1", [team.teamId]);
      await client.query(
        `
        DELETE FROM notifications
        WHERE team_id = $1
          AND reference_type IN ('team_member', 'team_application', 'team_invitation')
        `,
        [team.teamId],
      );
      await client.query(
        `
        DELETE FROM team_vacant_role_tags
        WHERE role_id IN (
          SELECT id FROM team_vacant_roles WHERE team_id = $1
        )
        `,
        [team.teamId],
      );
      await client.query(
        `
        DELETE FROM team_vacant_role_badges
        WHERE role_id IN (
          SELECT id FROM team_vacant_roles WHERE team_id = $1
        )
        `,
        [team.teamId],
      );
      await client.query("DELETE FROM team_vacant_roles WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM team_tags WHERE team_id = $1", [team.teamId]);
      await client.query("DELETE FROM team_members WHERE team_id = $1", [
        team.teamId,
      ]);
      await client.query("DELETE FROM teams WHERE id = $1", [team.teamId]);

      deletedTeamIds.add(team.teamId);
    }

    const successorCandidatesByTeam = await getSuccessorCandidatesByTeam(
      client,
      teamsToTransfer.map((team) => team.teamId),
      userId,
    );

    for (const team of teamsToTransfer) {
      const overrideSuccessorId = ownershipOverrideMap.get(team.teamId);
      const candidates = successorCandidatesByTeam.get(team.teamId) || [];

      let successor = null;

      if (overrideSuccessorId !== undefined) {
        successor = candidates.find(
          (candidate) => candidate.userId === overrideSuccessorId,
        );

        if (!successor) {
          return rollbackAndRespond(400, {
            success: false,
            message: `Invalid ownership override for team ${team.teamName}`,
          });
        }
      } else {
        successor = candidates[0] || null;
      }

      if (!successor) {
        throw new Error(`No successor candidate found for team ${team.teamId}`);
      }

      await client.query(
        `
        UPDATE team_members
        SET role = 'owner'
        WHERE team_id = $1
          AND user_id = $2
        `,
        [team.teamId, successor.userId],
      );

      await client.query(
        `
        UPDATE teams
        SET owner_id = $1
        WHERE id = $2
        `,
        [successor.userId, team.teamId],
      );

      await insertNotificationRecord(client, {
        userId: successor.userId,
        type: "ownership_transferred",
        title: `You are now the owner of ${team.teamName}`,
        referenceType: "team_member",
        referenceId: team.teamId,
        teamId: team.teamId,
        actorId: userId,
      });

      await client.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          null,
          team.teamId,
          `👑 OWNERSHIP_TEAM: ${DELETED_USER_DISPLAY_NAME} | ${successor.name}`,
        ],
      );

      ownershipTransferEvents.push({
        successorId: successor.userId,
        teamId: team.teamId,
      });
    }

    logDeletionPhase("Phase D - role and reference cleanup", {
      filledRoleCount: filledRoles.length,
    });

    const reopenedRoles = filledRoles.filter(
      (role) => !deletedTeamIds.has(role.teamId),
    );

    await client.query(
      `
      UPDATE team_vacant_roles
      SET status = 'open',
          filled_by = NULL,
          updated_at = NOW()
      WHERE filled_by = $1
      `,
      [userId],
    );

    if (reopenedRoles.length > 0) {
      const reopenedTeamIds = Array.from(
        new Set(reopenedRoles.map((role) => role.teamId)),
      );

      const roleRecipientsResult = await client.query(
        `
        SELECT team_id, user_id
        FROM team_members
        WHERE team_id = ANY($1::int[])
          AND role IN ('owner', 'admin')
          AND user_id != $2
        ORDER BY team_id ASC, user_id ASC
        `,
        [reopenedTeamIds, userId],
      );

      const roleRecipientsByTeamId = new Map();

      for (const row of roleRecipientsResult.rows) {
        const teamId = Number(row.team_id);
        const currentRecipients = roleRecipientsByTeamId.get(teamId) || [];
        currentRecipients.push(Number(row.user_id));
        roleRecipientsByTeamId.set(teamId, currentRecipients);
      }

      for (const role of reopenedRoles) {
        await client.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())`,
          [null, role.teamId, `🔓 The role ${role.roleName} is now open again.`],
        );

        const recipients = roleRecipientsByTeamId.get(role.teamId) || [];

        for (const recipientId of recipients) {
          await insertNotificationRecord(client, {
            userId: recipientId,
            type: "role_reopened",
            title: `The role ${role.roleName} is now open again in ${role.teamName}`,
            teamId: role.teamId,
            actorId: userId,
          });
        }

        reopenedRoleEvents.push({
          teamId: role.teamId,
        });
      }
    }

    await client.query(
      `UPDATE team_vacant_roles SET created_by = NULL WHERE created_by = $1`,
      [userId],
    );
    await client.query(
      `UPDATE team_applications SET reviewed_by = NULL WHERE reviewed_by = $1`,
      [userId],
    );
    await client.query(
      `UPDATE user_badges SET awarded_by = NULL WHERE awarded_by = $1`,
      [userId],
    );
    await client.query(`UPDATE tags SET created_by = NULL WHERE created_by = $1`, [
      userId,
    ]);
    await client.query(
      `UPDATE messages SET deleted_by = NULL WHERE deleted_by = $1`,
      [userId],
    );
    await client.query(
      `
      UPDATE notifications
      SET reference_id = NULL
      WHERE actor_id = $1
        AND reference_type IN ('team_invitation', 'team_application', 'badge_award')
      `,
      [userId],
    );

    logDeletionPhase("Phase E - delete user row", { userId });

    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    transactionOpen = false;

    logDeletionPhase("Phase F - post-transaction cleanup", {
      teamEventCount: teamIdsForSockets.length,
      dmPartnerCount: dmPartnerIds.length,
    });

    try {
      if (avatarUrl || avatarFileId) {
        await deleteImageKitFile(avatarUrl, avatarFileId);
      }

      const io =
        req.app && typeof req.app.get === "function" ? req.app.get("io") : null;

      if (io) {
        for (const teamId of teamIdsForSockets) {
          io.to(`team:${teamId}`).emit("team:member_left", { teamId, userId });
        }

        for (const partnerId of dmPartnerIds) {
          io.to(`user:${partnerId}`).emit("conversation:deleted", {
            partnerId: userId,
          });
        }

        for (const event of ownershipTransferEvents) {
          io.to(`user:${event.successorId}`).emit("notification:new", {
            type: "ownership_transferred",
            teamId: event.teamId,
          });
        }

        for (const event of reopenedRoleEvents) {
          io.to(`team:${event.teamId}`).emit("notification:new", {
            type: "role_reopened",
            teamId: event.teamId,
          });
        }
      }
    } catch (postCommitError) {
      console.error("Error during post-transaction user deletion cleanup:", postCommitError);
    }

    return res.status(200).json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Error rolling back user deletion:", rollbackError);
      }
    }

    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting user",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * @description Preview the impact of deleting a user's account
 * @route POST /api/users/:id/deletion-preview
 * @access Private (Requires authentication and password verification)
 */
const deletionPreview = async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { password } = req.body;

    if (Number(req.user.id) !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can only preview deletion for your own account",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    const userResult = await pool.query(
      "SELECT id, password_hash FROM users WHERE id = $1",
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      userResult.rows[0].password_hash,
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Password is incorrect",
      });
    }

    const [
      ownedTeamsResult,
      rolesToReopenResult,
      badgeAwardsGivenResult,
      teamMembershipsResult,
      directMessagesResult,
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          t.id AS team_id,
          t.name AS team_name,
          COUNT(tm_all.user_id)::int AS member_count,
          (COUNT(tm_all.user_id) FILTER (WHERE tm_all.user_id != $1))::int AS other_member_count
        FROM teams t
        JOIN team_members tm_owner
          ON tm_owner.team_id = t.id
         AND tm_owner.user_id = $1
         AND tm_owner.role = 'owner'
        JOIN team_members tm_all ON tm_all.team_id = t.id
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT
          vr.id AS role_id,
          vr.role_name,
          vr.team_id,
          t.name AS team_name
        FROM team_vacant_roles vr
        JOIN teams t ON t.id = vr.team_id
        WHERE vr.filled_by = $1
          AND vr.status = 'filled'
        ORDER BY t.name ASC, vr.role_name ASC, vr.id ASC
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM badge_awards
        WHERE awarded_by_user_id = $1
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM team_members
        WHERE user_id = $1
        `,
        [userId],
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM messages
        WHERE (sender_id = $1 OR receiver_id = $1)
          AND team_id IS NULL
        `,
        [userId],
      ),
    ]);

    const ownedTeams = ownedTeamsResult.rows;
    const teamIdsToTransfer = ownedTeams
      .filter((team) => Number(team.other_member_count) > 0)
      .map((team) => Number(team.team_id));

    let successorByTeamId = new Map();

    if (teamIdsToTransfer.length > 0) {
      const successorsResult = await pool.query(
        `
        SELECT
          ranked.team_id,
          ranked.user_id,
          ranked.role,
          ranked.joined_at,
          ranked.first_name,
          ranked.last_name,
          ranked.username
        FROM (
          SELECT
            tm.team_id,
            tm.user_id,
            tm.role,
            tm.joined_at,
            u.first_name,
            u.last_name,
            u.username,
            ROW_NUMBER() OVER (
              PARTITION BY tm.team_id
              ORDER BY
                CASE
                  WHEN tm.role = 'admin' THEN 0
                  WHEN tm.role = 'member' THEN 1
                  ELSE 2
                END,
                tm.joined_at ASC NULLS LAST,
                tm.user_id ASC
            ) AS row_number
          FROM team_members tm
          JOIN users u ON u.id = tm.user_id
          WHERE tm.team_id = ANY($1::int[])
            AND tm.user_id != $2
            AND tm.role IN ('admin', 'member')
        ) ranked
        WHERE ranked.row_number = 1
        `,
        [teamIdsToTransfer, userId],
      );

      successorByTeamId = new Map(
        successorsResult.rows.map((row) => [
          Number(row.team_id),
          {
            userId: Number(row.user_id),
            name: buildUserDisplayName(row),
            role: row.role,
            joinedAt: toIsoString(row.joined_at),
          },
        ]),
      );
    }

    const teamsToDelete = [];
    const teamsToTransfer = [];

    for (const team of ownedTeams) {
      const teamId = Number(team.team_id);
      const memberCount = Number(team.member_count);
      const otherMemberCount = Number(team.other_member_count);

      if (otherMemberCount === 0) {
        teamsToDelete.push({
          teamId,
          teamName: team.team_name,
        });
        continue;
      }

      const successor = successorByTeamId.get(teamId);

      if (!successor) {
        throw new Error(`No successor candidate found for team ${teamId}`);
      }

      teamsToTransfer.push({
        teamId,
        teamName: team.team_name,
        successor,
        memberCount,
      });
    }

    const rolesToReopen = rolesToReopenResult.rows.map((row) => ({
      roleId: Number(row.role_id),
      roleName: row.role_name,
      teamId: Number(row.team_id),
      teamName: row.team_name,
    }));

    res.status(200).json({
      success: true,
      data: {
        teamsToTransfer,
        teamsToDelete,
        rolesToReopen,
        counts: {
          badgeAwardsGiven: Number(badgeAwardsGivenResult.rows[0].count),
          teamMemberships: Number(teamMembershipsResult.rows[0].count),
          directMessages: Number(directMessagesResult.rows[0].count),
        },
      },
    });
  } catch (error) {
    console.error("Error generating deletion preview:", error);
    res.status(500).json({
      success: false,
      message: "Error generating deletion preview",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  deleteUser,
  deletionPreview,
};
