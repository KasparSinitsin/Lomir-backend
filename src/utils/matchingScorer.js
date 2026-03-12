/**
 * matchingScorer.js
 *
 * Shared scoring logic extracted from matchingController.
 * Used by both the dedicated matching endpoints AND the search controller
 * (for "Best Match" capacity sorting).
 *
 * Usage:
 *   const { computeDistanceScore, scoreUserAgainstRole, WEIGHTS } = require("../utils/matchingScorer");
 */

// Scoring weights
const WEIGHTS = { tags: 0.4, badges: 0.3, distance: 0.3 };

/**
 * Haversine distance between two lat/lng points in km.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute distance score component.
 *
 * Rules:
 *  - Remote role → 1.0 for everyone
 *  - Missing coords on either side → neutral 0.5
 *  - Within max_distance_km → 1.0
 *  - Up to 20 km beyond → 0.25
 *  - Farther → 0.0
 *
 * @returns {{ score: number, distanceKm: number|null }}
 */
function computeDistanceScore({
  isRemote,
  userLat,
  userLng,
  roleLat,
  roleLng,
  maxDistKm,
}) {
  if (isRemote) return { score: 1.0, distanceKm: null };

  if (!userLat || !userLng || !roleLat || !roleLng) {
    return { score: 0.5, distanceKm: null };
  }

  const dist = haversineKm(userLat, userLng, roleLat, roleLng);
  const maxDist = maxDistKm || 50;

  let score;
  if (dist <= maxDist) {
    score = 1.0;
  } else if (dist <= maxDist + 20) {
    score = 0.25;
  } else {
    score = 0.0;
  }

  return { score, distanceKm: dist };
}

/**
 * Score a single user against a single vacant role.
 *
 * @param {Object} params
 * @param {Set<number>} params.userTagIds   — Set of tag IDs the user has
 * @param {Set<number>} params.userBadgeIds — Set of badge IDs the user has
 * @param {number|null}  params.userLat
 * @param {number|null}  params.userLng
 * @param {number[]}     params.roleTagIds  — tag IDs the role wants
 * @param {number[]}     params.roleBadgeIds — badge IDs the role wants
 * @param {Object}       params.role        — role row (needs is_remote, latitude, longitude, max_distance_km)
 * @returns {{ matchScore: number, tagScore: number, badgeScore: number, distanceScore: number, distanceKm: number|null }}
 */
function scoreUserAgainstRole({
  userTagIds,
  userBadgeIds,
  userLat,
  userLng,
  roleTagIds,
  roleBadgeIds,
  role,
}) {
  // Tag score
  let tagScore;
  if (roleTagIds.length > 0) {
    const matching = roleTagIds.filter((id) => userTagIds.has(id));
    tagScore = matching.length / roleTagIds.length;
  } else {
    tagScore = 0.5; // neutral
  }

  // Badge score
  let badgeScore;
  if (roleBadgeIds.length > 0) {
    const matching = roleBadgeIds.filter((id) => userBadgeIds.has(id));
    badgeScore = matching.length / roleBadgeIds.length;
  } else {
    badgeScore = 0.5; // neutral
  }

  // Distance score
  const { score: distanceScore, distanceKm } = computeDistanceScore({
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

  return {
    matchScore: Math.round(matchScore * 100) / 100,
    tagScore: Math.round(tagScore * 100) / 100,
    badgeScore: Math.round(badgeScore * 100) / 100,
    distanceScore: Math.round(distanceScore * 100) / 100,
    distanceKm: distanceKm !== null ? Math.round(distanceKm) : null,
  };
}

/**
 * Compute the best match score per team for a given user.
 *
 * Fetches all open vacant roles, scores them against the user,
 * and returns a Map<teamId, { bestScore, bestRoleId, roleCount }>.
 *
 * @param {Object} db        — database module with db.pool
 * @param {number} userId    — authenticated user ID
 * @returns {Promise<Map<number, { bestScore: number, bestRoleId: number, roleCount: number }>>}
 */
async function computeTeamMatchScores(db, userId) {
  const result = new Map();

  // 1. Get user's tags and badges
  const [userTagsRes, userBadgesRes] = await Promise.all([
    db.pool.query(`SELECT tag_id FROM user_tags WHERE user_id = $1`, [userId]),
    db.pool.query(
      `SELECT DISTINCT badge_id FROM user_badges WHERE user_id = $1`,
      [userId],
    ),
  ]);

  const userTagIds = new Set(userTagsRes.rows.map((r) => Number(r.tag_id)));
  const userBadgeIds = new Set(
    userBadgesRes.rows.map((r) => Number(r.badge_id)),
  );

  // Get user location
  const userRes = await db.pool.query(
    `SELECT latitude, longitude FROM users WHERE id = $1`,
    [userId],
  );
  const user = userRes.rows[0];
  if (!user) return result;

  // 2. Get all open vacant roles (excluding teams user is already in)
  const rolesRes = await db.pool.query(
    `SELECT vr.id, vr.team_id, vr.is_remote, vr.latitude, vr.longitude, vr.max_distance_km
     FROM team_vacant_roles vr
     JOIN teams t ON vr.team_id = t.id
     WHERE vr.status = 'open'
       AND t.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM team_members
         WHERE team_id = vr.team_id AND user_id = $1
       )`,
    [userId],
  );

  if (rolesRes.rows.length === 0) return result;

  const roleIds = rolesRes.rows.map((r) => r.id);

  // 3. Batch-fetch role tags and badges
  const [roleTagsRes, roleBadgesRes] = await Promise.all([
    db.pool.query(
      `SELECT role_id, tag_id FROM team_vacant_role_tags WHERE role_id = ANY($1)`,
      [roleIds],
    ),
    db.pool.query(
      `SELECT role_id, badge_id FROM team_vacant_role_badges WHERE role_id = ANY($1)`,
      [roleIds],
    ),
  ]);

  const roleTagMap = {};
  const roleBadgeMap = {};

  for (const r of roleTagsRes.rows) {
    if (!roleTagMap[r.role_id]) roleTagMap[r.role_id] = [];
    roleTagMap[r.role_id].push(Number(r.tag_id));
  }

  for (const r of roleBadgesRes.rows) {
    if (!roleBadgeMap[r.role_id]) roleBadgeMap[r.role_id] = [];
    roleBadgeMap[r.role_id].push(Number(r.badge_id));
  }

  // 4. Score each role and track best per team
  for (const role of rolesRes.rows) {
    const scores = scoreUserAgainstRole({
      userTagIds,
      userBadgeIds,
      userLat: user.latitude,
      userLng: user.longitude,
      roleTagIds: roleTagMap[role.id] || [],
      roleBadgeIds: roleBadgeMap[role.id] || [],
      role,
    });

    const existing = result.get(role.team_id);
    if (!existing || scores.matchScore > existing.bestScore) {
      result.set(role.team_id, {
        bestScore: scores.matchScore,
        bestRoleId: role.id,
        roleCount: (existing?.roleCount || 0) + 1,
      });
    } else {
      existing.roleCount += 1;
    }
  }

  return result;
}

module.exports = {
  WEIGHTS,
  haversineKm,
  computeDistanceScore,
  scoreUserAgainstRole,
  computeTeamMatchScores,
};