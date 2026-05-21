const db = require("../config/database");
const {
  createNotification,
  notifyTeamMembers,
} = require("./notificationController");
const { computeDistanceScore, WEIGHTS } = require("./matchingController");
const { serializeEmbeddedVacantRole } = require("../utils/vacantRoleSerializer");
const { emitInsertedMessage } = require("../utils/socketMessageEmitter");

const buildRoleReopenedMessage = ({
  teamId,
  teamName,
  roleId,
  roleName,
  userId,
  userName,
}) =>
  `🔓 ROLE_REOPENED: ${teamId}:${teamName || "your team"} | ${roleId}:${roleName || "Vacant Role"} | ${userId}:${userName || "Someone"}`;

const buildRoleInvitationFilledMessage = ({
  teamId,
  teamName,
  roleId,
  roleName,
  userId,
  userName,
}) =>
  `✅ ROLE_INVITATION_FILLED: ${teamId}:${teamName || "your team"} | ${roleId}:${roleName || "Vacant Role"} | ${userId}:${userName || "Someone"}`;

/**
 * Send a team invitation to a user
 */
const sendTeamInvitation = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const inviterId = req.user.id;
    const { inviteeId, invitee_id, roleId, role_id, message = "" } = req.body;
    const finalInviteeId = inviteeId || invitee_id;
    const rawRoleId = roleId ?? role_id ?? null;
    const hasRoleId =
      rawRoleId !== undefined && rawRoleId !== null && rawRoleId !== "";
    const finalRoleId = hasRoleId ? Number(rawRoleId) : null;

    if (!finalInviteeId) {
      return res.status(400).json({
        success: false,
        message: "Invitee ID is required",
      });
    }

    if (hasRoleId && (!Number.isInteger(finalRoleId) || finalRoleId <= 0)) {
      return res.status(400).json({
        success: false,
        message: "roleId must be a positive integer when provided",
      });
    }

    // Check if team exists and is not archived
    const teamCheck = await db.pool.query(
      `SELECT id, name, max_members FROM teams WHERE id = $1 AND archived_at IS NULL`,
      [teamId],
    );

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamCheck.rows[0];

    // Check if inviter is owner or admin
    const inviterRoleCheck = await db.pool.query(
      `SELECT role FROM team_members 
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, inviterId],
    );

    if (inviterRoleCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Only team owners and admins can send invitations",
      });
    }

    if (finalRoleId !== null) {
      const roleCheck = await db.pool.query(
        `SELECT id, status, role_name
         FROM team_vacant_roles
         WHERE id = $1 AND team_id = $2`,
        [finalRoleId, teamId],
      );

      if (roleCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Vacant role not found for this team",
        });
      }

      if (roleCheck.rows[0].status !== "open") {
        return res.status(400).json({
          success: false,
          message: "Vacant role is no longer open",
        });
      }

      // Store role name for notifications
      var roleName = roleCheck.rows[0].role_name;
    }

    // Check if invitee exists
    const inviteeCheck = await db.pool.query(
      `SELECT id, username FROM users WHERE id = $1`,
      [finalInviteeId],
    );

    if (inviteeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if invitee is already a team member
    const memberCheck = await db.pool.query(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, finalInviteeId],
    );

    const isInternalInvite = memberCheck.rows.length > 0;

    if (isInternalInvite && !finalRoleId) {
      return res.status(400).json({
        success: false,
        message: "User is already a member of this team",
      });
    }

    if (!isInternalInvite) {
      // Check if team is full
      const memberCount = await db.pool.query(
        `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
        [teamId],
      );

      if (
        team.max_members !== null &&
        parseInt(memberCount.rows[0].count) >= team.max_members
      ) {
        return res.status(400).json({
          success: false,
          message: "Team is already at maximum capacity",
        });
      }
    }

    // Check if there's already a pending invitation (scope differs for internal vs external)
    if (isInternalInvite) {
      // For internal role invites, only block if there's already a pending invite for the same role
      const existingRoleInvitation = await db.pool.query(
        `SELECT id FROM team_invitations
         WHERE team_id = $1 AND invitee_id = $2 AND role_id = $3 AND status = 'pending'`,
        [teamId, finalInviteeId, finalRoleId],
      );

      if (existingRoleInvitation.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "A pending invitation for this role already exists for this member",
        });
      }
    } else {
      const existingInvitation = await db.pool.query(
        `SELECT id FROM team_invitations
         WHERE team_id = $1 AND invitee_id = $2 AND status = 'pending'`,
        [teamId, finalInviteeId],
      );

      if (existingInvitation.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "An invitation is already pending for this user",
        });
      }
    }

    // Remove any previous invitations that were accepted/declined/canceled
    await db.pool.query(
      `DELETE FROM team_invitations
   WHERE team_id = $1 AND invitee_id = $2 AND status != 'pending'`,
      [teamId, finalInviteeId],
    );

    if (!isInternalInvite) {
      // Check if user has a pending application
      const existingApplication = await db.pool.query(
        `SELECT id FROM team_applications
         WHERE team_id = $1 AND applicant_id = $2 AND status = 'pending'`,
        [teamId, finalInviteeId],
      );

      if (existingApplication.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "This user already has a pending application for this team.",
        });
      }
    }

    // Create the invitation
    const invitationResult = await db.pool.query(
      `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, message, status, role_id, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())
       RETURNING id`,
      [teamId, inviterId, finalInviteeId, message.trim(), finalRoleId],
    );

    // === CREATE NOTIFICATION FOR INVITEE ===
    try {
      // Get inviter's name
      const inviterResult = await db.pool.query(
        `SELECT first_name, last_name, username FROM users WHERE id = $1`,
        [inviterId],
      );
      const inviter = inviterResult.rows[0];
      const inviterName =
        inviter.first_name && inviter.last_name
          ? `${inviter.first_name} ${inviter.last_name}`
          : inviter.username;

      const io = req.app.get("io");

      if (isInternalInvite) {
        await createNotification({
          userId: finalInviteeId,
          type: "role_invitation",
          title: `You've been invited to fill the role '${roleName}' in ${team.name}`,
          message: message || null,
          referenceType: "team_invitation",
          referenceId: invitationResult.rows[0].id,
          teamId: parseInt(teamId),
          actorId: inviterId,
        });

        if (io) {
          io.to(`user:${finalInviteeId}`).emit("notification:new", {
            type: "role_invitation",
            teamId: parseInt(teamId),
            roleId: finalRoleId,
            title: `You've been invited to fill the role '${roleName}' in ${team.name}`,
            actorName: inviterName,
          });
        }
      } else {
        await createNotification({
          userId: finalInviteeId,
          type: "invitation_received",
          title: `${inviterName} invited you to join ${team.name}`,
          message: message || null,
          referenceType: "team_invitation",
          referenceId: invitationResult.rows[0].id,
          teamId: parseInt(teamId),
          actorId: inviterId,
        });

        if (io) {
          io.to(`user:${finalInviteeId}`).emit("notification:new", {
            type: "invitation_received",
            teamId: parseInt(teamId),
            title: finalRoleId && roleName
              ? `You've been invited to join ${team.name} as ${roleName}!`
              : `You've been invited to join ${team.name}!`,
            actorName: inviterName,
            ...(finalRoleId && roleName ? { roleName } : {}),
          });
        }
      }

      if (io) {
        io.to(`team:${teamId}`).emit("notification:updated", {
          type: isInternalInvite ? "role_invitation_sent" : "invitation_sent",
          notificationType: isInternalInvite ? "role_invitation" : "invitation_received",
          teamId: parseInt(teamId),
          invitationId: invitationResult.rows[0].id,
          roleId: finalRoleId,
        });
      }
    } catch (notificationError) {
      console.error(
        "Error creating invitation notification:",
        notificationError,
      );
      // Don't fail the invitation if notification fails
    }
    // === END NOTIFICATION ===

    res.status(201).json({
      success: true,
      message: "Invitation sent successfully",
      data: {
        invitationId: invitationResult.rows[0].id,
      },
    });
  } catch (error) {
    console.error("Error sending team invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error sending invitation",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Get all pending invitations for the current user
 */
const getUserReceivedInvitations = async (req, res) => {
  try {
    const userId = req.user.id;

    const invitationsResult = await db.pool.query(
      `SELECT
        ti.id, ti.message, ti.status, ti.created_at, ti.role_id,
        t.id as team_id, t.name as team_name, t.description as team_description,
        t.teamavatar_url, t.max_members, t.is_public, t.is_synthetic as team_is_synthetic,
        t.latitude, t.longitude, t.is_remote, t.city, t.country, t.state, t.postal_code,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as current_members_count,
        vr.role_name,
        vr.bio as role_bio,
        vr.city as role_city, vr.country as role_country, vr.state as role_state,
        vr.is_remote as role_is_remote,
        vr.latitude as role_latitude, vr.longitude as role_longitude,
        vr.max_distance_km as role_max_distance_km,
        vr.status as role_status, vr.is_synthetic as role_is_synthetic,
        filled_role.id as current_filled_role_id,
        filled_role.role_name as current_filled_role_name,
        u.id as inviter_id, u.username as inviter_username,
        u.first_name as inviter_first_name, u.last_name as inviter_last_name,
        u.avatar_url as inviter_avatar_url,
        EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = t.id AND tm.user_id = $1
        ) as is_internal
       FROM team_invitations ti
       JOIN teams t ON ti.team_id = t.id
       LEFT JOIN team_vacant_roles vr ON ti.role_id = vr.id
       LEFT JOIN LATERAL (
         SELECT id, role_name
         FROM team_vacant_roles
         WHERE team_id = ti.team_id
           AND filled_by = $1
           AND status = 'filled'
           AND (ti.role_id IS NULL OR id <> ti.role_id)
         ORDER BY updated_at DESC
         LIMIT 1
       ) filled_role ON true
       JOIN users u ON ti.inviter_id = u.id
       WHERE ti.invitee_id = $1
       AND ti.status = 'pending'
       AND t.archived_at IS NULL
       ORDER BY ti.created_at DESC`,
      [userId],
    );

    if (invitationsResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const teamIds = [...new Set(
      invitationsResult.rows.map((r) => r.team_id).filter(Boolean)
    )];

    const roleIds = [...new Set(
      invitationsResult.rows.map((r) => r.role_id).filter(Boolean)
    )];

    let teamTagsByTeamId = {};
    let teamBadgesByTeamId = {};
    let roleTagsByRole = {};
    let roleBadgesByRole = {};
    let currentUserTags = new Set();
    let currentUserBadges = new Set();
    let currentUserLat = null;
    let currentUserLng = null;

    const [
      teamTagsResult,
      teamBadgesResult,
      roleTagsResult,
      roleBadgesResult,
      userLocationResult,
      userTagsResult,
      userBadgesResult,
    ] = await Promise.all([
      db.pool.query(
        `SELECT tt.team_id, t.id AS tag_id, t.name, t.category, t.supercategory
         FROM team_tags tt
         JOIN tags t ON tt.tag_id = t.id
         WHERE tt.team_id = ANY($1::int[])
         ORDER BY t.supercategory, t.category, t.name`,
        [teamIds]
      ),
      db.pool.query(
        `SELECT DISTINCT tm.team_id, b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
         FROM team_members tm
         JOIN badge_awards ba ON ba.awarded_to_user_id = tm.user_id
         JOIN badges b ON ba.badge_id = b.id
         WHERE tm.team_id = ANY($1::int[])
         ORDER BY tm.team_id, b.category, b.name`,
        [teamIds]
      ),
      roleIds.length > 0
        ? db.pool.query(
            `SELECT vrt.role_id, t.id AS tag_id, t.name, t.category, t.supercategory
             FROM team_vacant_role_tags vrt
             JOIN tags t ON vrt.tag_id = t.id
             WHERE vrt.role_id = ANY($1)
             ORDER BY t.supercategory, t.category, t.name`,
            [roleIds]
          )
        : Promise.resolve({ rows: [] }),
      roleIds.length > 0
        ? db.pool.query(
            `SELECT vrb.role_id, b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
             FROM team_vacant_role_badges vrb
             JOIN badges b ON vrb.badge_id = b.id
             WHERE vrb.role_id = ANY($1)
             ORDER BY b.category, b.name`,
            [roleIds]
          )
        : Promise.resolve({ rows: [] }),
      roleIds.length > 0
        ? db.pool.query(
            `SELECT latitude, longitude FROM users WHERE id = $1`,
            [userId]
          )
        : Promise.resolve({ rows: [] }),
      roleIds.length > 0
        ? db.pool.query(
            `SELECT tag_id FROM user_tags WHERE user_id = $1`,
            [userId]
          )
        : Promise.resolve({ rows: [] }),
      roleIds.length > 0
        ? db.pool.query(
            `SELECT DISTINCT badge_id FROM badge_awards WHERE awarded_to_user_id = $1`,
            [userId]
          )
        : Promise.resolve({ rows: [] }),
    ]);

    for (const tag of teamTagsResult.rows) {
      if (!teamTagsByTeamId[tag.team_id]) teamTagsByTeamId[tag.team_id] = [];
      teamTagsByTeamId[tag.team_id].push({
        id: tag.tag_id,
        name: tag.name,
        category: tag.category,
        supercategory: tag.supercategory,
      });
    }
    for (const badge of teamBadgesResult.rows) {
      if (!teamBadgesByTeamId[badge.team_id]) teamBadgesByTeamId[badge.team_id] = [];
      teamBadgesByTeamId[badge.team_id].push({
        id: badge.badge_id,
        name: badge.name,
        category: badge.category,
        color: badge.color,
        image_url: badge.image_url,
        cat_image_url: badge.cat_image_url,
      });
    }

    for (const tag of roleTagsResult.rows) {
      if (!roleTagsByRole[tag.role_id]) roleTagsByRole[tag.role_id] = [];
      roleTagsByRole[tag.role_id].push(tag);
    }
    for (const badge of roleBadgesResult.rows) {
      if (!roleBadgesByRole[badge.role_id]) roleBadgesByRole[badge.role_id] = [];
      roleBadgesByRole[badge.role_id].push(badge);
    }
    if (userLocationResult.rows.length > 0) {
      currentUserLat = userLocationResult.rows[0].latitude;
      currentUserLng = userLocationResult.rows[0].longitude;
    }
    for (const row of userTagsResult.rows) {
      currentUserTags.add(row.tag_id);
    }
    for (const row of userBadgesResult.rows) {
      currentUserBadges.add(row.badge_id);
    }

    const invitations = invitationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      role_id: row.role_id === null ? null : parseInt(row.role_id),
      role_name: row.role_name,
      current_filled_role_id:
        row.current_filled_role_id === null || row.current_filled_role_id === undefined
          ? null
          : parseInt(row.current_filled_role_id),
      current_filled_role_name: row.current_filled_role_name ?? null,
      currentFilledRole:
        row.current_filled_role_id == null
          ? null
          : {
              id: parseInt(row.current_filled_role_id),
              roleName: row.current_filled_role_name,
              role_name: row.current_filled_role_name,
            },
      role: row.role_id
        ? (() => {
            const roleTags = roleTagsByRole[row.role_id] || [];
            const roleBadges = roleBadgesByRole[row.role_id] || [];
            const roleTagIds = roleTags.map((t) => t.tag_id);
            const roleBadgeIds = roleBadges.map((b) => b.badge_id);

            const tagScore = roleTagIds.length > 0
              ? roleTagIds.filter((id) => currentUserTags.has(id)).length / roleTagIds.length
              : 0.5;

            const badgeScore = roleBadgeIds.length > 0
              ? roleBadgeIds.filter((id) => currentUserBadges.has(id)).length / roleBadgeIds.length
              : 0.5;

            const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
              isRemote: row.role_is_remote,
              userLat: currentUserLat,
              userLng: currentUserLng,
              roleLat: row.role_latitude,
              roleLng: row.role_longitude,
              maxDistKm: row.role_max_distance_km,
            });

            const matchScore =
              WEIGHTS.tags * tagScore +
              WEIGHTS.badges * badgeScore +
              WEIGHTS.distance * distanceScore;

            return serializeEmbeddedVacantRole(row, {
              tags: roleTags,
              badges: roleBadges,
              match_score: Math.round(matchScore * 100) / 100,
              match_details: {
                tag_score: Math.round(tagScore * 100) / 100,
                badge_score: Math.round(badgeScore * 100) / 100,
                distance_score: Math.round(distanceScore * 100) / 100,
                matching_tags: roleTagIds.filter((id) => currentUserTags.has(id)).length,
                total_required_tags: roleTagIds.length,
                matching_badges: roleBadgeIds.filter((id) => currentUserBadges.has(id)).length,
                total_required_badges: roleBadgeIds.length,
                distance_km: distanceKm !== null ? Math.round(distanceKm) : null,
                max_distance_km: row.role_max_distance_km,
                is_within_range: isWithinRange,
              },
            });
          })()
        : null,
      team: {
        id: row.team_id,
        name: row.team_name,
        description: row.team_description,
        teamavatar_url: row.teamavatar_url,
        max_members: row.max_members,
        is_public: row.is_public === true || row.is_public === "true",
        is_synthetic: row.team_is_synthetic === true,
        current_members_count: parseInt(row.current_members_count),
        latitude: row.latitude,
        longitude: row.longitude,
        is_remote: row.is_remote,
        city: row.city,
        country: row.country,
        state: row.state,
        postal_code: row.postal_code,
        tags: teamTagsByTeamId[row.team_id] || [],
        badges: teamBadgesByTeamId[row.team_id] || [],
      },
      inviter: {
        id: row.inviter_id,
        username: row.inviter_username,
        first_name: row.inviter_first_name,
        last_name: row.inviter_last_name,
        avatar_url: row.inviter_avatar_url,
      },
      is_internal: row.is_internal === true || row.is_internal === "true",
    }));

    res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("Error fetching user invitations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching invitations",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Get all pending invitations sent by a team
 */
const getTeamSentInvitations = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const userId = req.user.id;

    // Check if user is authorized (owner or admin)
    const authCheck = await db.pool.query(
      `SELECT role FROM team_members 
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view team invitations",
      });
    }

    const invitationsResult = await db.pool.query(
      `SELECT
    ti.id, ti.message, ti.status, ti.created_at, ti.role_id,
    vr.role_name,
    vr.bio as role_bio,
    vr.city as role_city, vr.country as role_country, vr.state as role_state,
    vr.is_remote as role_is_remote,
    vr.latitude as role_latitude, vr.longitude as role_longitude,
    vr.max_distance_km as role_max_distance_km,
    vr.status as role_status, vr.is_synthetic as role_is_synthetic,
    filled_role.id as current_filled_role_id,
    filled_role.role_name as current_filled_role_name,
    u.id as invitee_id, u.username, u.first_name, u.last_name,
    u.avatar_url, u.bio, u.postal_code, u.city, u.country, u.state, u.is_synthetic as invitee_is_synthetic,
    u.latitude as invitee_latitude, u.longitude as invitee_longitude,
    inv.id as inviter_id,
    inv.username as inviter_username,
    inv.first_name as inviter_first_name,
    inv.last_name as inviter_last_name,
    inv.avatar_url as inviter_avatar_url,
    EXISTS (
      SELECT 1 FROM team_members tm
      WHERE tm.team_id = ti.team_id AND tm.user_id = ti.invitee_id
    ) as is_internal
   FROM team_invitations ti
   LEFT JOIN team_vacant_roles vr ON ti.role_id = vr.id
   LEFT JOIN LATERAL (
     SELECT id, role_name
     FROM team_vacant_roles
     WHERE team_id = ti.team_id
       AND filled_by = ti.invitee_id
       AND status = 'filled'
       AND (ti.role_id IS NULL OR id <> ti.role_id)
     ORDER BY updated_at DESC
     LIMIT 1
   ) filled_role ON true
   JOIN users u ON ti.invitee_id = u.id
   JOIN users inv ON ti.inviter_id = inv.id
   WHERE ti.team_id = $1 AND ti.status = 'pending'
   ORDER BY ti.created_at DESC`,
      [teamId],
    );

    // Batch-fetch role tags and badges for role-linked invitations
    const roleIds = [...new Set(
      invitationsResult.rows.map((r) => r.role_id).filter(Boolean)
    )];

    let roleTagsByRole = {};
    let roleBadgesByRole = {};

    if (roleIds.length > 0) {
      const [roleTagsResult, roleBadgesResult] = await Promise.all([
        db.pool.query(
          `SELECT vrt.role_id, t.id AS tag_id, t.name, t.category, t.supercategory
           FROM team_vacant_role_tags vrt
           JOIN tags t ON vrt.tag_id = t.id
           WHERE vrt.role_id = ANY($1)
           ORDER BY t.supercategory, t.category, t.name`,
          [roleIds]
        ),
        db.pool.query(
          `SELECT vrb.role_id, b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
           FROM team_vacant_role_badges vrb
           JOIN badges b ON vrb.badge_id = b.id
           WHERE vrb.role_id = ANY($1)
           ORDER BY b.category, b.name`,
          [roleIds]
        ),
      ]);

      for (const tag of roleTagsResult.rows) {
        if (!roleTagsByRole[tag.role_id]) roleTagsByRole[tag.role_id] = [];
        roleTagsByRole[tag.role_id].push(tag);
      }
      for (const badge of roleBadgesResult.rows) {
        if (!roleBadgesByRole[badge.role_id]) roleBadgesByRole[badge.role_id] = [];
        roleBadgesByRole[badge.role_id].push(badge);
      }
    }

    // Batch-fetch invitee tags and badges for match scoring
    const inviteeIds = [...new Set(
      invitationsResult.rows
        .filter((r) => r.role_id)
        .map((r) => r.invitee_id)
    )];

    let inviteeTagsByUser = {};
    let inviteeBadgesByUser = {};

    if (inviteeIds.length > 0 && roleIds.length > 0) {
      const [inviteeTagsResult, inviteeBadgesResult] = await Promise.all([
        db.pool.query(
          `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
          [inviteeIds]
        ),
        db.pool.query(
          `SELECT DISTINCT ba.awarded_to_user_id AS user_id, ba.badge_id
           FROM badge_awards ba
           WHERE ba.awarded_to_user_id = ANY($1)`,
          [inviteeIds]
        ),
      ]);

      for (const row of inviteeTagsResult.rows) {
        if (!inviteeTagsByUser[row.user_id]) inviteeTagsByUser[row.user_id] = new Set();
        inviteeTagsByUser[row.user_id].add(row.tag_id);
      }
      for (const row of inviteeBadgesResult.rows) {
        if (!inviteeBadgesByUser[row.user_id]) inviteeBadgesByUser[row.user_id] = new Set();
        inviteeBadgesByUser[row.user_id].add(row.badge_id);
      }
    }

    const invitations = invitationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      role_id: row.role_id === null ? null : parseInt(row.role_id),
      role_name: row.role_name,
      role: row.role_id
        ? (() => {
            const roleTags = roleTagsByRole[row.role_id] || [];
            const roleBadges = roleBadgesByRole[row.role_id] || [];
            const roleTagIds = roleTags.map((t) => t.tag_id);
            const roleBadgeIds = roleBadges.map((b) => b.badge_id);

            const userTags = inviteeTagsByUser[row.invitee_id] || new Set();
            const userBadges = inviteeBadgesByUser[row.invitee_id] || new Set();

            const tagScore = roleTagIds.length > 0
              ? roleTagIds.filter((id) => userTags.has(id)).length / roleTagIds.length
              : 0.5;

            const badgeScore = roleBadgeIds.length > 0
              ? roleBadgeIds.filter((id) => userBadges.has(id)).length / roleBadgeIds.length
              : 0.5;

            const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
              isRemote: row.role_is_remote,
              userLat: row.invitee_latitude,
              userLng: row.invitee_longitude,
              roleLat: row.role_latitude,
              roleLng: row.role_longitude,
              maxDistKm: row.role_max_distance_km,
            });

            const matchScore =
              WEIGHTS.tags * tagScore +
              WEIGHTS.badges * badgeScore +
              WEIGHTS.distance * distanceScore;

            return serializeEmbeddedVacantRole(row, {
              tags: roleTags,
              badges: roleBadges,
              match_score: Math.round(matchScore * 100) / 100,
              match_details: {
                tag_score: Math.round(tagScore * 100) / 100,
                badge_score: Math.round(badgeScore * 100) / 100,
                distance_score: Math.round(distanceScore * 100) / 100,
                matching_tags: roleTagIds.filter((id) => userTags.has(id)).length,
                total_required_tags: roleTagIds.length,
                matching_badges: roleBadgeIds.filter((id) => userBadges.has(id)).length,
                total_required_badges: roleBadgeIds.length,
                distance_km: distanceKm !== null ? Math.round(distanceKm) : null,
                max_distance_km: row.role_max_distance_km,
                is_within_range: isWithinRange,
              },
            });
          })()
        : null,
      invitee: {
        id: row.invitee_id,
        username: row.username,
        first_name: row.first_name,
        last_name: row.last_name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        postal_code: row.postal_code,
        city: row.city ?? null,
        country: row.country ?? null,
        state: row.state ?? null,
        is_synthetic: row.invitee_is_synthetic === true,
      },
      inviter: {
        id: row.inviter_id,
        username: row.inviter_username,
        first_name: row.inviter_first_name,
        last_name: row.inviter_last_name,
        avatar_url: row.inviter_avatar_url,
      },
      role_is_synthetic: row.role_is_synthetic === true,
      inviter_username: row.inviter_username,
      is_internal: row.is_internal === true || row.is_internal === "true",
      current_filled_role_id: row.current_filled_role_id ? parseInt(row.current_filled_role_id) : null,
      current_filled_role_name: row.current_filled_role_name ?? null,
    }));

    res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("Error fetching team invitations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team invitations",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Respond to an invitation (accept or decline)
 */
const respondToInvitation = async (req, res) => {
  try {
    const invitationId = req.params.invitationId;
    const userId = req.user.id;
    const { action, response_message } = req.body;
    const fillRole = req.body.fill_role ?? req.body.fillRole ?? false;
    const switchRoles =
      req.body.switch_roles ?? req.body.switchRoles ?? false;

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be 'accept' or 'decline'",
      });
    }

    // Get invitation details including inviter info
    const invitationResult = await db.pool.query(
      `SELECT ti.*, t.max_members, t.name as team_name,
          u.first_name as invitee_first_name, u.last_name as invitee_last_name, u.username as invitee_username,
          tvr.role_name,
          tvr.status as role_status
   FROM team_invitations ti
   JOIN teams t ON ti.team_id = t.id
   JOIN users u ON ti.invitee_id = u.id
   LEFT JOIN team_vacant_roles tvr ON ti.role_id = tvr.id
   WHERE ti.id = $1 AND ti.invitee_id = $2 AND ti.status = 'pending'
   AND t.archived_at IS NULL`,
      [invitationId, userId],
    );

    if (invitationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found or already responded to",
      });
    }

    const invitation = invitationResult.rows[0];
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      let roleFilled = false;
      let filledRoleName = null;
      let roleSwitched = false;
      let reopenedRole = null;
      let reopenedRoleMessageRow = null;
      let filledRoleMessageRow = null;

      if (action === "accept") {
        // Check if user is already a team member (internal role invite)
        const existingMember = await client.query(
          `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
          [invitation.team_id, userId],
        );
        const isInternalAccept = existingMember.rows.length > 0;

        if (!isInternalAccept) {
          // Check if team is still not full
          const memberCount = await client.query(
            `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
            [invitation.team_id],
          );

          if (
            invitation.max_members !== null &&
            parseInt(memberCount.rows[0].count) >= invitation.max_members
          ) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Team is now at maximum capacity",
            });
          }

          // Add user to team
          await client.query(
            `INSERT INTO team_members (team_id, user_id, role, joined_at)
             VALUES ($1, $2, 'member', NOW())`,
            [invitation.team_id, userId],
          );
        }

        // Update invitation status
        await client.query(
          `UPDATE team_invitations
           SET status = 'accepted', responded_at = NOW()
           WHERE id = $1`,
          [invitationId],
        );

        // Internal role accepts always fill the linked role; external accepts remain opt-in.
        // A member can only fill one role at a time inside the same team.
        if (invitation.role_id && (fillRole || isInternalAccept)) {
          const existingFilledRoleResult = await client.query(
            `SELECT id, role_name
             FROM team_vacant_roles
             WHERE team_id = $1
               AND filled_by = $2
               AND status = 'filled'
               AND id <> $3
             ORDER BY updated_at DESC
             LIMIT 1`,
            [invitation.team_id, userId, invitation.role_id],
          );

          if (existingFilledRoleResult.rows.length > 0) {
            if (!switchRoles) {
              await client.query("ROLLBACK");
              return res.status(409).json({
                success: false,
                message: `You are already filling ${existingFilledRoleResult.rows[0].role_name} in this team. Leave that role before accepting this role offer.`,
                data: {
                  currentRoleId: existingFilledRoleResult.rows[0].id,
                  currentRoleName: existingFilledRoleResult.rows[0].role_name,
                },
              });
            }

            if (invitation.role_status !== "open") {
              await client.query("ROLLBACK");
              return res.status(400).json({
                success: false,
                message: "This role offer is no longer available.",
              });
            }

            reopenedRole = existingFilledRoleResult.rows[0];

            await client.query(
              `UPDATE team_vacant_roles
               SET status = 'open',
                   filled_by = NULL,
                   updated_at = NOW()
               WHERE id = $1 AND team_id = $2 AND filled_by = $3 AND status = 'filled'`,
              [reopenedRole.id, invitation.team_id, userId],
            );

            const roleUpdateResult = await client.query(
              `UPDATE team_vacant_roles
               SET status = 'filled', filled_by = $1, updated_at = NOW()
               WHERE id = $2 AND team_id = $3 AND status = 'open'
               RETURNING id, role_name`,
              [userId, invitation.role_id, invitation.team_id],
            );

            if (roleUpdateResult.rows.length === 0) {
              await client.query("ROLLBACK");
              return res.status(400).json({
                success: false,
                message: "This role offer is no longer available.",
              });
            }

            roleFilled = true;
            roleSwitched = true;
            filledRoleName = roleUpdateResult.rows[0].role_name;
          } else {
            const roleUpdateResult = await client.query(
              `UPDATE team_vacant_roles
               SET status = 'filled', filled_by = $1, updated_at = NOW()
               WHERE id = $2 AND team_id = $3 AND status = 'open'
               RETURNING id, role_name`,
              [userId, invitation.role_id, invitation.team_id],
            );
            roleFilled = roleUpdateResult.rows.length > 0;
            filledRoleName = roleFilled
              ? roleUpdateResult.rows[0].role_name
              : null;
          }
        }

        const inviteeName =
          invitation.invitee_first_name && invitation.invitee_last_name
            ? `${invitation.invitee_first_name} ${invitation.invitee_last_name}`
            : invitation.invitee_username;

        let teamMessageResult = null;

        if (roleSwitched && reopenedRole) {
          const reopenedMessageResult = await client.query(
            `INSERT INTO messages (sender_id, team_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, sender_id, team_id, content, sent_at`,
            [
              userId,
              invitation.team_id,
              buildRoleReopenedMessage({
                teamId: invitation.team_id,
                teamName: invitation.team_name,
                roleId: reopenedRole.id,
                roleName: reopenedRole.role_name,
                userId,
                userName: inviteeName,
              }),
            ],
          );
          reopenedRoleMessageRow = reopenedMessageResult.rows[0];
          await emitInsertedMessage(req, reopenedRoleMessageRow);

          const filledMessageResult = await client.query(
            `INSERT INTO messages (sender_id, team_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, sender_id, team_id, content, sent_at`,
            [
              userId,
              invitation.team_id,
              buildRoleInvitationFilledMessage({
                teamId: invitation.team_id,
                teamName: invitation.team_name,
                roleId: invitation.role_id,
                roleName: filledRoleName,
                userId,
                userName: inviteeName,
              }),
            ],
          );
          filledRoleMessageRow = filledMessageResult.rows[0];
          await emitInsertedMessage(req, filledRoleMessageRow);
          teamMessageResult = filledMessageResult;

          if (response_message && response_message.trim()) {
            const responseMessageResult = await client.query(
              `INSERT INTO messages (sender_id, team_id, content, sent_at)
               VALUES ($1, $2, $3, NOW())
               RETURNING id, sender_id, team_id, content, sent_at`,
              [userId, invitation.team_id, response_message.trim()],
            );
            await emitInsertedMessage(req, responseMessageResult.rows[0]);
          }
        } else {
          let joinLine;
          if (isInternalAccept && roleFilled) {
            joinLine = `🎯 ${inviteeName} was assigned the role ${filledRoleName}!`;
          } else if (isInternalAccept) {
            joinLine = `🎯 ${inviteeName} accepted a role invitation!`;
          } else if (roleFilled) {
            joinLine = `👋 ${inviteeName} joined the team as ${filledRoleName}!`;
          } else {
            joinLine = `👋 ${inviteeName} joined the team!`;
          }
          const formattedMessage =
            response_message && response_message.trim()
              ? `${joinLine}\n\n"${response_message.trim()}"`
              : joinLine;

          teamMessageResult = await client.query(
            `INSERT INTO messages (sender_id, team_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, sender_id, team_id, content, sent_at`,
            [userId, invitation.team_id, formattedMessage],
          );
          await emitInsertedMessage(req, teamMessageResult.rows[0]);
        }

        // === CREATE NOTIFICATIONS FOR TEAM MEMBERS ===
        try {
          const io = req.app.get("io");

          if (roleSwitched && reopenedRole) {
            await notifyTeamMembers({
              teamId: invitation.team_id,
              excludeUserId: userId,
              type: "role_reopened",
              title: `${inviteeName} left the role ${reopenedRole.role_name} in ${invitation.team_name}`,
              message: `${reopenedRole.role_name} is open again to be filled.`,
              referenceType: "message",
              referenceId: reopenedRoleMessageRow?.id || reopenedRole.id,
              actorId: userId,
            });

            await notifyTeamMembers({
              teamId: invitation.team_id,
              excludeUserId: userId,
              type: "role_filled",
              title: `${inviteeName} is now filling ${filledRoleName} in ${invitation.team_name}`,
              message: `${filledRoleName} has been filled by ${inviteeName}.`,
              referenceType: "message",
              referenceId:
                filledRoleMessageRow?.id ||
                teamMessageResult?.rows?.[0]?.id ||
                invitation.role_id,
              actorId: userId,
            });

            if (io) {
              io.to(`team:${invitation.team_id}`).emit("notification:new", {
                type: "role_reopened",
                teamId: invitation.team_id,
                roleId: reopenedRole.id,
                roleName: reopenedRole.role_name,
                actorId: userId,
                title: `${inviteeName} left the role ${reopenedRole.role_name} in ${invitation.team_name}`,
              });
              io.to(`team:${invitation.team_id}`).emit("notification:new", {
                type: "role_filled",
                teamId: invitation.team_id,
                roleId: invitation.role_id,
                roleName: filledRoleName,
                filledUserId: userId,
                filledUserName: inviteeName,
                actorId: userId,
                title: `${inviteeName} is now filling ${filledRoleName} in ${invitation.team_name}`,
              });
            }
          } else {
            const notificationType = isInternalAccept ? "role_assigned" : "member_joined";
            const notificationTitle = isInternalAccept
              ? `${inviteeName} was assigned a role in ${invitation.team_name}`
              : `${inviteeName} joined ${invitation.team_name}`;

            await notifyTeamMembers({
              teamId: invitation.team_id,
              excludeUserId: userId,
              type: notificationType,
              title: notificationTitle,
              referenceType: "message",
              referenceId: teamMessageResult.rows[0]?.id || userId,
              actorId: userId,
            });

            // Emit socket event to team members
            if (io) {
              io.to(`team:${invitation.team_id}`).emit("notification:new", {
                type: notificationType,
                teamId: invitation.team_id,
              });
            }
          }

          // Notify the inviter if the role was filled
          if (roleFilled) {
            await createNotification({
              userId: invitation.inviter_id,
              type: "invitation_accepted",
              title: `${inviteeName} accepted your invitation and joined ${invitation.team_name} as ${filledRoleName}`,
              referenceType: "message",
              referenceId: teamMessageResult.rows[0]?.id || parseInt(invitationId),
              teamId: invitation.team_id,
              actorId: userId,
            });

            if (io) {
              io.to(`user:${invitation.inviter_id}`).emit("notification:new", {
                type: "invitation_accepted",
                teamId: invitation.team_id,
                roleFilled,
                filledRoleName,
                title: filledRoleName
                  ? `Your invitation to join ${invitation.team_name} as ${filledRoleName} was accepted!`
                  : `Your invitation to ${invitation.team_name} was accepted!`,
                actorName: inviteeName,
              });
            }
          }
        } catch (notificationError) {
          console.error("Error creating join notification:", notificationError);
        }
        // === END NOTIFICATION ===
      } else {
        // Decline
        await client.query(
          `UPDATE team_invitations 
           SET status = 'declined', responded_at = NOW()
           WHERE id = $1`,
          [invitationId],
        );

        // Get invitee's name and inviter's name
        const inviteeName =
          invitation.invitee_first_name && invitation.invitee_last_name
            ? `${invitation.invitee_first_name} ${invitation.invitee_last_name}`
            : invitation.invitee_username;

        // Get inviter's name
        const inviterResult = await client.query(
          `SELECT first_name, last_name, username FROM users WHERE id = $1`,
          [invitation.inviter_id],
        );
        const inviter = inviterResult.rows[0];
        const inviterName =
          inviter.first_name && inviter.last_name
            ? `${inviter.first_name} ${inviter.last_name}`
            : inviter.username;

        // Include whether there's a personal message
        const hasPersonalMessage =
          response_message && response_message.trim() ? "true" : "false";

        // System message format includes all info for both perspectives
        const teamToken = `${invitation.team_id}:${invitation.team_name}`;
        const inviterToken = `${invitation.inviter_id}:${inviterName}`;
        const inviteeToken = `${userId}:${inviteeName}`; // userId is the invitee who is declining

        const declineSystemMessage = `🚫 INVITATION_DECLINED: ${teamToken} | ${inviterToken} | ${inviteeToken} | ${hasPersonalMessage}`;

        const declineMessageResult = await client.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, receiver_id, content, sent_at`,
          [userId, invitation.inviter_id, declineSystemMessage],
        );
        await emitInsertedMessage(req, declineMessageResult.rows[0]);

        // If there's a personal message, send it as a separate regular message
        if (response_message && response_message.trim()) {
          await client.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, invitation.inviter_id, response_message.trim()],
          );
        }

        // === CREATE NOTIFICATION FOR INVITER ===
        try {
          const { createNotification } = require("./notificationController");

          await createNotification({
            userId: invitation.inviter_id,
            type: "invitation_declined",
            title: `${inviteeName} declined your invitation to ${invitation.team_name}`,
            message: response_message || null,
            referenceType: "message",
            referenceId: declineMessageResult.rows[0]?.id || parseInt(invitationId),
            teamId: invitation.team_id,
            actorId: userId,
          });

          // Emit socket event
          const io = req.app.get("io");
          if (io) {
            io.to(`user:${invitation.inviter_id}`).emit("notification:new", {
              type: "invitation_declined",
              teamId: invitation.team_id,
              title: invitation.role_id && invitation.role_name
                ? `Your invitation to join ${invitation.team_name} as ${invitation.role_name} was declined`
                : `Your invitation to ${invitation.team_name} was declined`,
              actorName: inviteeName,
              ...(invitation.role_id && invitation.role_name ? { roleName: invitation.role_name } : {}),
            });
          }
        } catch (notificationError) {
          console.error(
            "Error creating invitation decline notification:",
            notificationError,
          );
        }
        // === END NOTIFICATION ===
      }

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message:
          action === "accept"
            ? `You have joined ${invitation.team_name}!`
            : "Invitation declined",
        data: {
          roleFilled,
          filledRoleName,
          roleSwitched,
          reopenedRoleId: reopenedRole?.id ?? null,
          reopenedRoleName: reopenedRole?.role_name ?? null,
        },
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error responding to invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error responding to invitation",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Cancel a pending invitation (by team owner/admin)
 */
const cancelInvitation = async (req, res) => {
  try {
    const invitationId = req.params.invitationId;
    const userId = req.user.id;

    // Get invitation with full details
    const invitationResult = await db.pool.query(
      `SELECT ti.*, t.name as team_name,
              u.first_name as invitee_first_name, 
              u.last_name as invitee_last_name, 
              u.username as invitee_username,
              tvr.role_name
       FROM team_invitations ti
       JOIN teams t ON ti.team_id = t.id
       JOIN users u ON ti.invitee_id = u.id
       LEFT JOIN team_vacant_roles tvr ON ti.role_id = tvr.id
       WHERE ti.id = $1 AND ti.status = 'pending'`,
      [invitationId],
    );

    if (invitationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found or already responded to",
      });
    }

    const invitation = invitationResult.rows[0];
    const teamId = invitation.team_id;

    // Check if user is owner or admin
    const authCheck = await db.pool.query(
      `SELECT role FROM team_members 
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this invitation",
      });
    }

    // Get canceller's name
    const cancellerResult = await db.pool.query(
      `SELECT first_name, last_name, username FROM users WHERE id = $1`,
      [userId],
    );
    const canceller = cancellerResult.rows[0];
    const cancellerName =
      canceller.first_name && canceller.last_name
        ? `${canceller.first_name} ${canceller.last_name}`
        : canceller.username;

    // Get invitee's name
    const inviteeName =
      invitation.invitee_first_name && invitation.invitee_last_name
        ? `${invitation.invitee_first_name} ${invitation.invitee_last_name}`
        : invitation.invitee_username;

    // Cancel the invitation
    await db.pool.query(
      `UPDATE team_invitations
       SET status = 'canceled', responded_at = NOW()
       WHERE id = $1`,
      [invitationId],
    );

    // Remove stale invitation_received notification for the invitee
    await db.pool.query(
      `DELETE FROM notifications
       WHERE type = 'invitation_received'
         AND reference_id = $1
         AND read_at IS NULL`,
      [parseInt(invitationId)],
    );

    // System message format (parseable + clickable team/user)
    const teamToken = `${teamId}:${invitation.team_name}`;
    const cancellerToken = `${userId}:${cancellerName}`;
    const inviteeToken = `${invitation.invitee_id}:${inviteeName}`;

    const cancelSystemMessage = `🚫 INVITATION_CANCELLED: ${teamToken} | ${cancellerToken} | ${inviteeToken}`;

    const cancelMessageResult = await db.pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
   VALUES ($1, $2, $3, NOW())
   RETURNING id, sender_id, receiver_id, content, sent_at`,
      [userId, invitation.invitee_id, cancelSystemMessage],
    );
    await emitInsertedMessage(req, cancelMessageResult.rows[0]);

    // === CREATE NOTIFICATION FOR INVITEE ===
    try {
      const { createNotification } = require("./notificationController");

      await createNotification({
        userId: invitation.invitee_id,
        type: "invitation_cancelled",
        title: `${cancellerName} cancelled your invitation to ${invitation.team_name}`,
        message: null,
        referenceType: "message",
        referenceId: cancelMessageResult.rows[0]?.id || parseInt(invitationId),
        teamId: teamId,
        actorId: userId,
      });

      // Emit socket event
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${invitation.invitee_id}`).emit("notification:new", {
          type: "invitation_cancelled",
          teamId: teamId,
          title: invitation.role_id && invitation.role_name
            ? `Your invitation to join ${invitation.team_name} as ${invitation.role_name} was cancelled`
            : `Your invitation to ${invitation.team_name} was cancelled`,
          actorName: cancellerName,
          ...(invitation.role_id && invitation.role_name ? { roleName: invitation.role_name } : {}),
        });
        io.to(`team:${teamId}`).emit("notification:updated", {
          type: "invitation_cancelled",
          teamId,
          invitationId: parseInt(invitationId),
        });
      }
    } catch (notificationError) {
      console.error(
        "Error creating invitation cancel notification:",
        notificationError,
      );
    }
    // === END NOTIFICATION ===

    res.status(200).json({
      success: true,
      message: "Invitation canceled successfully",
    });
  } catch (error) {
    console.error("Error canceling invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error canceling invitation",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Cancel only the role part of a pending invitation.
 * For internal role invitations this cancels the whole invitation because there
 * is no separate team invitation to keep.
 */
const cancelRoleInvitation = async (req, res) => {
  try {
    const invitationId = req.params.invitationId;
    const userId = req.user.id;

    const invitationResult = await db.pool.query(
      `SELECT ti.*, t.name as team_name,
              u.first_name as invitee_first_name,
              u.last_name as invitee_last_name,
              u.username as invitee_username,
              EXISTS (
                SELECT 1 FROM team_members tm
                WHERE tm.team_id = ti.team_id AND tm.user_id = ti.invitee_id
              ) AS is_internal
       FROM team_invitations ti
       JOIN teams t ON ti.team_id = t.id
       JOIN users u ON ti.invitee_id = u.id
       WHERE ti.id = $1 AND ti.status = 'pending'`,
      [invitationId],
    );

    if (invitationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found or already responded to",
      });
    }

    const invitation = invitationResult.rows[0];
    const teamId = invitation.team_id;

    if (!invitation.role_id) {
      return res.status(400).json({
        success: false,
        message: "This invitation is not linked to a role",
      });
    }

    const authCheck = await db.pool.query(
      `SELECT role FROM team_members
       WHERE team_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [teamId, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this role invitation",
      });
    }

    const isInternal = invitation.is_internal === true || invitation.is_internal === "true";

    if (isInternal) {
      await db.pool.query(
        `UPDATE team_invitations
         SET status = 'canceled', responded_at = NOW()
         WHERE id = $1`,
        [invitationId],
      );
    } else {
      await db.pool.query(
        `UPDATE team_invitations
         SET role_id = NULL
         WHERE id = $1`,
        [invitationId],
      );
    }

    await db.pool.query(
      `DELETE FROM notifications
       WHERE reference_type = 'team_invitation'
         AND reference_id = $1
         AND read_at IS NULL
       AND type IN ('role_invitation')`,
      [parseInt(invitationId)],
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${invitation.invitee_id}`).emit("notification:updated", {
        type: "role_invitation_cancelled",
        teamId,
        invitationId: parseInt(invitationId),
      });
      io.to(`team:${teamId}`).emit("notification:updated", {
        type: "role_invitation_cancelled",
        teamId,
        invitationId: parseInt(invitationId),
        canceledInvitation: isInternal,
      });
    }

    res.status(200).json({
      success: true,
      message: isInternal
        ? "Role invitation canceled successfully"
        : "Role invitation removed from team invitation",
      data: {
        invitationId: parseInt(invitationId),
        canceledInvitation: isInternal,
      },
    });
  } catch (error) {
    console.error("Error canceling role invitation:", error);
    res.status(500).json({
      success: false,
      message: "Error canceling role invitation",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Get teams where user can invite others (is owner or admin)
 * Optionally filters out teams where inviteeId is already a member
 */

/**
 * Get teams where user can invite others (is owner or admin)
 * Optionally filters out teams where inviteeId is already a member
 */
const getTeamsWhereUserCanInvite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { inviteeId } = req.query;

    let query = `
      SELECT t.id, t.name, t.teamavatar_url, t.max_members, t.city, t.country, t.is_remote,
             tm.role as user_role,
             (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as current_members_count
    `;

    const params = [userId];

    if (inviteeId) {
      query += `
        , EXISTS (
          SELECT 1 FROM team_members
          WHERE team_id = t.id AND user_id = $2
        ) as is_invitee_member
      `;
      params.push(inviteeId);
    }

    query += `
      FROM teams t
      JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1 AND tm.role IN ('owner', 'admin')
      AND t.archived_at IS NULL
    `;

    query += ` ORDER BY t.name ASC`;

    const teamsResult = await db.pool.query(query, params);

    const availableTeams = teamsResult.rows
      .filter((team) => {
        const isInviteeMember =
          inviteeId &&
          (team.is_invitee_member === true || team.is_invitee_member === "true");

        return (
          team.max_members === null ||
          isInviteeMember ||
          parseInt(team.current_members_count) < team.max_members
        );
      })
      .map((team) => {
        const mappedTeam = {
          id: team.id,
          name: team.name,
          teamavatar_url: team.teamavatar_url,
          max_members: team.max_members,
          current_members_count: parseInt(team.current_members_count),
          available_spots:
            team.max_members === null
              ? null
              : team.max_members - parseInt(team.current_members_count),
          city: team.city ?? null,
          country: team.country ?? null,
          is_remote: team.is_remote ?? false,
          user_role: team.user_role,
        };

        if (inviteeId) {
          mappedTeam.is_invitee_member =
            team.is_invitee_member === true || team.is_invitee_member === "true";
        }

        return mappedTeam;
      });

    res.status(200).json({
      success: true,
      data: availableTeams,
    });
  } catch (error) {
    console.error("Error fetching teams for invite:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching teams",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};
module.exports = {
  sendTeamInvitation,
  getUserReceivedInvitations,
  getTeamSentInvitations,
  respondToInvitation,
  cancelInvitation,
  cancelRoleInvitation,
  getTeamsWhereUserCanInvite,
};
