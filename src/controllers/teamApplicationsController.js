const db = require("../config/database");
const Joi = require("joi");
const {
  createNotification,
  notifyTeamMembers,
  notifyTeamAdmins,
} = require("./notificationController");
const { computeDistanceScore, WEIGHTS } = require("./matchingController");
const { serializeEmbeddedVacantRole } = require("../utils/vacantRoleSerializer");
const { emitInsertedMessage } = require("../utils/socketMessageEmitter");

const buildRoleApplicationDeferredInviteMessage = ({
  teamId,
  teamName,
  roleId,
  roleName,
  applicantId,
  applicantName,
  approverId,
  approverName,
  currentRoleId,
  currentRoleName,
}) =>
  `📬 ROLE_APPLICATION_DEFERRED_INVITE: ${teamId}:${teamName || "your team"} | ${roleId}:${roleName || "Vacant Role"} | ${applicantId}:${applicantName || "Someone"} | ${approverId}:${approverName || "Someone"} | ${currentRoleId}:${currentRoleName || "their current role"}`;

const getUserPendingApplications = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's pending applications with team details
    const applicationsResult = await db.pool.query(
      `SELECT
    ta.id, ta.team_id, ta.role_id, ta.message, ta.status, ta.created_at,
    vr.role_name, vr.bio AS role_bio, vr.city AS role_city, vr.country AS role_country,
    vr.state AS role_state, vr.district AS role_district, vr.is_remote AS role_is_remote,
    vr.latitude AS role_latitude, vr.longitude AS role_longitude,
    vr.max_distance_km AS role_max_distance_km, vr.status AS role_status,
    vr.filled_by AS role_filled_by, vr.is_synthetic AS role_is_synthetic,
    fu.id AS role_filled_by_user_id,
    fu.first_name AS role_filled_by_user_first_name,
    fu.last_name AS role_filled_by_user_last_name,
    fu.username AS role_filled_by_user_username,
    fu.avatar_url AS role_filled_by_user_avatar_url,
    t.name, t.description, t.teamavatar_url, t.max_members, t.is_public, t.is_synthetic,
    t.latitude, t.longitude, t.is_remote, t.city, t.country, t.state, t.district, t.postal_code,
    (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as current_members_count,
    owner.id as owner_id,
    owner.username as owner_username,
    owner.first_name as owner_first_name,
    owner.last_name as owner_last_name,
    owner.avatar_url as owner_avatar_url,
    owner.is_synthetic as owner_is_synthetic,
    owner.is_public as owner_is_public,
    u.latitude AS applicant_latitude, u.longitude AS applicant_longitude,
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_id = t.id AND user_id = $1
    ) AS is_team_member
   FROM team_applications ta
   JOIN teams t ON ta.team_id = t.id
   LEFT JOIN team_vacant_roles vr ON ta.role_id = vr.id
   LEFT JOIN users fu ON vr.filled_by = fu.id
   JOIN team_members tm ON t.id = tm.team_id AND tm.role = 'owner'
   JOIN users owner ON tm.user_id = owner.id
   JOIN users u ON ta.applicant_id = u.id
   WHERE ta.applicant_id = $1 AND ta.status = 'pending'
   ORDER BY ta.created_at DESC`,
      [userId],
    );

    if (applicationsResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const teamIds = [...new Set(
      applicationsResult.rows.map((r) => r.team_id).filter(Boolean)
    )];

    const roleIds = [...new Set(
      applicationsResult.rows.map((r) => r.role_id).filter(Boolean)
    )];

    let teamTagsByTeamId = {};
    let teamBadgesByTeamId = {};
    let roleTagsByRole = {};
    let roleBadgesByRole = {};
    let userTagIds = new Set();
    let userBadgeIds = new Set();

    const [
      teamTagsResult,
      teamBadgesResult,
      roleTagsResult,
      roleBadgesResult,
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
    userTagIds = new Set(userTagsResult.rows.map((r) => r.tag_id));
    userBadgeIds = new Set(userBadgesResult.rows.map((r) => r.badge_id));

    const applications = applicationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      isInternalRoleApplication: row.is_team_member === true && row.role_id != null,
      role: row.role_id
        ? (() => {
            const roleTags = roleTagsByRole[row.role_id] || [];
            const roleBadges = roleBadgesByRole[row.role_id] || [];
            const roleTagIds = roleTags.map((t) => t.tag_id);
            const roleBadgeIds = roleBadges.map((b) => b.badge_id);

            const tagScore = roleTagIds.length > 0
              ? roleTagIds.filter((id) => userTagIds.has(id)).length / roleTagIds.length
              : 0.5;

            const badgeScore = roleBadgeIds.length > 0
              ? roleBadgeIds.filter((id) => userBadgeIds.has(id)).length / roleBadgeIds.length
              : 0.5;

            const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
              isRemote: row.role_is_remote,
              userLat: row.applicant_latitude,
              userLng: row.applicant_longitude,
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
                matching_tags: roleTagIds.filter((id) => userTagIds.has(id)).length,
                total_required_tags: roleTagIds.length,
                matching_badges: roleBadgeIds.filter((id) => userBadgeIds.has(id)).length,
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
        name: row.name,
        description: row.description,
        teamavatar_url: row.teamavatar_url,
        max_members: row.max_members,
        is_public: row.is_public === true || row.is_public === "true",
        is_synthetic: row.is_synthetic,
        current_members_count: parseInt(row.current_members_count),
        latitude: row.latitude,
        longitude: row.longitude,
        is_remote: row.is_remote,
        city: row.city,
        country: row.country,
        state: row.state,
        district: row.district,
        postal_code: row.postal_code,
        tags: teamTagsByTeamId[row.team_id] || [],
        badges: teamBadgesByTeamId[row.team_id] || [],
      },
      // Owner (receiver) info
      owner: {
        id: row.owner_id,
        username: row.owner_username,
        first_name: row.owner_first_name,
        last_name: row.owner_last_name,
        avatar_url: row.owner_avatar_url,
        is_synthetic: row.owner_is_synthetic === true,
        is_public: row.owner_is_public === true || row.owner_is_public === "true",
      },
    }));

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error("Error fetching user pending applications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching applications",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


const cancelApplication = async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    const userId = req.user.id;

    // Get application with full details
    const applicationResult = await db.pool.query(
      `SELECT ta.*, t.name as team_name,
              u.first_name as applicant_first_name,
              u.last_name as applicant_last_name,
              u.username as applicant_username,
              EXISTS (
                SELECT 1 FROM team_members applicant_tm
                WHERE applicant_tm.team_id = ta.team_id
                  AND applicant_tm.user_id = ta.applicant_id
              ) AS is_internal_role_application
       FROM team_applications ta
       JOIN teams t ON ta.team_id = t.id
       JOIN users u ON ta.applicant_id = u.id
       WHERE ta.id = $1 AND ta.applicant_id = $2 AND ta.status = 'pending'`,
      [applicationId, userId],
    );

    if (applicationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found or cannot be canceled",
      });
    }

    const application = applicationResult.rows[0];

    // Get applicant's name
    const applicantName =
      application.applicant_first_name && application.applicant_last_name
        ? `${application.applicant_first_name} ${application.applicant_last_name}`
        : application.applicant_username;

    // Delete the application
    await db.pool.query(`DELETE FROM team_applications WHERE id = $1`, [
      applicationId,
    ]);

    // Remove stale application_received notifications for this team + applicant
    await db.pool.query(
      `DELETE FROM notifications
       WHERE type = 'application_received'
         AND team_id = $1
         AND actor_id = $2
         AND read_at IS NULL`,
      [application.team_id, userId],
    );

    // Get team admins and owners to notify
    const adminsResult = await db.pool.query(
      `SELECT tm.user_id, u.first_name, u.last_name, u.username
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.role IN ('owner', 'admin')`,
      [application.team_id],
    );

    // Send system message and notification to each admin
    for (const admin of adminsResult.rows) {
      const adminName =
        admin.first_name && admin.last_name
          ? `${admin.first_name} ${admin.last_name}`
          : admin.username;

      // System message format
      // Parseable + clickable tokens
      const teamToken = `${application.team_id}:${application.team_name}`;
      const applicantToken = `${userId}:${applicantName}`;
      const adminToken = `${admin.user_id}:${adminName}`;

      const cancelSystemMessage = `🚫 APPLICATION_CANCELLED: ${teamToken} | ${applicantToken} | ${adminToken}`;

      const cancelMessageResult = await db.pool.query(
        `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
   VALUES ($1, $2, $3, NOW())
   RETURNING id, sender_id, receiver_id, content, sent_at`,
        [userId, admin.user_id, cancelSystemMessage],
      );
      await emitInsertedMessage(req, cancelMessageResult.rows[0]);

      // Create notification for admin
      try {
        const cancelNotificationType = application.is_internal_role_application
          ? "role_application_cancelled"
          : "application_cancelled";
        await createNotification({
          userId: admin.user_id,
          type: cancelNotificationType,
          title: `${applicantName} withdrew their application for ${application.team_name}`,
          message: null,
          referenceType: "message",
          referenceId: cancelMessageResult.rows[0]?.id || parseInt(applicationId),
          teamId: application.team_id,
          actorId: userId,
        });

        // Emit socket event
        const io = req.app.get("io");
        if (io) {
          io.to(`user:${admin.user_id}`).emit("notification:new", {
            type: cancelNotificationType,
            teamId: application.team_id,
          });
        }
      } catch (notificationError) {
        console.error(
          "Error creating application cancel notification:",
          notificationError,
        );
      }
    }

    res.status(200).json({
      success: true,
      message: "Application canceled successfully",
    });
  } catch (error) {
    console.error("Error canceling application:", error);
    res.status(500).json({
      success: false,
      message: "Error canceling application",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


const getTeamApplications = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.user.id;

    // Check if user is the team owner or admin
    const authCheck = await db.pool.query(
      `SELECT tm.role FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.team_id = $1 AND tm.user_id = $2 
       AND (tm.role = 'owner' OR tm.role = 'admin')
       AND t.archived_at IS NULL`,
      [teamId, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view applications for this team",
      });
    }

    // Get pending applications with applicant details
    const applicationsResult = await db.pool.query(
      `SELECT
        ta.id, ta.role_id, ta.message, ta.status, ta.created_at,
        vr.role_name, vr.bio AS role_bio, vr.city AS role_city, vr.country AS role_country,
        vr.state AS role_state, vr.district AS role_district, vr.is_remote AS role_is_remote,
        vr.latitude AS role_latitude, vr.longitude AS role_longitude,
        vr.max_distance_km AS role_max_distance_km, vr.status AS role_status,
        vr.filled_by AS role_filled_by, vr.is_synthetic AS role_is_synthetic,
        fu.id AS role_filled_by_user_id,
        fu.first_name AS role_filled_by_user_first_name,
        fu.last_name AS role_filled_by_user_last_name,
        fu.username AS role_filled_by_user_username,
        fu.avatar_url AS role_filled_by_user_avatar_url,
        u.id as applicant_id, u.username, u.first_name, u.last_name,
        u.bio, u.avatar_url, u.postal_code, u.is_synthetic AS applicant_is_synthetic, u.city, u.country, u.state, u.district,
        u.latitude AS applicant_latitude, u.longitude AS applicant_longitude,
        EXISTS (
          SELECT 1
          FROM team_members applicant_tm
          WHERE applicant_tm.team_id = ta.team_id
            AND applicant_tm.user_id = ta.applicant_id
        ) AS is_team_member
       FROM team_applications ta
       JOIN users u ON ta.applicant_id = u.id
       LEFT JOIN team_vacant_roles vr ON ta.role_id = vr.id
       LEFT JOIN users fu ON vr.filled_by = fu.id
       WHERE ta.team_id = $1 AND ta.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks ub
           WHERE (ub.blocker_id = ta.applicant_id AND ub.blocked_id = $2)
              OR (ub.blocked_id = ta.applicant_id AND ub.blocker_id = $2)
         )
       ORDER BY ta.created_at ASC`,
      [teamId, userId],
    );

    // Batch-fetch role tags and badges for applications that reference a vacant role
    const roleIds = [...new Set(
      applicationsResult.rows
        .map((r) => r.role_id)
        .filter(Boolean)
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

    // Also batch-fetch applicant tags and badges for match scoring
    const applicantIds = [...new Set(
      applicationsResult.rows.map((r) => r.applicant_id)
    )];

    let applicantTagsByUser = {};
    let applicantBadgesByUser = {};

    if (applicantIds.length > 0 && roleIds.length > 0) {
      const [appTagsResult, appBadgesResult] = await Promise.all([
        db.pool.query(
          `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
          [applicantIds]
        ),
        db.pool.query(
          `SELECT DISTINCT ba.awarded_to_user_id AS user_id, ba.badge_id
           FROM badge_awards ba
           WHERE ba.awarded_to_user_id = ANY($1)`,
          [applicantIds]
        ),
      ]);

      for (const row of appTagsResult.rows) {
        if (!applicantTagsByUser[row.user_id]) applicantTagsByUser[row.user_id] = new Set();
        applicantTagsByUser[row.user_id].add(row.tag_id);
      }
      for (const row of appBadgesResult.rows) {
        if (!applicantBadgesByUser[row.user_id]) applicantBadgesByUser[row.user_id] = new Set();
        applicantBadgesByUser[row.user_id].add(row.badge_id);
      }
    }

    const applications = applicationsResult.rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      role: row.role_id
        ? (() => {
            const roleTags = roleTagsByRole[row.role_id] || [];
            const roleBadges = roleBadgesByRole[row.role_id] || [];
            const roleTagIds = roleTags.map((t) => t.tag_id);
            const roleBadgeIds = roleBadges.map((b) => b.badge_id);

            const userTags = applicantTagsByUser[row.applicant_id] || new Set();
            const userBadges = applicantBadgesByUser[row.applicant_id] || new Set();

            // Tag score
            let tagScore = roleTagIds.length > 0
              ? roleTagIds.filter((id) => userTags.has(id)).length / roleTagIds.length
              : 0.5;

            // Badge score
            let badgeScore = roleBadgeIds.length > 0
              ? roleBadgeIds.filter((id) => userBadges.has(id)).length / roleBadgeIds.length
              : 0.5;

            // Distance score
            const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
              isRemote: row.role_is_remote,
              userLat: row.applicant_latitude,
              userLng: row.applicant_longitude,
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
      role_is_synthetic: row.role_is_synthetic === true,
      isInternalRoleApplication: row.is_team_member === true && row.role_id != null,
      is_internal_role_application: row.is_team_member === true && row.role_id != null,
      applicant: {
        id: row.applicant_id,
        username: row.username,
        first_name: row.first_name,
        last_name: row.last_name,
        bio: row.bio,
        avatar_url: row.avatar_url,
        postal_code: row.postal_code,
        city: row.city ?? null,
        country: row.country ?? null,
        state: row.state ?? null,
        district: row.district ?? null,
        is_synthetic: row.applicant_is_synthetic === true,
      },
    }));

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    console.error("Error fetching team applications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching team applications",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


const handleTeamApplication = async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    const { action, response } = req.body; // action: 'approve' or 'decline'
    const fillRole = req.body.fillRole ?? req.body.fill_role ?? false;
    const userId = req.user.id;

    // Get application details
    const applicationResult = await db.pool.query(
      `SELECT ta.*, t.owner_id, t.max_members, t.name as team_name, tm.role,
          vr.role_name,
          vr.status AS role_status,
          applicant.first_name as applicant_first_name, 
          applicant.last_name as applicant_last_name,
          applicant.username as applicant_username
   FROM team_applications ta
   JOIN teams t ON ta.team_id = t.id
   LEFT JOIN team_vacant_roles vr ON ta.role_id = vr.id
   JOIN users applicant ON ta.applicant_id = applicant.id
   LEFT JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = $1
   WHERE ta.id = $2`,
      [userId, applicationId],
    );

    if (applicationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const application = applicationResult.rows[0];

    // Check authorization
    if (application.owner_id !== userId && application.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to handle this application",
      });
    }

    if (userId === application.applicant_id) {
      return res.status(403).json({
        success: false,
        message: "You cannot approve or decline your own application. Another team owner or admin must review it.",
      });
    }

    // Get approver's name
    const approverResult = await db.pool.query(
      `SELECT first_name, last_name, username FROM users WHERE id = $1`,
      [userId],
    );
    const approver = approverResult.rows[0];

    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      // Remove unread application_received notifications for all admins now that the application is being handled
      const deletedAdminNotifs = await client.query(
        `DELETE FROM notifications
         WHERE type = 'application_received'
           AND team_id = $1
           AND actor_id = $2
           AND read_at IS NULL
         RETURNING user_id`,
        [application.team_id, application.applicant_id],
      );
      const affectedAdminIds = [...new Set(deletedAdminNotifs.rows.map((r) => r.user_id))];

      if (action === "approve") {
        // Check if applicant is already a member (internal role application)
        const existingMember = await client.query(
          `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
          [application.team_id, application.applicant_id]
        );

        const isInternalRoleApp = existingMember.rows.length > 0;

        if (!isInternalRoleApp) {
          // External application — check capacity and add to team
          const memberCountResult = await client.query(
            `SELECT COUNT(*) as count FROM team_members WHERE team_id = $1`,
            [application.team_id],
          );

          if (
            application.max_members !== null &&
            parseInt(memberCountResult.rows[0].count) >= application.max_members
          ) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Team is already at maximum capacity",
            });
          }

          // Add user to team
          await client.query(
            `INSERT INTO team_members (team_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', NOW())`,
            [application.team_id, application.applicant_id],
          );

          // Clean up any pending invitations for this user to this team
          await client.query(
            `UPDATE team_invitations
     SET status = 'accepted', responded_at = NOW()
     WHERE team_id = $1 AND invitee_id = $2 AND status = 'pending'`,
            [application.team_id, application.applicant_id],
          );
        }

        // Update application status — runs for both internal and external
        await client.query(
          `UPDATE team_applications
   SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1
   WHERE id = $2`,
          [userId, applicationId],
        );

        // Add system message to team chat for approved application
        const applicantName =
          application.applicant_first_name && application.applicant_last_name
            ? `${application.applicant_first_name} ${application.applicant_last_name}`
            : application.applicant_username;

        const approverName =
          approver.first_name && approver.last_name
            ? `${approver.first_name} ${approver.last_name}`
            : approver.username;

        let teamMessageResult = null;

        if (!isInternalRoleApp) {
          const systemMessage = `🎉 ${applicantName} has applied successfully to your team and has been added as a team member by ${approverName}. Say hello to them!`;

          teamMessageResult = await client.query(
            `INSERT INTO messages (sender_id, team_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, sender_id, team_id, content, sent_at`,
            [userId, application.team_id, systemMessage],
          );
          await emitInsertedMessage(req, teamMessageResult.rows[0]);
        }

        // Include whether there's a personal message
        const hasPersonalMessage =
          response && response.trim() ? "true" : "false";

        // System message format includes all info for both perspectives
        const teamToken = `${application.team_id}:${application.team_name}`;
        const approverToken = `${userId}:${approverName}`;
        const applicantToken = `${application.applicant_id}:${applicantName}`;

        const approvalSystemMessage = `✅ APPLICATION_APPROVED: ${teamToken} | ${approverToken} | ${applicantToken} | ${hasPersonalMessage}`;
        const approvalTitle =
          application.role_id && application.role_name
            ? `Your application to ${application.team_name} for ${application.role_name} was approved!`
            : `Your application to ${application.team_name} was approved!`;

        let approvalMessageResult = null;
        if (!isInternalRoleApp) {
          approvalMessageResult = await client.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())
             RETURNING id, sender_id, receiver_id, content, sent_at`,
            [userId, application.applicant_id, approvalSystemMessage],
          );
          await emitInsertedMessage(req, approvalMessageResult.rows[0]);

          // If there's a personal message, send it as a separate regular message
          if (response && response.trim()) {
            await client.query(
              `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
               VALUES ($1, $2, $3, NOW())`,
              [userId, application.applicant_id, response.trim()],
            );
          }
        }

        // === CREATE NOTIFICATIONS ===
        try {
          if (!isInternalRoleApp) {
            // Notify the applicant that they were approved for team membership.
            await createNotification({
              userId: application.applicant_id,
              type: "application_approved",
              title: approvalTitle,
              message: response || "Welcome to the team!",
              referenceType: "message",
              referenceId: approvalMessageResult?.rows[0]?.id || parseInt(applicationId),
              teamId: application.team_id,
              actorId: userId,
            });

            // Notify other team members about the new member.
            await notifyTeamMembers({
              teamId: application.team_id,
              excludeUserId: application.applicant_id,
              type: "member_joined",
              title: `${applicantName} joined ${application.team_name}`,
              referenceType: "message",
              referenceId:
                teamMessageResult?.rows[0]?.id || application.applicant_id,
              actorId: userId,
            });
          }

          // Emit socket events
          const io = req.app.get("io");
          if (io) {
            if (!isInternalRoleApp) {
              io.to(`user:${application.applicant_id}`).emit("notification:new", {
                type: "application_approved",
                teamId: application.team_id,
                title: approvalTitle,
                actorName: approverName,
                ...(application.role_id && application.role_name
                  ? { roleId: application.role_id, roleName: application.role_name }
                  : {}),
              });
              io.to(`team:${application.team_id}`).emit("notification:new", {
                type: "member_joined",
                teamId: application.team_id,
              });
            }
            for (const adminId of affectedAdminIds) {
              io.to(`user:${adminId}`).emit("notification:updated");
            }
          }
        } catch (notificationError) {
          console.error(
            "Error creating approval notification:",
            notificationError,
          );
        }
        // === END NOTIFICATION ===

        // Auto-fill the associated vacant role if the application targets one.
        // If the applicant already fills another role in this team, keep the
        // target role open and convert the approval into a role invitation.
        let roleFilled = false;
        let filledRoleName = null;
        let roleInvitationCreated = false;
        let roleInvitationId = null;
        let deferredByCurrentRoleName = null;
        let deferredInviteSocketData = null;

        if (application.role_id && fillRole) {
          const existingFilledRoleResult = await client.query(
            `SELECT id, role_name
             FROM team_vacant_roles
             WHERE team_id = $1
               AND filled_by = $2
               AND status = 'filled'
               AND id <> $3
             ORDER BY updated_at DESC
             LIMIT 1`,
            [application.team_id, application.applicant_id, application.role_id],
          );

          const existingFilledRole = existingFilledRoleResult.rows[0] || null;

          if (existingFilledRole) {
            deferredByCurrentRoleName = existingFilledRole.role_name;

            const existingInviteResult = await client.query(
              `SELECT id
               FROM team_invitations
               WHERE team_id = $1
                 AND invitee_id = $2
                 AND role_id = $3
                 AND status = 'pending'
               LIMIT 1`,
              [application.team_id, application.applicant_id, application.role_id],
            );

            if (existingInviteResult.rows.length > 0) {
              roleInvitationId = existingInviteResult.rows[0].id;
            } else if (application.role_status === "open") {
              const invitationResult = await client.query(
                `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, message, status, role_id, created_at)
                 VALUES ($1, $2, $3, $4, 'pending', $5, NOW())
                 RETURNING id`,
                [
                  application.team_id,
                  userId,
                  application.applicant_id,
                  `Your application for this role has been approved while you were already filling another role. You can accept this role offer once you leave your current role:`,
                  application.role_id,
                ],
              );
              roleInvitationId = invitationResult.rows[0].id;
            }

            roleInvitationCreated = roleInvitationId != null;

            if (roleInvitationCreated) {
              const deferredMessage = buildRoleApplicationDeferredInviteMessage({
                teamId: application.team_id,
                teamName: application.team_name,
                roleId: application.role_id,
                roleName: application.role_name,
                applicantId: application.applicant_id,
                applicantName,
                approverId: userId,
                approverName,
                currentRoleId: existingFilledRole.id,
                currentRoleName: existingFilledRole.role_name,
              });

              const deferredMessageResult = await client.query(
                `INSERT INTO messages (sender_id, team_id, content, sent_at)
                 VALUES ($1, $2, $3, NOW())
                 RETURNING id, sender_id, team_id, content, sent_at`,
                [userId, application.team_id, deferredMessage],
              );
              await emitInsertedMessage(req, deferredMessageResult.rows[0]);

              // Collect recipient list before notifications (still in transaction).
              // Must be outside the try/catch so socket emit is guaranteed even
              // if createNotification or notifyTeamMembers fails.
              const remainingMembersResult = await client.query(
                `SELECT user_id
                 FROM team_members
                 WHERE team_id = $1
                   AND user_id != $2`,
                [application.team_id, application.applicant_id],
              );
              deferredInviteSocketData = {
                applicantId: application.applicant_id,
                teamId: application.team_id,
                roleId: application.role_id,
                roleName: application.role_name,
                teamName: application.team_name,
                approverName,
                memberIds: remainingMembersResult.rows.map((r) => r.user_id),
              };

              try {
                await createNotification({
                  userId: application.applicant_id,
                  type: "role_application_deferred_invite",
                  title: `Your application for ${application.role_name} in ${application.team_name} is now a role offer`,
                  message: `You can accept this offer once you leave ${existingFilledRole.role_name}.`,
                  referenceType: "team_invitation",
                  referenceId: roleInvitationId,
                  teamId: application.team_id,
                  actorId: userId,
                });

                await notifyTeamMembers({
                  teamId: application.team_id,
                  excludeUserId: application.applicant_id,
                  type: "role_application_deferred_invite",
                  title: `${applicantName}'s application for ${application.role_name} was approved as a role offer`,
                  message: `${applicantName} already fills ${existingFilledRole.role_name}, so the new role remains available until they accept the offer.`,
                  referenceType: "message",
                  referenceId: deferredMessageResult.rows[0]?.id || roleInvitationId,
                  actorId: userId,
                });
              } catch (notificationError) {
                console.error("Error creating deferred role offer notification:", notificationError);
              }
            }
          } else {
            const roleUpdateResult = await client.query(
              `UPDATE team_vacant_roles
               SET status = 'filled', filled_by = $1, updated_at = NOW()
               WHERE id = $2 AND team_id = $3 AND status = 'open'
               RETURNING id, role_name`,
              [application.applicant_id, application.role_id, application.team_id],
            );
            roleFilled = roleUpdateResult.rows.length > 0;
            filledRoleName = roleFilled ? roleUpdateResult.rows[0].role_name : null;
          }
        }

        await client.query("COMMIT");

        // Emit deferred invite socket events after commit to avoid race condition
        // where the frontend fetches invitations before the DB row is visible
        if (deferredInviteSocketData) {
          const io = req.app.get("io");
          if (io) {
            io.to(`user:${deferredInviteSocketData.applicantId}`).emit("notification:new", {
              type: "role_application_deferred_invite",
              teamId: deferredInviteSocketData.teamId,
              roleId: deferredInviteSocketData.roleId,
              roleName: deferredInviteSocketData.roleName,
              title: `Your application for ${deferredInviteSocketData.roleName} in ${deferredInviteSocketData.teamName} is now a role offer`,
              actorName: deferredInviteSocketData.approverName,
            });
            for (const memberId of deferredInviteSocketData.memberIds) {
              io.to(`user:${memberId}`).emit("notification:updated");
            }
          }
        }

        return res.status(200).json({
          success: true,
          message: "Application approved successfully",
          data: {
            applicationId: parseInt(applicationId),
            status: "approved",
            roleFilled,
            filledRoleName,
            roleInvitationCreated,
            roleInvitationId,
            deferredByCurrentRoleName,
          },
        });
      } else if (action === "decline") {
        // Get approver's name for the decline message
        const approverName =
          approver.first_name && approver.last_name
            ? `${approver.first_name} ${approver.last_name}`
            : approver.username;

        // Update application status
        await client.query(
          `UPDATE team_applications 
           SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1
           WHERE id = $2`,
          [userId, applicationId],
        );

        // Get applicant's name for the message
        const applicantName =
          application.applicant_first_name && application.applicant_last_name
            ? `${application.applicant_first_name} ${application.applicant_last_name}`
            : application.applicant_username;

        // Include whether there's a personal message
        const hasPersonalMessage =
          response && response.trim() ? "true" : "false";

        // System message format includes all info for both perspectives
        const teamToken = `${application.team_id}:${application.team_name}`;
        const approverToken = `${userId}:${approverName}`;
        const applicantToken = `${application.applicant_id}:${applicantName}`;

        const declineSystemMessage = `🚫 APPLICATION_DECLINED: ${teamToken} | ${approverToken} | ${applicantToken} | ${hasPersonalMessage}`;

        const declineMessageResult = await client.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, sender_id, receiver_id, content, sent_at`,
          [userId, application.applicant_id, declineSystemMessage],
        );
        await emitInsertedMessage(req, declineMessageResult.rows[0]);

        // If there's a personal message, send it as a separate regular message
        if (response && response.trim()) {
          await client.query(
            `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, application.applicant_id, response.trim()],
          );
        }
        // === CREATE NOTIFICATION FOR REJECTED APPLICANT ===
        try {
          await createNotification({
            userId: application.applicant_id,
            type: "application_rejected",
            title: `Your application to ${application.team_name} was declined`,
            message: response || null,
            referenceType: "message",
            referenceId: declineMessageResult.rows[0]?.id || parseInt(applicationId),
            teamId: application.team_id,
            actorId: userId,
          });

          // Emit socket events
          const io = req.app.get("io");
          if (io) {
            io.to(`user:${application.applicant_id}`).emit("notification:new", {
              type: "application_rejected",
              teamId: application.team_id,
              title: `Your application to ${application.team_name} was declined`,
              actorName: approverName,
            });
            for (const adminId of affectedAdminIds) {
              io.to(`user:${adminId}`).emit("notification:updated");
            }
          }
        } catch (notificationError) {
          console.error(
            "Error creating rejection notification:",
            notificationError,
          );
        }

        // === END NOTIFICATION ===
      }

      // TODO: Send notification/message to applicant with response
      // This would involve creating a message in your messages table

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        message: `Application ${action}d successfully`,
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error handling team application:", error);
    res.status(500).json({
      success: false,
      message: "Error handling application",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


const applyToJoinTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const applicantId = req.user.id;
    const message = req.body.message;
    const isDraft = req.body.isDraft ?? req.body.is_draft ?? false;
    const roleId = req.body.roleId ?? req.body.role_id ?? null;
    const hasRoleId = roleId !== undefined && roleId !== null && roleId !== "";
    const normalizedRoleId = hasRoleId ? Number(roleId) : null;

    // Validation
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Application message is required",
      });
    }

    if (message.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message: "Message cannot exceed 500 characters",
      });
    }

    if (
      hasRoleId &&
      (!Number.isInteger(normalizedRoleId) || normalizedRoleId <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "roleId must be a positive integer when provided",
      });
    }

    // Check if team exists and is active
    const teamCheck = await db.pool.query(
      `SELECT id, name, owner_id, max_members FROM teams 
       WHERE id = $1 AND archived_at IS NULL`,
      [teamId],
    );

    if (teamCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamCheck.rows[0];

    if (normalizedRoleId !== null) {
      const roleCheck = await db.pool.query(
        `SELECT id
         FROM team_vacant_roles
         WHERE id = $1 AND team_id = $2 AND status = 'open'`,
        [normalizedRoleId, teamId],
      );

      if (roleCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Vacant role not found or is no longer open for this team",
        });
      }
    }

    // Check if user is already a member
    const memberCheck = await db.pool.query(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, applicantId],
    );

    const isAlreadyMember = memberCheck.rows.length > 0;

    if (isAlreadyMember && !normalizedRoleId) {
      return res.status(400).json({
        success: false,
        message: "You are already a member of this team. To apply for a role, please select a specific vacant role.",
      });
    }

    if (!isAlreadyMember) {
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

    if (isAlreadyMember && normalizedRoleId) {
      // Internal role application — check for duplicate role-specific application
      const existingRoleAppCheck = await db.pool.query(
        `SELECT id FROM team_applications
         WHERE team_id = $1 AND applicant_id = $2 AND role_id = $3 AND status = 'pending'`,
        [teamId, applicantId, normalizedRoleId],
      );

      if (existingRoleAppCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "You already have a pending application for this role",
        });
      }
    } else if (!isAlreadyMember) {
      // External application — keep existing general duplicate check
      const existingApplicationCheck = await db.pool.query(
        `SELECT id FROM team_applications
         WHERE team_id = $1 AND applicant_id = $2 AND status = 'pending'`,
        [teamId, applicantId],
      );

      if (existingApplicationCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "You already have a pending application for this team",
        });
      }
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      // Persist the optional role link when the application originates from a vacant role.
      const applicationResult = await client.query(
        `INSERT INTO team_applications (team_id, applicant_id, message, status, role_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id`,
        [
          teamId,
          applicantId,
          message.trim(),
          isDraft ? "draft" : "pending",
          normalizedRoleId,
        ],
      );

      await client.query("COMMIT");

      // === CREATE NOTIFICATION FOR TEAM ADMINS (only for submitted applications, not drafts) ===
      if (!isDraft) {
        try {
          // Get applicant's name
          const applicantResult = await db.pool.query(
            `SELECT first_name, last_name, username FROM users WHERE id = $1`,
            [applicantId],
          );
          const applicant = applicantResult.rows[0];
          const applicantName =
            applicant.first_name && applicant.last_name
              ? `${applicant.first_name} ${applicant.last_name}`
              : applicant.username;

          await notifyTeamAdmins({
            teamId: parseInt(teamId),
            type: "application_received",
            title: isAlreadyMember
              ? `${applicantName} applied for a role in ${team.name}`
              : `${applicantName} applied to join ${team.name}`,
            message: message || null,
            referenceType: "team_application",
            referenceId: applicationResult.rows[0].id,
            actorId: applicantId,
          });

          // Emit socket events to team admins
          const io = req.app.get("io");
          if (io) {
            io.to(`team:${teamId}`).emit("notification:new", {
              type: "application_received",
              teamId: parseInt(teamId),
              title: isAlreadyMember
                ? `New role application for ${team.name}`
                : `New application to join ${team.name}`,
              actorName: applicantName,
            });
          }
        } catch (notificationError) {
          console.error(
            "Error creating application notification:",
            notificationError,
          );
        }
      }
      // === END NOTIFICATION ===

      res.status(201).json({
        success: true,
        message: isAlreadyMember
          ? (isDraft ? "Role application draft saved" : "Role application sent to the team owner and admins")
          : (isDraft ? "Application draft saved successfully" : "Application sent successfully"),
        data: {
          applicationId: applicationResult.rows[0].id,
          status: isDraft ? "draft" : "pending",
          isInternalRoleApplication: isAlreadyMember,
        },
      });
    } catch (dbError) {
      await client.query("ROLLBACK");
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Apply to join team error:", error);
    res.status(500).json({
      success: false,
      message: "Error processing application",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};


module.exports = {
  getUserPendingApplications,
  cancelApplication,
  getTeamApplications,
  handleTeamApplication,
  applyToJoinTeam,
};
