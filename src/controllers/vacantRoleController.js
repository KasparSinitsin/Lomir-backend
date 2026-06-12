const db = require("../config/database");
const { resolveLocationData } = require("../utils/geocodingUtil");
const { computeDistanceScore, WEIGHTS } = require("./matchingController");
const { serializeVacantRole } = require("../utils/vacantRoleSerializer");
const { createNotification } = require("./notificationController");
const { emitInsertedMessage } = require("../utils/socketMessageEmitter");

const VACANT_ROLE_SELECT = `SELECT vr.*,
              u.first_name AS creator_first_name,
              u.last_name AS creator_last_name,
              u.username AS creator_username,
              u.is_public AS creator_is_public,
              fu.id AS filled_by_user_id,
              fu.first_name AS filled_by_user_first_name,
              fu.last_name AS filled_by_user_last_name,
              fu.username AS filled_by_user_username,
              fu.avatar_url AS filled_by_user_avatar_url,
              fu.is_public AS filled_by_user_is_public
       FROM team_vacant_roles vr
       JOIN users u ON vr.created_by = u.id
       LEFT JOIN users fu ON vr.filled_by = fu.id`;

const VACANT_ROLE_STATUS_SELECT = `SELECT vr.*,
              fu.id AS filled_by_user_id,
              fu.first_name AS filled_by_user_first_name,
              fu.last_name AS filled_by_user_last_name,
              fu.username AS filled_by_user_username,
              fu.avatar_url AS filled_by_user_avatar_url
       FROM team_vacant_roles vr
       LEFT JOIN users fu ON vr.filled_by = fu.id`;

const fetchRoleTags = async (clientOrPool, roleId) => {
  const result = await clientOrPool.query(
    `SELECT
       t.id AS id,
       t.id AS tag_id,
       t.name,
       t.category,
       t.supercategory
     FROM team_vacant_role_tags vrt
     JOIN tags t ON vrt.tag_id = t.id
     WHERE vrt.role_id = $1
     ORDER BY t.supercategory, t.category, t.name`,
    [roleId],
  );

  return result.rows;
};

const fetchRoleBadges = async (clientOrPool, roleId) => {
  const result = await clientOrPool.query(
    `SELECT
       b.id AS id,
       b.id AS badge_id,
       b.name,
       b.category,
       b.color,
       b.image_url,
       b.cat_image_url
     FROM team_vacant_role_badges vrb
     JOIN badges b ON vrb.badge_id = b.id
     WHERE vrb.role_id = $1
     ORDER BY b.category, b.name`,
    [roleId],
  );

  return result.rows;
};

