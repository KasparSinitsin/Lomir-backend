const db = require("../config/database");

/**
 * Matching Controller
 *
 * Scores open vacant roles against a user's profile based on:
 *   1. Tag overlap   — user's focus areas vs role's desired tags
 *   2. Badge overlap  — user's earned badges vs role's desired badges
 *   3. Distance       — user's location vs role's preferred location
 *
 * Each dimension produces a 0–1 score. The final match_score is a
 * weighted average (configurable). Roles are returned sorted by score
 * descending.
 *
 * Distance scoring rules:
 *   - Remote role → 1.0 for everyone
 *   - Within the role's max_distance_km radius → 1.0 (100%)
 *   - Up to 20 km beyond the radius → 0.25 (25%)
 *   - Farther than 20 km beyond the radius → 0.0 (0%)
 *   - No location data on either side → 0.5 (neutral)
 */

// Scoring weights (must sum to 1.0)
const WEIGHTS = {
  tags: 0.4,
  badges: 0.3,
  distance: 0.3,
};

// How far beyond the radius a user can still get a partial score (km)
const LOCATION_GRACE_KM = 20;

// The partial score awarded when a user is within the grace zone
const LOCATION_GRACE_SCORE = 0.25;

// ============================================================
// Haversine helper — distance in km between two lat/lng points
// ============================================================
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ============================================================
// Distance scoring helper (shared by both endpoints)
// ============================================================
/**
 * Compute the distance score for a user/candidate relative to a role.
 *
 * @param {Object} opts
 * @param {boolean} opts.isRemote       — true if the role is remote
 * @param {number|null} opts.userLat    — user's latitude
 * @param {number|null} opts.userLng    — user's longitude
 * @param {number|null} opts.roleLat    — role's latitude
 * @param {number|null} opts.roleLng    — role's longitude
 * @param {number|null} opts.maxDistKm  — role's max_distance_km
 * @returns {{ score: number, distanceKm: number|null, isWithinRange: boolean|null }}
 */
const computeDistanceScore = ({
  isRemote,
  userLat,
  userLng,
  roleLat,
  roleLng,
  maxDistKm,
}) => {
  // Remote role — perfect score for everyone
  if (isRemote) {
    return { score: 1.0, distanceKm: null, isWithinRange: true };
  }

  // Both sides need coordinates
  if (userLat && userLng && roleLat && roleLng) {
    const distanceKm = haversineKm(userLat, userLng, roleLat, roleLng);
    const maxDist = maxDistKm || 50; // default radius if none set
    const withinRange = distanceKm <= maxDist;

    if (distanceKm <= maxDist) {
      // Within the radius → 100%
      return { score: 1.0, distanceKm, isWithinRange: true };
    } else if (distanceKm <= maxDist + LOCATION_GRACE_KM) {
      // Up to 20 km beyond the radius → 25%
      return { score: LOCATION_GRACE_SCORE, distanceKm, isWithinRange: false };
    } else {
      // Farther away → 0%
      return { score: 0.0, distanceKm, isWithinRange: false };
    }
  }

  // No location data on one or both sides → can't determine
  return { score: 0.5, distanceKm: null, isWithinRange: null };
};

