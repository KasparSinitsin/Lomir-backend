/**
 * matchingScorer.js
 *
 * Shared scoring logic for the matching system.
 * Used by:
 *   - matchingController.js (dedicated matching endpoints for vacant roles)
 *   - searchController.js   (Best Match sort on search page)
 *
 * Usage:
 *   const {
 *     computeDistanceScore,
 *     scoreUserAgainstRole,
 *     computeTeamMatchScores,       // best vacant-role match per team
 *     computeTeamTagOverlap,        // tag overlap between user and teams
 *     computeUserProfileOverlap,    // tag+badge overlap between users
 *     WEIGHTS,
 *   } = require("../utils/matchingScorer");
 */

// Scoring weights for vacant-role matching
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
 * Compute distance score component for vacant-role matching.
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
  let tagScore;
  if (roleTagIds.length > 0) {
    const matching = roleTagIds.filter((id) => userTagIds.has(id));
    tagScore = matching.length / roleTagIds.length;
  } else {
    tagScore = 0.5;
  }

  let badgeScore;
  if (roleBadgeIds.length > 0) {
    const matching = roleBadgeIds.filter((id) => userBadgeIds.has(id));
    badgeScore = matching.length / roleBadgeIds.length;
  } else {
    badgeScore = 0.5;
  }

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
 * Compute the best vacant-role match score per team for a given user.
 * Used for "Open Roles Only" filter in Best Match search.
 *
 * @param {Object} db
 * @param {number} userId
 * @returns {Promise<Map<number, { bestScore, bestRoleId, roleCount }>>}
 */