const getUserDisplayName = (userRow) => {
  if (!userRow) return "Someone";
  const fullName = [userRow.first_name, userRow.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || userRow.username || "Someone";
};

const ROLE_EVENT_MESSAGE_TYPES = {
  role_created: { marker: "ROLE_CREATED", emoji: "🆕" },
  role_updated: { marker: "ROLE_UPDATED", emoji: "✏️" },
  role_deleted: { marker: "ROLE_DELETED", emoji: "🗑️" },
  role_closed: { marker: "ROLE_CLOSED", emoji: "🔒" },
  role_filled: { marker: "ROLE_FILLED", emoji: "✅" },
  role_reopened: { marker: "ROLE_REOPENED", emoji: "🔓" },
  role_reopened_admin: { marker: "ROLE_REOPENED_ADMIN", emoji: "🔓" },
};

const buildRoleEventMessage = ({
  type,
  teamId,
  teamName,
  roleId,
  roleName,
  actorId,
  actorName,
  filledUserId = null,
  filledUserName = null,
}) => {
  const config = ROLE_EVENT_MESSAGE_TYPES[type];
  if (!config || !teamId || !roleId) return null;

  const baseMessage = `${config.emoji} ${config.marker}: ${teamId}:${teamName || "your team"} | ${roleId}:${roleName || "Vacant Role"}`;

  if (type === "role_filled") {
    const filledToken = `${filledUserId ?? actorId}:${filledUserName || actorName || "Someone"}`;
    const actorToken = `${actorId}:${actorName || "Someone"}`;
    return filledUserId != null || filledUserName
      ? `${baseMessage} | ${filledToken} | ${actorToken}`
      : `${baseMessage} | ${actorToken}`;
  }

  return `${baseMessage} | ${actorId}:${actorName || "Someone"}`;
};

const notifyTeamMembersOfRoleEvent = async ({
  req,
  teamId,
  actorId,
  type,
  title,
  message = null,
  referenceId = null,
  teamName = null,
  roleName = null,
  actorName = null,
  filledUserId = null,
  filledUserName = null,
  skipChatMessage = false,
}) => {
  if (typeof req?.app?.get !== "function") return;

  try {
    const eventContent = buildRoleEventMessage({
      type,
      teamId,
      teamName,
      roleId: referenceId,
      roleName,
      actorId,
      actorName,
      filledUserId,
      filledUserName,
    });
    let messageRow = null;

    if (eventContent && !skipChatMessage) {
      const messageResult = await db.pool.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, team_id, content, sent_at`,
        [actorId, teamId, eventContent],
      );
      messageRow = messageResult.rows[0] || null;
      await emitInsertedMessage(req, messageRow);
    }

    const membersResult = await db.pool.query(
      `SELECT user_id
       FROM team_members
       WHERE team_id = $1
         AND user_id != $2`,
      [teamId, actorId],
    );

    for (const member of membersResult.rows) {
      await createNotification({
        userId: member.user_id,
        type,
        title,
        message,
        referenceType: messageRow?.id ? "message" : "vacant_role",
        referenceId: messageRow?.id || referenceId,
        teamId,
        actorId,
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`team:${teamId}`).emit("notification:new", {
        type,
        teamId: Number(teamId),
        referenceId: messageRow?.id
          ? Number(messageRow.id)
          : referenceId != null ? Number(referenceId) : null,
        messageId: messageRow?.id ? Number(messageRow.id) : null,
        actorId: actorId != null ? Number(actorId) : null,
      });
    }
  } catch (error) {
    console.error(`Error creating ${type} notifications:`, error);
  }
};

// ============================================================
// Helper: Notify role applicants and invitees of a role status change
// ============================================================
const ACTION_LABELS = {
  role_updated: "updated",
  role_deleted: "deleted",
  role_closed: "closed",
  role_filled: "filled",
  role_reopened: "reopened",
  role_reopened_admin: "reopened",
};

const notifyRoleApplicantsAndInvitees = async ({
  req,
  roleId,
  type,
  roleName,
  teamId,
  teamName,
  actorId,
  actorName,
}) => {
  if (typeof req?.app?.get !== "function") return;
  const io = req.app.get("io");
  if (!io) return;

  const action = ACTION_LABELS[type] || "changed";
  const applicantTitle = `The role "${roleName}" you applied for has been ${action}`;
  const inviteeTitle = `The role "${roleName}" you were invited to has been ${action}`;

  try {
    // Pending role applications for this role
    const applicationsResult = await db.pool.query(
      `SELECT id, applicant_id FROM team_applications
       WHERE role_id = $1 AND status = 'pending'`,
      [roleId],
    );

    for (const row of applicationsResult.rows) {
      // Remove any existing role-status notification for this application so
      // repeated role changes don't stack up in the bell, then insert fresh.
      let notification = null;
      try {
        await db.pool.query(
          `DELETE FROM notifications
           WHERE user_id = $1 AND type = 'role_status_changed_applicant' AND reference_id = $2`,
          [row.applicant_id, row.id],
        );
        notification = await createNotification({
          userId: row.applicant_id,
          type: "role_status_changed_applicant",
          title: applicantTitle,
          message: applicantTitle,
          referenceType: "application",
          referenceId: row.id,
          teamId,
          actorId,
        });
      } catch (dbErr) {
        console.error("Error replacing applicant role-status notification:", dbErr);
      }

      io.to(`user:${row.applicant_id}`).emit("notification:new", {
        type: "role_status_changed_applicant",
        teamId: Number(teamId),
        referenceId: Number(row.id),
        actorId: actorId != null ? Number(actorId) : null,
      });

      io.to(`user:${row.applicant_id}`).emit("role:statusChanged", {
        userType: "applicant",
        roleChangeType: type,
        roleName,
        teamName,
        teamId: Number(teamId),
        roleId: Number(roleId),
        applicationId: Number(row.id),
        invitationId: null,
        actorName,
        notificationId: notification?.id ?? null,
      });
    }

    // Pending role invitations for this role
    const invitationsResult = await db.pool.query(
      `SELECT id, invitee_id FROM team_invitations
       WHERE role_id = $1 AND status = 'pending'`,
      [roleId],
    );

    for (const row of invitationsResult.rows) {
      // Remove any existing role-status notification for this invitation so
      // repeated role changes don't stack up in the bell, then insert fresh.
      let notification = null;
      try {
        await db.pool.query(
          `DELETE FROM notifications
           WHERE user_id = $1 AND type = 'role_status_changed_invitee' AND reference_id = $2`,
          [row.invitee_id, row.id],
        );
        notification = await createNotification({
          userId: row.invitee_id,
          type: "role_status_changed_invitee",
          title: inviteeTitle,
          message: inviteeTitle,
          referenceType: "invitation",
          referenceId: row.id,
          teamId,
          actorId,
        });
      } catch (dbErr) {
        console.error("Error replacing invitee role-status notification:", dbErr);
      }

      io.to(`user:${row.invitee_id}`).emit("notification:new", {
        type: "role_status_changed_invitee",
        teamId: Number(teamId),
        referenceId: Number(row.id),
        actorId: actorId != null ? Number(actorId) : null,
      });

      io.to(`user:${row.invitee_id}`).emit("role:statusChanged", {
        userType: "invitee",
        roleChangeType: type,
        roleName,
        teamName,
        teamId: Number(teamId),
        roleId: Number(roleId),
        applicationId: null,
        invitationId: Number(row.id),
        actorName,
        notificationId: notification?.id ?? null,
      });
    }
  } catch (error) {
    console.error(`Error notifying applicants/invitees for role ${type}:`, error);
  }
};

// ============================================================
// Helper: Check if user is owner or admin of a team
// ============================================================
const checkTeamAuth = async (teamId, userId) => {
  const result = await db.pool.query(
    `SELECT tm.role
     FROM team_members tm
     JOIN teams t ON tm.team_id = t.id
     WHERE tm.team_id = $1
       AND tm.user_id = $2
       AND (tm.role = 'owner' OR tm.role = 'admin')
       AND t.archived_at IS NULL`,
    [teamId, userId],
  );
  return result.rows.length > 0 ? result.rows[0].role : null;
};

// ============================================================
// GET /api/teams/:teamId/vacant-roles
// List all vacant roles for a team (public)
// Supports ?status=open|filled|closed|all (default "open")
// and ?ids=1,2,3 to bulk-fetch specific roles regardless of status
// (used by the request-modal poll to refresh role state in one call).
// ============================================================
const getVacantRoles = async (req, res) => {
  try {
    const { teamId } = req.params;
    const statusFilter = req.query.status || "open"; // default: only open roles
    const idsParam = req.query.ids;

    const filterIds = idsParam
      ? String(idsParam)
          .split(",")
          .map((s) => Number(s.trim()))
          .filter(Number.isFinite)
      : null;

    if (filterIds && filterIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Fetch roles — when ids is provided, filter by them and ignore status
    // so polling can detect roles that have transitioned to filled/closed
    const rolesResult = filterIds
      ? await db.pool.query(
          `${VACANT_ROLE_SELECT}
           WHERE vr.team_id = $1
             AND vr.id = ANY($2::int[])
           ORDER BY vr.created_at DESC`,
          [teamId, filterIds],
        )
      : await db.pool.query(
          `${VACANT_ROLE_SELECT}
           WHERE vr.team_id = $1
             AND ($2 = 'all' OR vr.status = $2)
           ORDER BY vr.created_at DESC`,
          [teamId, statusFilter],
        );

    const roles = rolesResult.rows;

    if (roles.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Fetch tags and badges for all roles in batch
    const roleIds = roles.map((r) => r.id);

    const tagsResult = await db.pool.query(
      `SELECT
      vrt.role_id,
      t.id AS id,
      t.id AS tag_id,
      t.name,
      t.category,
      t.supercategory
   FROM team_vacant_role_tags vrt
   JOIN tags t ON vrt.tag_id = t.id
   WHERE vrt.role_id = ANY($1)
   ORDER BY t.supercategory, t.category, t.name`,
      [roleIds],
    );

    const badgesResult = await db.pool.query(
      `SELECT
      vrb.role_id,
      b.id AS id,
      b.id AS badge_id,
      b.name,
      b.category,
      b.color,
      b.image_url,
      b.cat_image_url
   FROM team_vacant_role_badges vrb
   JOIN badges b ON vrb.badge_id = b.id
   WHERE vrb.role_id = ANY($1)
   ORDER BY b.category, b.name`,
      [roleIds],
    );

    // Group tags and badges by role_id
    const tagsByRole = {};
    const badgesByRole = {};

    for (const tag of tagsResult.rows) {
      if (!tagsByRole[tag.role_id]) tagsByRole[tag.role_id] = [];
      tagsByRole[tag.role_id].push(tag);
    }

    for (const badge of badgesResult.rows) {
      if (!badgesByRole[badge.role_id]) badgesByRole[badge.role_id] = [];
      badgesByRole[badge.role_id].push(badge);
    }

    // If the user is authenticated, fetch their tags/badges/location for match scoring
    let userTagIds = new Set();
    let userBadgeIds = new Set();
    let userLat = null;
    let userLng = null;

    if (req.user) {
      const [userTagsResult, userBadgesResult, userLocationResult] = await Promise.all([
        db.pool.query(`SELECT tag_id FROM user_tags WHERE user_id = $1`, [req.user.id]),
        db.pool.query(
          `SELECT DISTINCT badge_id FROM badge_awards WHERE awarded_to_user_id = $1`,
          [req.user.id],
        ),
        db.pool.query(`SELECT latitude, longitude FROM users WHERE id = $1`, [req.user.id]),
      ]);
      userTagIds = new Set(userTagsResult.rows.map((r) => r.tag_id));
      userBadgeIds = new Set(userBadgesResult.rows.map((r) => r.badge_id));
      if (userLocationResult.rows.length > 0) {
        userLat = userLocationResult.rows[0].latitude;
        userLng = userLocationResult.rows[0].longitude;
      }
    }

    // Attach tags, badges and (if authenticated) match score to each role
    const enrichedRoles = roles.map((role) => {
      const tags = tagsByRole[role.id] || [];
      const badges = badgesByRole[role.id] || [];

      if (!req.user) {
        return serializeVacantRole(role, {
          tags,
          badges,
          desiredTags: tags,
          desiredBadges: badges,
        });
      }

      const roleTagIds = tags.map((t) => t.tag_id);
      const roleBadgeIds = badges.map((b) => b.badge_id);

      const tagScore = roleTagIds.length > 0
        ? roleTagIds.filter((id) => userTagIds.has(id)).length / roleTagIds.length
        : 0.5;

      const badgeScore = roleBadgeIds.length > 0
        ? roleBadgeIds.filter((id) => userBadgeIds.has(id)).length / roleBadgeIds.length
        : 0.5;

      const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
        isRemote: role.is_remote,
        userLat,
        userLng,
        roleLat: role.latitude,
        roleLng: role.longitude,
        maxDistKm: role.max_distance_km,
      });

      const matchScore =
        WEIGHTS.tags * tagScore +
        WEIGHTS.badges * badgeScore +
        WEIGHTS.distance * distanceScore;

      return serializeVacantRole(role, {
        tags,
        badges,
        desiredTags: tags,
        desiredBadges: badges,
        match_score: Math.round(matchScore * 100) / 100,
        match_details: {
          tag_score: Math.round(tagScore * 100) / 100,
          badge_score: Math.round(badgeScore * 100) / 100,
          distance_score: Math.round(distanceScore * 100) / 100,
          matching_tags: roleTagIds.filter((id) => userTagIds.has(id)).length,
          total_required_tags: roleTagIds.length,
          matching_badges: roleBadgeIds.filter((id) => userBadgeIds.has(id)).length,
          total_required_badges: roleBadgeIds.length,
          distance_km: distanceKm !== null ? Math.round(distanceKm) : null,
          max_distance_km: role.max_distance_km,
          is_within_range: isWithinRange,
        },
      });
    });

    res.status(200).json({
      success: true,
      data: enrichedRoles,
    });
  } catch (error) {
    console.error("Error fetching vacant roles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching vacant roles",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// ============================================================
// GET /api/teams/:teamId/vacant-roles/:roleId
// Get a single vacant role by ID
// ============================================================
const getVacantRoleById = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const viewerId = req.user?.id;

    // Check parent team visibility before revealing any role data
    const teamResult = await db.pool.query(
      'SELECT is_public FROM teams WHERE id = $1 AND archived_at IS NULL',
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Role not found" });
    }

    const teamIsPublic =
      teamResult.rows[0].is_public === true ||
      teamResult.rows[0].is_public === 'true';

    if (!teamIsPublic) {
      if (!viewerId) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }
      const memberCheck = await db.pool.query(
        'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
        [teamId, viewerId],
      );
      if (memberCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Role not found" });
      }
    }

    const roleResult = await db.pool.query(
      `${VACANT_ROLE_SELECT}
       WHERE vr.id = $1 AND vr.team_id = $2`,
      [roleId, teamId],
    );

    if (roleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    const role = roleResult.rows[0];

    const tags = await fetchRoleTags(db.pool, roleId);
    const badges = await fetchRoleBadges(db.pool, roleId);

    res.status(200).json({
      success: true,
      data: serializeVacantRole(role, {
        tags,
        badges,
        desiredTags: tags,
        desiredBadges: badges,
      }),
    });
  } catch (error) {
    console.error("Error fetching vacant role:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching vacant role",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// ============================================================
// POST /api/teams/:teamId/vacant-roles
// Create a new vacant role (owner/admin only)
// ============================================================
const createVacantRole = async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.id;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to create vacant roles for this team",
      });
    }

    // Check if parent team is synthetic (new roles inherit this flag)
    const teamSyntheticCheck = await db.pool.query(
      `SELECT name, is_synthetic FROM teams WHERE id = $1`,
      [teamId],
    );
    const isTeamSynthetic =
      teamSyntheticCheck.rows[0]?.is_synthetic === true;
    const teamName = teamSyntheticCheck.rows[0]?.name || "your team";

    const {
      role_name,
      bio,
      postal_code,
      city,
      country,
      state,
      district,
      max_distance_km,
      is_remote,
      tag_ids, // array of tag IDs
      badge_ids, // array of badge IDs
    } = req.body;

    // Validate required fields
    if (!role_name || !role_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    // Normalize location: if remote, clear location fields
    const isRemote = is_remote === true || is_remote === "true";
    const finalPostalCode = isRemote ? null : postal_code || null;
    const finalCity = isRemote ? null : city || null;
    const finalCountry = isRemote ? null : country || null;
    let finalState = isRemote ? null : state || null;
    let finalDistrict = isRemote ? null : district || null;
    let finalLatitude = null;
    let finalLongitude = null;
    const finalMaxDistance = isRemote ? null : max_distance_km || null;

    // ── Geocode if not remote and we have enough location data ──
    if (!isRemote && finalCountry) {
      const resolvedLocation = await resolveLocationData({
        postal_code: finalPostalCode,
        city: finalCity,
        state: finalState,
        district: finalDistrict,
        country: finalCountry,
      });

      if (resolvedLocation) {
        finalState = resolvedLocation.state;
        finalDistrict = resolvedLocation.district;
        finalLatitude = resolvedLocation.latitude;
        finalLongitude = resolvedLocation.longitude;
      }
    }

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Insert the role
      const roleResult = await client.query(
        `INSERT INTO team_vacant_roles (
          team_id, created_by, role_name, bio,
          postal_code, city, country, state, district,
          latitude, longitude, max_distance_km, is_remote,
          is_synthetic
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          teamId,
          userId,
          role_name.trim(),
          bio?.trim() || null,
          finalPostalCode,
          finalCity,
          finalCountry,
          finalState,
          finalDistrict,
          finalLatitude,
          finalLongitude,
          finalMaxDistance,
          isRemote,
          isTeamSynthetic,
        ],
      );

      const roleId = roleResult.rows[0].id;

      // Insert tags if provided
      if (tag_ids && tag_ids.length > 0) {
        const tagCheck = await client.query(
          `SELECT id FROM tags WHERE id = ANY($1)`,
          [tag_ids],
        );
        const validTagIds = tagCheck.rows.map((r) => r.id);
        const invalidTags = tag_ids.filter((id) => !validTagIds.includes(id));

        if (invalidTags.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Invalid tag IDs: ${invalidTags.join(", ")}`,
          });
        }

        for (const tagId of tag_ids) {
          await client.query(
            `INSERT INTO team_vacant_role_tags (role_id, tag_id)
       VALUES ($1, $2)`,
            [roleId, tagId],
          );
        }
      }

      // Insert badges if provided
      if (badge_ids && badge_ids.length > 0) {
        const badgeCheck = await client.query(
          `SELECT id FROM badges WHERE id = ANY($1)`,
          [badge_ids],
        );
        const validBadgeIds = badgeCheck.rows.map((r) => r.id);
        const invalidBadges = badge_ids.filter(
          (id) => !validBadgeIds.includes(id),
        );

        if (invalidBadges.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Invalid badge IDs: ${invalidBadges.join(", ")}`,
          });
        }

        for (const badgeId of badge_ids) {
          await client.query(
            `INSERT INTO team_vacant_role_badges (role_id, badge_id)
       VALUES ($1, $2)`,
            [roleId, badgeId],
          );
        }
      }

      const tags = await fetchRoleTags(client, roleId);
      const badges = await fetchRoleBadges(client, roleId);

      await client.query("COMMIT");

      const role = {
        ...serializeVacantRole(roleResult.rows[0]),
        tags,
        badges,
        desiredTags: tags,
        desiredBadges: badges,
      };

      if (typeof req?.app?.get === "function") try {
        const actorResult = await db.pool.query(
          `SELECT username, first_name, last_name FROM users WHERE id = $1`,
          [userId],
        );
        const actorName = getUserDisplayName(actorResult.rows[0]);
        const roleName = role.roleName || role.role_name || "Vacant Role";
        await notifyTeamMembersOfRoleEvent({
          req,
          teamId,
          actorId: userId,
          type: "role_created",
          title: `New role opened in ${teamName}: ${roleName}`,
          message: `New role ${roleName} created.`,
          referenceId: role.id,
          teamName,
          roleName,
          actorName,
        });
      } catch (notificationError) {
        console.error("Error creating role_created notification:", notificationError);
      }

      res.status(201).json({
        success: true,
        message: "Vacant role created successfully",
        data: role,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error creating vacant role:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while creating vacant role",
        ...(process.env.NODE_ENV === "development" && { error: dbError.message }),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Create vacant role error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating vacant role",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// ============================================================
// PUT /api/teams/:teamId/vacant-roles/:roleId
// Update a vacant role (owner/admin only)
// ============================================================
const updateVacantRole = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const userId = req.user.id;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update vacant roles for this team",
      });
    }

    // Verify role exists and belongs to this team
    const existingRole = await db.pool.query(
      `SELECT * FROM team_vacant_roles WHERE id = $1 AND team_id = $2`,
      [roleId, teamId],
    );

    if (existingRole.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    const {
      role_name,
      bio,
      postal_code,
      city,
      country,
      state,
      district,
      max_distance_km,
      is_remote,
      tag_ids,
      badge_ids,
    } = req.body;

    // Normalize location
    const isRemote = is_remote === true || is_remote === "true";
    const finalPostalCode = isRemote ? null : postal_code || null;
    const finalCity = isRemote ? null : city || null;
    const finalCountry = isRemote ? null : country || null;
    let finalState = isRemote ? null : state || null;
    let finalDistrict = isRemote ? null : district || null;
    let finalLatitude = null;
    let finalLongitude = null;
    const finalMaxDistance = isRemote ? null : max_distance_km || null;

    // ── Geocode if not remote and we have enough location data ──
    if (!isRemote && finalCountry) {
      const resolvedLocation = await resolveLocationData({
        postal_code: finalPostalCode,
        city: finalCity,
        state: finalState,
        district: finalDistrict,
        country: finalCountry,
      });

      if (resolvedLocation) {
        finalState = resolvedLocation.state;
        finalDistrict = resolvedLocation.district;
        finalLatitude = resolvedLocation.latitude;
        finalLongitude = resolvedLocation.longitude;
      }
    }

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Update the role
      const roleResult = await client.query(
        `UPDATE team_vacant_roles SET
          role_name       = COALESCE($1, role_name),
          bio             = $2,
          postal_code     = $3,
          city            = $4,
          country         = $5,
          state           = $6,
          district        = $7,
          latitude        = $8,
          longitude       = $9,
          max_distance_km = $10,
          is_remote       = $11,
          updated_at      = NOW()
        WHERE id = $12 AND team_id = $13
        RETURNING *`,
        [
          role_name?.trim() || null,
          bio?.trim() || null,
          finalPostalCode,
          finalCity,
          finalCountry,
          finalState,
          finalDistrict,
          finalLatitude,
          finalLongitude,
          finalMaxDistance,
          isRemote,
          roleId,
          teamId,
        ],
      );

      // Replace tags if provided
      if (tag_ids !== undefined) {
        await client.query(
          `DELETE FROM team_vacant_role_tags WHERE role_id = $1`,
          [roleId],
        );

        if (tag_ids && tag_ids.length > 0) {
          const tagCheck = await client.query(
            `SELECT id FROM tags WHERE id = ANY($1)`,
            [tag_ids],
          );
          const validTagIds = tagCheck.rows.map((r) => r.id);
          const invalidTags = tag_ids.filter((id) => !validTagIds.includes(id));

          if (invalidTags.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: `Invalid tag IDs: ${invalidTags.join(", ")}`,
            });
          }

          for (const tagId of tag_ids) {
            await client.query(
              `INSERT INTO team_vacant_role_tags (role_id, tag_id)
               VALUES ($1, $2)`,
              [roleId, tagId],
            );
          }
        }
      }

      // Replace badges if provided
      if (badge_ids !== undefined) {
        await client.query(
          `DELETE FROM team_vacant_role_badges WHERE role_id = $1`,
          [roleId],
        );

        if (badge_ids && badge_ids.length > 0) {
          const badgeCheck = await client.query(
            `SELECT id FROM badges WHERE id = ANY($1)`,
            [badge_ids],
          );
          const validBadgeIds = badgeCheck.rows.map((r) => r.id);
          const invalidBadges = badge_ids.filter(
            (id) => !validBadgeIds.includes(id),
          );

          if (invalidBadges.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: `Invalid badge IDs: ${invalidBadges.join(", ")}`,
            });
          }

          for (const badgeId of badge_ids) {
            await client.query(
              `INSERT INTO team_vacant_role_badges (role_id, badge_id)
               VALUES ($1, $2)`,
              [roleId, badgeId],
            );
          }
        }
      }

      await client.query("COMMIT");

      // Fetch the full updated role with tags and badges
      const tags = await fetchRoleTags(db.pool, roleId);
      const badges = await fetchRoleBadges(db.pool, roleId);

      const updatedRole = {
        ...serializeVacantRole(roleResult.rows[0]),
        tags,
        badges,
        desiredTags: tags,
        desiredBadges: badges,
      };

      if (typeof req?.app?.get === "function") try {
        const [teamResult, actorResult] = await Promise.all([
          db.pool.query(`SELECT name FROM teams WHERE id = $1`, [teamId]),
          db.pool.query(
            `SELECT username, first_name, last_name FROM users WHERE id = $1`,
            [userId],
          ),
        ]);
        const teamName = teamResult.rows[0]?.name || "your team";
        const actorName = getUserDisplayName(actorResult.rows[0]);
        const roleName = updatedRole.roleName || updatedRole.role_name || "Vacant Role";
        await notifyTeamMembersOfRoleEvent({
          req,
          teamId,
          actorId: userId,
          type: "role_updated",
          title: `Role updated in ${teamName}: ${roleName}`,
          message: `${actorName} updated the role: ${roleName}`,
          referenceId: updatedRole.id,
          teamName,
          roleName,
          actorName,
        });
        await notifyRoleApplicantsAndInvitees({
          req,
          roleId: updatedRole.id,
          type: "role_updated",
          roleName,
          teamId,
          teamName,
          actorId: userId,
          actorName,
        });
      } catch (notificationError) {
        console.error("Error creating role_updated notification:", notificationError);
      }

      res.status(200).json({
        success: true,
        message: "Vacant role updated successfully",
        data: updatedRole,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      console.error("Database error updating vacant role:", dbError);
      res.status(500).json({
        success: false,
        message: "Database error while updating vacant role",
        ...(process.env.NODE_ENV === "development" && { error: dbError.message }),
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Update vacant role error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating vacant role",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// ============================================================
// DELETE /api/teams/:teamId/vacant-roles/:roleId
// Delete a vacant role (owner/admin only)
// ============================================================
const deleteVacantRole = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const userId = req.user.id;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete vacant roles for this team",
      });
    }

    // CASCADE will handle join tables automatically
    const result = await db.pool.query(
      `DELETE FROM team_vacant_roles
       WHERE id = $1 AND team_id = $2
       RETURNING id, role_name`,
      [roleId, teamId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    if (typeof req?.app?.get === "function") try {
      const [teamResult, actorResult] = await Promise.all([
        db.pool.query(`SELECT name FROM teams WHERE id = $1`, [teamId]),
        db.pool.query(
          `SELECT username, first_name, last_name FROM users WHERE id = $1`,
          [userId],
        ),
      ]);
      const teamName = teamResult.rows[0]?.name || "your team";
      const actorName = getUserDisplayName(actorResult.rows[0]);
      const roleName = result.rows[0].role_name || "Vacant Role";

      // Remove stale unread notifications about this specific role before sending role_deleted
      await db.pool.query(
        `DELETE FROM notifications
         WHERE team_id = $1
           AND type IN ('role_created', 'role_updated', 'role_closed', 'role_reopened', 'role_reopened_admin')
           AND read_at IS NULL
           AND (
             (reference_type = 'vacant_role' AND reference_id = $2)
             OR reference_id IN (
               SELECT id FROM messages WHERE team_id = $1 AND content LIKE $3
             )
           )`,
        [teamId, roleId, `%| ${roleId}:%`],
      );
      const io = req.app.get("io");
      io?.to(`team:${teamId}`).emit("notification:updated");

      await notifyRoleApplicantsAndInvitees({
        req,
        roleId: result.rows[0].id,
        type: "role_deleted",
        roleName,
        teamId,
        teamName,
        actorId: userId,
        actorName,
      });
      await notifyTeamMembersOfRoleEvent({
        req,
        teamId,
        actorId: userId,
        type: "role_deleted",
        title: `Role deleted in ${teamName}: ${roleName}`,
        message: `${actorName} deleted the role: ${roleName}`,
        referenceId: result.rows[0].id,
        teamName,
        roleName,
        actorName,
      });
    } catch (notificationError) {
      console.error("Error creating role_deleted notification:", notificationError);
    }

    res.status(200).json({
      success: true,
      message: "Vacant role deleted successfully",
    });
  } catch (error) {
    console.error("Delete vacant role error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting vacant role",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// ============================================================
// PUT /api/teams/:teamId/vacant-roles/:roleId/status
// Update role status (open → filled/closed)
// ============================================================
const updateVacantRoleStatus = async (req, res) => {
  try {
    const { teamId, roleId } = req.params;
    const userId = req.user.id;
    const { status, filled_by, skip_chat_message: skipChatMessage } = req.body;

    // Authorization check
    const userRole = await checkTeamAuth(teamId, userId);
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update vacant role status",
      });
    }

    // Validate status
    const validStatuses = ["open", "filled", "closed"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const normalizedFilledBy =
      status === "filled" &&
      filled_by !== undefined &&
      filled_by !== null &&
      filled_by !== ""
        ? filled_by
        : null;

    if (status === "filled" && normalizedFilledBy) {
      const existingFilledRole = await db.pool.query(
        `SELECT id, role_name
         FROM team_vacant_roles
         WHERE team_id = $1
           AND filled_by = $2
           AND status = 'filled'
           AND id <> $3
         ORDER BY updated_at DESC
         LIMIT 1`,
        [teamId, normalizedFilledBy, roleId],
      );

      if (existingFilledRole.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `This member is already filling ${existingFilledRole.rows[0].role_name} in this team. A member can only fill one role at a time.`,
          data: {
            currentRoleId: existingFilledRole.rows[0].id,
            currentRoleName: existingFilledRole.rows[0].role_name,
          },
        });
      }
    }

    const result = await db.pool.query(
      `UPDATE team_vacant_roles
       SET status = $1,
           filled_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND team_id = $4
       RETURNING *`,
      [status, normalizedFilledBy, roleId, teamId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    const updatedRoleResult = await db.pool.query(
      `${VACANT_ROLE_STATUS_SELECT}
       WHERE vr.id = $1 AND vr.team_id = $2`,
      [roleId, teamId],
    );
    const updatedRole = serializeVacantRole(updatedRoleResult.rows[0]);

    if (typeof req?.app?.get === "function") try {
      const [teamResult, actorResult] = await Promise.all([
        db.pool.query(`SELECT name FROM teams WHERE id = $1`, [teamId]),
        db.pool.query(
          `SELECT username, first_name, last_name FROM users WHERE id = $1`,
          [userId],
        ),
      ]);
      const teamName = teamResult.rows[0]?.name || "your team";
      const actorName = getUserDisplayName(actorResult.rows[0]);
      const roleName = updatedRole.roleName || updatedRole.role_name || "Vacant Role";
      const filledUser = updatedRole.filled_by_user || updatedRole.filledByUser || null;
      const filledUserName = filledUser ? getUserDisplayName(filledUser) : null;
      const notificationByStatus = {
        open: {
          type: "role_reopened",
          title: `Role reopened in ${teamName}: ${roleName}`,
          message: `${actorName} reopened the role: ${roleName}`,
        },
        filled: {
          type: "role_filled",
          title: `Role filled in ${teamName}: ${roleName}`,
          message: `${roleName} was marked as filled`,
        },
        closed: {
          type: "role_closed",
          title: `Role closed in ${teamName}: ${roleName}`,
          message: `${actorName} closed the role: ${roleName}`,
        },
      };
      const notificationConfig = notificationByStatus[status];

      if (notificationConfig) {
        await notifyRoleApplicantsAndInvitees({
          req,
          roleId: updatedRole.id,
          type: notificationConfig.type,
          roleName,
          teamId,
          teamName,
          actorId: userId,
          actorName,
        });
        await notifyTeamMembersOfRoleEvent({
          req,
          teamId,
          actorId: userId,
          type: notificationConfig.type,
          title: notificationConfig.title,
          message: notificationConfig.message,
          referenceId: updatedRole.id,
          teamName,
          roleName,
          actorName,
          filledUserId: status === "filled" ? filledUser?.id ?? null : null,
          filledUserName: status === "filled" ? filledUserName : null,
          skipChatMessage: !!skipChatMessage,
        });
      }
    } catch (notificationError) {
      console.error(`Error creating role_${status} notification:`, notificationError);
    }

    res.status(200).json({
      success: true,
      message: `Vacant role status updated to "${status}"`,
      data: updatedRole,
    });
  } catch (error) {
    console.error("Update vacant role status error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating vacant role status",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getVacantRoles,
  getVacantRoleById,
  createVacantRole,
  updateVacantRole,
  deleteVacantRole,
  updateVacantRoleStatus,
};
