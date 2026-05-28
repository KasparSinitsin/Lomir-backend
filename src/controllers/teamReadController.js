const db = require("../config/database");

const getAllTeams = async (req, res) => {
  try {
    // Implement pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Query database with pagination
    const teamsResult = await db.pool.query(
      `
      SELECT t.*, 
             COUNT(tm.id) AS current_members_count
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `,
      [limit, offset],
    );

    // Get total count for pagination metadata
    const countResult = await db.pool.query(`
      SELECT COUNT(*) FROM teams WHERE archived_at IS NULL
    `);

    const totalTeams = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalTeams / limit);

    res.status(200).json({
      success: true,
      data: teamsResult.rows,
      pagination: {
        total: totalTeams,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Database error while fetching teams:", error); // More specific message
    res.status(500).json({
      success: false,
      message: "Database error while fetching teams", // More specific message
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const getTeamById = async (req, res) => {
  try {
    const teamId = req.params.id;

    // Fetch team details with member count
    const teamResult = await db.pool.query(
      `
      SELECT t.*,
             COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
             (SELECT COUNT(*) FROM team_vacant_roles vr WHERE vr.team_id = t.id AND vr.status = 'open') AS open_role_count
      FROM teams t
      LEFT JOIN team_members tm ON t.id = tm.team_id
      WHERE t.id = $1
      GROUP BY t.id
      `,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamResult.rows[0];

    // Get team members with their details
    const membersResult = await db.pool.query(
      `
  SELECT tm.user_id, tm.role, tm.joined_at,
         u.username, u.email, u.avatar_url,
         u.first_name, u.last_name, u.is_public, u.is_synthetic,
         u.postal_code, u.city, u.country, u.state
  FROM team_members tm
  JOIN users u ON tm.user_id = u.id
  WHERE tm.team_id = $1
  ORDER BY 
    CASE tm.role 
      WHEN 'owner' THEN 1 
      WHEN 'admin' THEN 2 
      ELSE 3 
    END,
    tm.joined_at ASC
  `,
      [teamId],
    );

    // Get team tags — enriched with aggregated badge credits from team members
    const tagsResult = await db.pool.query(
      `
      SELECT
        tt.tag_id,
        t.name,
        t.category,
        t.supercategory,
        COALESCE(SUM(ba.credits), 0)::int AS badge_credits,
        COUNT(ba.id)::int AS linked_badge_count,
        COUNT(DISTINCT ba.awarded_to_user_id)::int AS awardee_count,
        (
          SELECT b2.category
          FROM badge_awards ba2
          JOIN badges b2 ON ba2.badge_id = b2.id
          WHERE ba2.tag_id = t.id
            AND ba2.awarded_to_user_id IN (
              SELECT user_id FROM team_members WHERE team_id = $1
            )
          GROUP BY b2.category
          ORDER BY SUM(ba2.credits) DESC
          LIMIT 1
        ) AS dominant_badge_category
      FROM team_tags tt
      JOIN tags t ON tt.tag_id = t.id
      LEFT JOIN badge_awards ba
        ON ba.tag_id = t.id
        AND ba.awarded_to_user_id IN (
          SELECT user_id FROM team_members WHERE team_id = $1
        )
      WHERE tt.team_id = $1
      GROUP BY tt.tag_id, t.id, t.name, t.category, t.supercategory
      ORDER BY t.supercategory, t.category, t.name
      `,
      [teamId],
    );

    // Construct response with proper member count
    team.members = membersResult.rows;
    team.tags = tagsResult.rows;

    // Ensure boolean values (handle string "true" from DB)
    team.is_public = team.is_public === true || team.is_public === "true";

    res.status(200).json({
      success: true,
      data: team,
    });
  } catch (error) {
    console.error("Database error while fetching team:", error);
    res.status(500).json({
      success: false,
      message: "Database error while fetching team details",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * Get all teams for the authenticated user with pagination
 *
 * @route GET /api/teams/my-teams
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Results per page (default: 10)
 */
const getUserTeams = async (req, res) => {
  try {
    // Use the authenticated user's ID from the token
    const userId = req.user.id;

    // === PAGINATION PARAMETERS ===
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // === COUNT QUERY - Get total teams for pagination metadata ===
    const countResult = await db.pool.query(
      `
      SELECT COUNT(DISTINCT t.id) as total
      FROM teams t
      JOIN team_members tmr ON t.id = tmr.team_id AND tmr.user_id = $1
      WHERE t.archived_at IS NULL
      `,
      [userId],
    );

    const totalTeams = parseInt(countResult.rows[0].total);

    // === DATA QUERY - Get paginated teams ===
    // Includes tags + location columns so TeamCard can render in list/card
    // views without re-fetching the team detail per card.
    const teamsResult = await db.pool.query(
      `
      SELECT t.id,
             t.name,
             t.description,
             t.teamavatar_url,
             t.max_members,
             t.is_public,
             t.is_synthetic,
             t.owner_id,
             t.created_at,
             t.updated_at,
             t.postal_code,
             t.city,
             t.state,
             t.country,
             t.latitude,
             t.longitude,
             t.is_remote,
             COALESCE(COUNT(DISTINCT tm.user_id), 0) AS current_members_count,
             (SELECT COUNT(*) FROM team_vacant_roles vr WHERE vr.team_id = t.id AND vr.status = 'open') AS open_role_count,
             (SELECT COUNT(*)::int FROM team_applications ta WHERE ta.team_id = t.id AND ta.status = 'pending') AS pending_applications_count,
             (SELECT COUNT(*)::int FROM team_invitations ti WHERE ti.team_id = t.id AND ti.status = 'pending') AS pending_sent_invitations_count,
             GREATEST(
               (SELECT MAX(ta.created_at) FROM team_applications ta WHERE ta.team_id = t.id AND ta.status = 'pending'),
               (SELECT MAX(ti.created_at) FROM team_invitations ti WHERE ti.team_id = t.id AND ti.status = 'pending')
             ) AS latest_request_timestamp,
             tmr.role as user_role,
             COALESCE(
               json_agg(
                 DISTINCT jsonb_build_object(
                   'id', tag.id,
                   'name', tag.name,
                   'category', tag.category
                 )
               ) FILTER (WHERE tag.id IS NOT NULL),
               '[]'::json
             ) AS tags
      FROM teams t
      JOIN team_members tmr ON t.id = tmr.team_id AND tmr.user_id = $1
      LEFT JOIN team_members tm ON t.id = tm.team_id
      LEFT JOIN team_tags tt ON t.id = tt.team_id
      LEFT JOIN tags tag ON tt.tag_id = tag.id
      WHERE t.archived_at IS NULL
      GROUP BY t.id, tmr.role
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset],
    );

    // Ensure boolean values for is_public
    const teamsWithFixedVisibility = teamsResult.rows.map((team) => ({
      ...team,
      is_public: team.is_public === true || team.is_public === "true",
    }));

    // === RETURN RESPONSE WITH PAGINATION METADATA ===
    res.status(200).json({
      success: true,
      data: teamsWithFixedVisibility,
      pagination: {
        page,
        limit,
        totalTeams,
        totalPages: Math.ceil(totalTeams / limit),
        hasNextPage: offset + limit < totalTeams,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Database error while fetching user teams:", error);
    res.status(500).json({
      success: false,
      message: "Database error while fetching user teams",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const getUserRoleInTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    const userId = req.params.userId;

    const roleResult = await db.pool.query(
      `
      SELECT role 
      FROM team_members 
      WHERE team_id = $1 AND user_id = $2
      `,
      [teamId, userId],
    );

    // User is NOT a member (normal case, not an error)
    if (roleResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        isMember: false,
        role: null,
      });
    }

    // User IS a member
    return res.status(200).json({
      success: true,
      isMember: true,
      role: roleResult.rows[0].role,
    });
  } catch (error) {
    console.error("Error fetching user role:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching user role",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getAllTeams,
  getTeamById,
  getUserTeams,
  getUserRoleInTeam,
};