async function computeTeamMatchScores(db, userId) {
  const result = new Map();

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

  const userRes = await db.pool.query(
    `SELECT latitude, longitude FROM users WHERE id = $1`,
    [userId],
  );
  const user = userRes.rows[0];
  if (!user) return result;

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

// ============================================================
// NEW: Profile-based overlap scoring (for Best Match sort)
// ============================================================

/**
 * Compute tag overlap scores between a user and all teams.
 *
 * Score = (number of shared tags between user and team) / (total unique tags across both)
 * This is the Jaccard similarity coefficient.
 *
 * @param {Object} db
 * @param {number} userId
 * @param {number[]} teamIds — team IDs to score (from the current result page)
 * @returns {Promise<Map<number, { overlapScore, sharedCount, userTagCount, teamTagCount }>>}
 */
async function computeTeamTagOverlap(db, userId, teamIds) {
  const result = new Map();
  if (!teamIds || teamIds.length === 0) return result;

  // Get user's tags
  const userTagsRes = await db.pool.query(
    `SELECT tag_id FROM user_tags WHERE user_id = $1`,
    [userId],
  );
  const userTagIds = new Set(userTagsRes.rows.map((r) => Number(r.tag_id)));

  if (userTagIds.size === 0) return result;

  // Get tags for all teams in batch
  const teamTagsRes = await db.pool.query(
    `SELECT team_id, tag_id FROM team_tags WHERE team_id = ANY($1)`,
    [teamIds],
  );

  // Group by team
  const teamTagMap = {};
  for (const r of teamTagsRes.rows) {
    if (!teamTagMap[r.team_id]) teamTagMap[r.team_id] = new Set();
    teamTagMap[r.team_id].add(Number(r.tag_id));
  }

  // Score each team
  for (const teamId of teamIds) {
    const teamTags = teamTagMap[teamId] || new Set();

    if (teamTags.size === 0) {
      result.set(teamId, {
        overlapScore: 0,
        sharedCount: 0,
        userTagCount: userTagIds.size,
        teamTagCount: 0,
      });
      continue;
    }

    // Count shared tags
    let sharedCount = 0;
    for (const tagId of teamTags) {
      if (userTagIds.has(tagId)) sharedCount++;
    }

    // Jaccard similarity: shared / union
    const unionSize = new Set([...userTagIds, ...teamTags]).size;
    const overlapScore = unionSize > 0 ? sharedCount / unionSize : 0;

    result.set(teamId, {
      overlapScore: Math.round(overlapScore * 100) / 100,
      sharedCount,
      userTagCount: userTagIds.size,
      teamTagCount: teamTags.size,
    });
  }

  return result;
}

/**
 * Compute profile overlap scores between a user and other users.
 *
 * Score = weighted average of tag overlap (60%) and badge overlap (40%).
 * Each overlap uses Jaccard similarity.
 *
 * @param {Object} db
 * @param {number} userId — the authenticated user
 * @param {number[]} otherUserIds — user IDs to score
 * @returns {Promise<Map<number, { overlapScore, tagOverlap, badgeOverlap, sharedTagCount, sharedBadgeCount }>>}
 */
async function computeUserProfileOverlap(db, userId, otherUserIds) {
  const result = new Map();
  if (!otherUserIds || otherUserIds.length === 0) return result;

  // Filter out self
  const filteredIds = otherUserIds.filter((id) => id !== userId);
  if (filteredIds.length === 0) return result;

  // Get current user's tags and badges
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

  // Get tags and badges for all other users in batch
  const [otherTagsRes, otherBadgesRes] = await Promise.all([
    db.pool.query(
      `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
      [filteredIds],
    ),
    db.pool.query(
      `SELECT DISTINCT user_id, badge_id FROM user_badges WHERE user_id = ANY($1)`,
      [filteredIds],
    ),
  ]);

  // Group by user
  const otherTagMap = {};
  const otherBadgeMap = {};

  for (const r of otherTagsRes.rows) {
    if (!otherTagMap[r.user_id]) otherTagMap[r.user_id] = new Set();
    otherTagMap[r.user_id].add(Number(r.tag_id));
  }

  for (const r of otherBadgesRes.rows) {
    if (!otherBadgeMap[r.user_id]) otherBadgeMap[r.user_id] = new Set();
    otherBadgeMap[r.user_id].add(Number(r.badge_id));
  }

  // Score each user
  for (const otherId of filteredIds) {
    const otherTags = otherTagMap[otherId] || new Set();
    const otherBadges = otherBadgeMap[otherId] || new Set();

    // Tag overlap (Jaccard)
    let tagOverlap = 0;
    let sharedTagCount = 0;
    if (userTagIds.size > 0 || otherTags.size > 0) {
      for (const tagId of otherTags) {
        if (userTagIds.has(tagId)) sharedTagCount++;
      }
      const tagUnion = new Set([...userTagIds, ...otherTags]).size;
      tagOverlap = tagUnion > 0 ? sharedTagCount / tagUnion : 0;
    }

    // Badge overlap (Jaccard)
    let badgeOverlap = 0;
    let sharedBadgeCount = 0;
    if (userBadgeIds.size > 0 || otherBadges.size > 0) {
      for (const badgeId of otherBadges) {
        if (userBadgeIds.has(badgeId)) sharedBadgeCount++;
      }
      const badgeUnion = new Set([...userBadgeIds, ...otherBadges]).size;
      badgeOverlap = badgeUnion > 0 ? sharedBadgeCount / badgeUnion : 0;
    }

    // Weighted score: tags 60%, badges 40%
    const overlapScore = 0.6 * tagOverlap + 0.4 * badgeOverlap;

    result.set(otherId, {
      overlapScore: Math.round(overlapScore * 100) / 100,
      tagOverlap: Math.round(tagOverlap * 100) / 100,
      badgeOverlap: Math.round(badgeOverlap * 100) / 100,
      sharedTagCount,
      sharedBadgeCount,
    });
  }

  return result;
}

module.exports = {
  WEIGHTS,
  haversineKm,
  computeDistanceScore,
  scoreUserAgainstRole,
  computeTeamMatchScores,
  computeTeamTagOverlap,
  computeUserProfileOverlap,
};