// ============================================================
// GET /api/matching/roles
// Find vacant roles that match the authenticated user's profile
// ============================================================
const getMatchingRoles = async (req, res) => {
  try {
    const userId = req.user.id;

    // Optional query params
    const limit = parseInt(req.query.limit) || 20;
    const minScore = parseFloat(req.query.min_score) || 0;
    const teamId = req.query.team_id ? parseInt(req.query.team_id) : null;

    // ----------------------------------------------------------
    // 1. Fetch user profile data (tags, badges, location)
    // ----------------------------------------------------------
    const userResult = await db.pool.query(
      `SELECT id, latitude, longitude, postal_code, city, country
       FROM users WHERE id = $1`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    // User's tag IDs
    const userTagsResult = await db.pool.query(
      `SELECT tag_id FROM user_tags WHERE user_id = $1`,
      [userId],
    );
    const userTagIds = new Set(
      userTagsResult.rows.map((r) => Number(r.tag_id)),
    );

    // User's earned badge IDs (distinct)
    const userBadgesResult = await db.pool.query(
      `SELECT DISTINCT badge_id FROM badge_awards WHERE awarded_to_user_id = $1`,
      [userId],
    );
    const userBadgeIds = new Set(
      userBadgesResult.rows.map((r) => Number(r.badge_id)),
    );

    // ----------------------------------------------------------
    // 2. Fetch open vacant roles (with their tags + badges)
    //    When team_id is specified, scope to that team only
    //    and skip the "not a member" exclusion (user is viewing that team).
    //    Otherwise, exclude roles from teams the user is already in.
    // ----------------------------------------------------------
    const rolesQuery = teamId
      ? `SELECT vr.*,
                t.name AS team_name,
                t.description AS team_description,
                t.teamavatar_url,
                t.is_public AS team_is_public,
                t.is_synthetic AS team_is_synthetic,
                t.is_remote AS team_is_remote,
                (SELECT COUNT(*) FROM team_members WHERE team_id = vr.team_id) AS team_member_count,
                t.max_members AS team_max_members
         FROM team_vacant_roles vr
         JOIN teams t ON vr.team_id = t.id
         WHERE vr.status = 'open'
           AND t.archived_at IS NULL
           AND vr.team_id = $1
         ORDER BY vr.created_at DESC`
      : `SELECT vr.*,
                t.name AS team_name,
                t.description AS team_description,
                t.teamavatar_url,
                t.is_public AS team_is_public,
                t.is_synthetic AS team_is_synthetic,
                t.is_remote AS team_is_remote,
                (SELECT COUNT(*) FROM team_members WHERE team_id = vr.team_id) AS team_member_count,
                t.max_members AS team_max_members
         FROM team_vacant_roles vr
         JOIN teams t ON vr.team_id = t.id
         WHERE vr.status = 'open'
           AND t.archived_at IS NULL
           AND (t.is_public = TRUE OR EXISTS (
             SELECT 1 FROM team_members
             WHERE team_id = vr.team_id AND user_id = $1
           ))
           AND NOT EXISTS (
             SELECT 1 FROM team_members
             WHERE team_id = vr.team_id AND user_id = $1
           )
         ORDER BY vr.created_at DESC`;

    const rolesParams = teamId ? [teamId] : [userId];
    const rolesResult = await db.pool.query(rolesQuery, rolesParams);

    const roles = rolesResult.rows;

    if (roles.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          total: 0,
          user_tags: userTagIds.size,
          user_badges: userBadgeIds.size,
        },
      });
    }

    // Fetch tags and badges for all roles in batch
    const roleIds = roles.map((r) => r.id);

    const roleTagsResult = await db.pool.query(
      `SELECT role_id, tag_id FROM team_vacant_role_tags WHERE role_id = ANY($1)`,
      [roleIds],
    );

    const roleBadgesResult = await db.pool.query(
      `SELECT role_id, badge_id FROM team_vacant_role_badges WHERE role_id = ANY($1)`,
      [roleIds],
    );

    // Group by role_id
    const roleTagMap = {};
    const roleBadgeMap = {};

    for (const r of roleTagsResult.rows) {
      if (!roleTagMap[r.role_id]) roleTagMap[r.role_id] = [];
      roleTagMap[r.role_id].push(Number(r.tag_id));
    }

    for (const r of roleBadgesResult.rows) {
      if (!roleBadgeMap[r.role_id]) roleBadgeMap[r.role_id] = [];
      roleBadgeMap[r.role_id].push(Number(r.badge_id));
    }

    // Also fetch full tag/badge details for the response
    const roleTagsDetailResult = await db.pool.query(
      `SELECT vrt.role_id, t.id AS tag_id, t.name, t.category, t.supercategory
       FROM team_vacant_role_tags vrt
       JOIN tags t ON vrt.tag_id = t.id
       WHERE vrt.role_id = ANY($1)`,
      [roleIds],
    );

    const roleBadgesDetailResult = await db.pool.query(
      `SELECT vrb.role_id, b.id AS badge_id, b.name, b.category, b.color, b.image_url, b.cat_image_url
       FROM team_vacant_role_badges vrb
       JOIN badges b ON vrb.badge_id = b.id
       WHERE vrb.role_id = ANY($1)`,
      [roleIds],
    );

    const roleTagsDetailMap = {};
    const roleBadgesDetailMap = {};

    for (const r of roleTagsDetailResult.rows) {
      if (!roleTagsDetailMap[r.role_id]) roleTagsDetailMap[r.role_id] = [];
      roleTagsDetailMap[r.role_id].push(r);
    }

    for (const r of roleBadgesDetailResult.rows) {
      if (!roleBadgesDetailMap[r.role_id]) roleBadgesDetailMap[r.role_id] = [];
      roleBadgesDetailMap[r.role_id].push(r);
    }

    // ----------------------------------------------------------
    // 3. Score each role
    // ----------------------------------------------------------
    const scoredRoles = roles.map((role) => {
      const roleTags = roleTagMap[role.id] || [];
      const roleBadges = roleBadgeMap[role.id] || [];

      // --- Tag score (Jaccard-like: overlap / union) ---
      let tagScore = 0;
      if (roleTags.length > 0) {
        const matchingTags = roleTags.filter((id) => userTagIds.has(id));
        // Use role's desired tags as denominator (how well does user cover the role?)
        tagScore = matchingTags.length / roleTags.length;
      } else {
        // No tag requirement — neutral score (don't penalize)
        tagScore = 0.5;
      }

      // --- Badge score (same approach) ---
      let badgeScore = 0;
      if (roleBadges.length > 0) {
        const matchingBadges = roleBadges.filter((id) => userBadgeIds.has(id));
        badgeScore = matchingBadges.length / roleBadges.length;
      } else {
        badgeScore = 0.5;
      }

      // --- Distance score (new rules) ---
      const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
        isRemote: role.is_remote,
        userLat: user.latitude,
        userLng: user.longitude,
        roleLat: role.latitude,
        roleLng: role.longitude,
        maxDistKm: role.max_distance_km,
      });

      // --- Weighted final score ---
      const matchScore =
        WEIGHTS.tags * tagScore +
        WEIGHTS.badges * badgeScore +
        WEIGHTS.distance * distanceScore;

      // --- Detail breakdown ---
      const matchingTagIds = roleTags.filter((id) => userTagIds.has(id));
      const matchingBadgeIds = roleBadges.filter((id) => userBadgeIds.has(id));

      return {
        ...role,
        tags: roleTagsDetailMap[role.id] || [],
        badges: roleBadgesDetailMap[role.id] || [],
        match_score: Math.round(matchScore * 100) / 100,
        match_details: {
          tag_score: Math.round(tagScore * 100) / 100,
          badge_score: Math.round(badgeScore * 100) / 100,
          distance_score: Math.round(distanceScore * 100) / 100,
          matching_tags: matchingTagIds.length,
          total_required_tags: roleTags.length,
          matching_badges: matchingBadgeIds.length,
          total_required_badges: roleBadges.length,
          distance_km: distanceKm !== null ? Math.round(distanceKm) : null,
          max_distance_km: role.max_distance_km,
          is_within_range: isWithinRange,
        },
      };
    });

    // ----------------------------------------------------------
    // 4. Filter and sort
    // ----------------------------------------------------------
    const filtered = scoredRoles
      .filter((r) => r.match_score >= minScore)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit);

    res.status(200).json({
      success: true,
      data: filtered,
      meta: {
        total: filtered.length,
        total_open_roles: roles.length,
        user_tags: userTagIds.size,
        user_badges: userBadgeIds.size,
        weights: WEIGHTS,
      },
    });
  } catch (error) {
    console.error("Error finding matching roles:", error);
    res.status(500).json({
      success: false,
      message: "Error finding matching roles",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// ============================================================
// GET /api/matching/role/:roleId/candidates
// Find users that match a specific vacant role (for team admins)
// ============================================================
const getMatchingCandidates = async (req, res) => {
  try {
    const { roleId } = req.params;
    const userId = req.user.id;

    const limit = parseInt(req.query.limit) || 20;

    // Fetch the role
    const roleResult = await db.pool.query(
      `SELECT vr.*, t.id AS t_id
       FROM team_vacant_roles vr
       JOIN teams t ON vr.team_id = t.id
       WHERE vr.id = $1`,
      [roleId],
    );

    if (roleResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Vacant role not found",
      });
    }

    const role = roleResult.rows[0];

    // Authorization: must be owner or admin of the team
    const authCheck = await db.pool.query(
      `SELECT role FROM team_members
       WHERE team_id = $1 AND user_id = $2
       AND (role = 'owner' OR role = 'admin')`,
      [role.team_id, userId],
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view candidates for this role",
      });
    }

    // Role's desired tags and badges
    const roleTagsResult = await db.pool.query(
      `SELECT tag_id FROM team_vacant_role_tags WHERE role_id = $1`,
      [roleId],
    );
    const roleTagIds = roleTagsResult.rows.map((r) => Number(r.tag_id));

    const roleBadgesResult = await db.pool.query(
      `SELECT badge_id FROM team_vacant_role_badges WHERE role_id = $1`,
      [roleId],
    );
    const roleBadgeIds = roleBadgesResult.rows.map((r) => Number(r.badge_id));

    // Fetch candidate users (public profiles, not already in team)
    const usersResult = await db.pool.query(
      `SELECT u.id, u.first_name, u.last_name, u.username, u.bio,
              u.avatar_url, u.latitude, u.longitude, u.postal_code,
              u.city, u.country, u.state
       FROM users u
       WHERE u.is_public = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM team_members
           WHERE team_id = $1 AND user_id = u.id
         )
       ORDER BY u.id`,
      [role.team_id],
    );

    const users = usersResult.rows;

    if (users.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          total: 0,
          role_tags: roleTagIds.length,
          role_badges: roleBadgeIds.length,
        },
      });
    }

    // Batch fetch user tags and badges
    const userIds = users.map((u) => u.id);

    const userTagsResult = await db.pool.query(
      `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
      [userIds],
    );

    const userBadgesResult = await db.pool.query(
      `SELECT DISTINCT awarded_to_user_id AS user_id, badge_id
       FROM badge_awards WHERE awarded_to_user_id = ANY($1)`,
      [userIds],
    );

    // Group by user
    const userTagMap = {};
    const userBadgeMap = {};

    for (const r of userTagsResult.rows) {
      if (!userTagMap[r.user_id]) userTagMap[r.user_id] = new Set();
      // FIX: was previously a stray re-declaration of roleBadgeIds
      userTagMap[r.user_id].add(Number(r.tag_id));
    }

    for (const r of userBadgesResult.rows) {
      if (!userBadgeMap[r.user_id]) userBadgeMap[r.user_id] = new Set();
      userBadgeMap[r.user_id].add(Number(r.badge_id));
    }

    // Score each user
    const scoredUsers = users.map((candidate) => {
      const candidateTags = userTagMap[candidate.id] || new Set();
      const candidateBadges = userBadgeMap[candidate.id] || new Set();

      // Tag score
      let tagScore = 0;
      if (roleTagIds.length > 0) {
        const matching = roleTagIds.filter((id) => candidateTags.has(id));
        tagScore = matching.length / roleTagIds.length;
      } else {
        tagScore = 0.5;
      }

      // Badge score
      let badgeScore = 0;
      if (roleBadgeIds.length > 0) {
        const matching = roleBadgeIds.filter((id) => candidateBadges.has(id));
        badgeScore = matching.length / roleBadgeIds.length;
      } else {
        badgeScore = 0.5;
      }

      // Distance score (new rules)
      const { score: distanceScore, distanceKm, isWithinRange } = computeDistanceScore({
        isRemote: role.is_remote,
        userLat: candidate.latitude,
        userLng: candidate.longitude,
        roleLat: role.latitude,
        roleLng: role.longitude,
        maxDistKm: role.max_distance_km,
      });

      const matchScore =
        WEIGHTS.tags * tagScore +
        WEIGHTS.badges * badgeScore +
        WEIGHTS.distance * distanceScore;

      return {
        ...candidate,
        match_score: Math.round(matchScore * 100) / 100,
        match_details: {
          tag_score: Math.round(tagScore * 100) / 100,
          badge_score: Math.round(badgeScore * 100) / 100,
          distance_score: Math.round(distanceScore * 100) / 100,
          matching_tags: roleTagIds.filter((id) => candidateTags.has(id))
            .length,
          total_required_tags: roleTagIds.length,
          matching_badges: roleBadgeIds.filter((id) => candidateBadges.has(id))
            .length,
          total_required_badges: roleBadgeIds.length,
          distance_km: distanceKm !== null ? Math.round(distanceKm) : null,
          max_distance_km: role.max_distance_km,
          is_within_range: isWithinRange,
        },
      };
    });

    const sorted = scoredUsers
      .filter((u) => u.match_score > 0)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit);

    res.status(200).json({
      success: true,
      data: sorted,
      meta: {
        total: sorted.length,
        total_candidates: users.length,
        role_tags: roleTagIds.length,
        role_badges: roleBadgeIds.length,
        weights: WEIGHTS,
      },
    });
  } catch (error) {
    console.error("Error finding matching candidates:", error);
    res.status(500).json({
      success: false,
      message: "Error finding matching candidates",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getMatchingRoles,
  getMatchingCandidates,
  computeDistanceScore,
  WEIGHTS,
};
