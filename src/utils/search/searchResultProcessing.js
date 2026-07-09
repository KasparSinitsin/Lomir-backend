// Post-query shaping: tag/badge enrichment, viewer match scoring, boolean
// search-clause assembly, and privacy sanitizers for user/team rows.

const db = require("../../config/database");
const { scoreUserAgainstRole } = require("../matchingScorer");
const { parseBooleanSearch } = require("../booleanSearchParser");
const { deriveLocationFromPostalCode } = require("../locationDerivation");
const {
  normalizeRoleSearchRow,
  normalizeNullableNumber,
  roundOverlapScore,
} = require("./searchSqlBuilders");

function computeJaccardOverlap(baseSet, candidateIds) {
  const candidateSet = new Set(
    candidateIds.map((id) => Number(id)).filter(Number.isFinite),
  );

  let sharedCount = 0;
  for (const id of candidateSet) {
    if (baseSet.has(id)) sharedCount++;
  }

  const unionSize = new Set([...baseSet, ...candidateSet]).size;
  const score = unionSize > 0 ? sharedCount / unionSize : 0;

  return {
    sharedCount,
    score: roundOverlapScore(score),
  };
}

async function enrichRolesWithTagsAndBadges(roles) {
  if (!roles || roles.length === 0) return [];

  const roleIds = roles.map((role) => Number(role.id)).filter(Number.isFinite);

  if (roleIds.length === 0) {
    return roles.map((role) => ({
      ...normalizeRoleSearchRow(role),
      tags: [],
      badges: [],
    }));
  }

  const [tagsResult, badgesResult] = await Promise.all([
    db.pool.query(
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
    ),
    db.pool.query(
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
    ),
  ]);

  const tagsByRole = new Map();
  const badgesByRole = new Map();

  for (const tag of tagsResult.rows) {
    const roleId = Number(tag.role_id);
    if (!tagsByRole.has(roleId)) tagsByRole.set(roleId, []);
    tagsByRole.get(roleId).push(tag);
  }

  for (const badge of badgesResult.rows) {
    const roleId = Number(badge.role_id);
    if (!badgesByRole.has(roleId)) badgesByRole.set(roleId, []);
    badgesByRole.get(roleId).push(badge);
  }

  return roles.map((role) => {
    const normalizedRole = normalizeRoleSearchRow(role);
    const roleId = Number(role.id);

    return {
      ...normalizedRole,
      tags: tagsByRole.get(roleId) || [],
      badges: badgesByRole.get(roleId) || [],
    };
  });
}

async function applyViewerRoleMatchScores(roles, userId) {
  if (!userId || !roles || roles.length === 0) return roles || [];

  const [viewerTagsResult, viewerBadgesResult, viewerLocationResult] =
    await Promise.all([
      db.pool.query(`SELECT tag_id FROM user_tags WHERE user_id = $1`, [
        userId,
      ]),
      db.pool.query(
        `SELECT DISTINCT badge_id FROM badge_awards WHERE awarded_to_user_id = $1`,
        [userId],
      ),
      db.pool.query(`SELECT latitude, longitude FROM users WHERE id = $1`, [
        userId,
      ]),
    ]);

  const viewerTagIds = new Set(
    viewerTagsResult.rows
      .map((row) => Number(row.tag_id))
      .filter(Number.isFinite),
  );
  const viewerBadgeIds = new Set(
    viewerBadgesResult.rows
      .map((row) => Number(row.badge_id))
      .filter(Number.isFinite),
  );
  const viewerLocation = viewerLocationResult.rows[0] || {};
  const viewerLat = normalizeNullableNumber(viewerLocation.latitude);
  const viewerLng = normalizeNullableNumber(viewerLocation.longitude);

  return roles.map((role) => {
    const roleTagIds = (role.tags || [])
      .map((tag) => Number(tag.tag_id ?? tag.id))
      .filter(Number.isFinite);
    const roleBadgeIds = (role.badges || [])
      .map((badge) => Number(badge.badge_id ?? badge.id))
      .filter(Number.isFinite);
    const scores = scoreUserAgainstRole({
      userTagIds: viewerTagIds,
      userBadgeIds: viewerBadgeIds,
      userLat: viewerLat,
      userLng: viewerLng,
      roleTagIds,
      roleBadgeIds,
      role,
    });

    return {
      ...role,
      best_match_score: scores.matchScore,
      match_details: {
        tag_score: scores.tagScore,
        badge_score: scores.badgeScore,
        distance_score: scores.distanceScore,
        distance_km: scores.distanceKm,
      },
      match_type: "role_match",
    };
  });
}

function appendTeamSearchClause({
  teamQuery,
  teamParams,
  query,
  searchTerm,
  useBoolean,
  startParamIndex,
}) {
  let nextParamIndex = startParamIndex;

  if (useBoolean) {
    const teamColumns = ["t.name", "t.description", "tag.name", "t.city"];
    const teamTagConfig = {
      tagColumn: "tag.name",
      existsTemplate:
        "EXISTS (SELECT 1 FROM team_tags tt2 JOIN tags t2 ON tt2.tag_id = t2.id WHERE tt2.team_id = t.id AND t2.name ILIKE $PARAM)",
      notExistsTemplate:
        "NOT EXISTS (SELECT 1 FROM team_tags tt2 JOIN tags t2 ON tt2.tag_id = t2.id WHERE tt2.team_id = t.id AND t2.name ILIKE $PARAM)",
    };
    const teamSearch = parseBooleanSearch(
      query,
      teamColumns,
      nextParamIndex,
      teamTagConfig,
    );
    teamQuery += ` AND ${teamSearch.whereClause}`;
    teamParams.push(...teamSearch.params);
    nextParamIndex = teamSearch.nextParamIndex;
  } else {
    teamQuery += `
          AND (
            t.name ILIKE $${nextParamIndex} OR
            t.description ILIKE $${nextParamIndex} OR
            t.city ILIKE $${nextParamIndex} OR
            tag.name ILIKE $${nextParamIndex}
          )
        `;
    teamParams.push(searchTerm);
    nextParamIndex++;
  }

  return { nextParamIndex, query: teamQuery };
}

function appendUserSearchClause({
  userQuery,
  userParams,
  query,
  searchTerm,
  useBoolean,
  startParamIndex,
}) {
  let nextParamIndex = startParamIndex;

  if (useBoolean) {
    const userColumns = [
      "u.username",
      "u.first_name",
      "u.last_name",
      "u.bio",
      "t.name",
      "u.city",
    ];
    const userTagConfig = {
      tagColumn: "t.name",
      existsTemplate:
        "EXISTS (SELECT 1 FROM user_tags ut2 JOIN tags t2 ON ut2.tag_id = t2.id WHERE ut2.user_id = u.id AND t2.name ILIKE $PARAM)",
      notExistsTemplate:
        "NOT EXISTS (SELECT 1 FROM user_tags ut2 JOIN tags t2 ON ut2.tag_id = t2.id WHERE ut2.user_id = u.id AND t2.name ILIKE $PARAM)",
      extraExistsTemplates: [
        "EXISTS (SELECT 1 FROM v_user_badges_with_totals ubt WHERE ubt.user_id = u.id AND ubt.badge_name ILIKE $PARAM)",
      ],
      extraNotExistsTemplates: [
        "NOT EXISTS (SELECT 1 FROM v_user_badges_with_totals ubt WHERE ubt.user_id = u.id AND ubt.badge_name ILIKE $PARAM)",
      ],
    };
    const userSearch = parseBooleanSearch(
      query,
      userColumns,
      nextParamIndex,
      userTagConfig,
    );
    userQuery += ` AND ${userSearch.whereClause}`;
    userParams.push(...userSearch.params);
    nextParamIndex = userSearch.nextParamIndex;
  } else {
    userQuery += `
          AND (
            u.username ILIKE $${nextParamIndex} OR
            u.first_name ILIKE $${nextParamIndex} OR
            u.last_name ILIKE $${nextParamIndex} OR
            u.bio ILIKE $${nextParamIndex} OR
            u.city ILIKE $${nextParamIndex} OR
            t.name ILIKE $${nextParamIndex} OR
            EXISTS (
              SELECT 1
              FROM v_user_badges_with_totals ubt
              WHERE ubt.user_id = u.id
                AND ubt.badge_name ILIKE $${nextParamIndex}
            )
          )
        `;
    userParams.push(searchTerm);
    nextParamIndex++;
  }

  return { nextParamIndex, query: userQuery };
}

// Exact GPS coordinates are stripped to protect privacy. Search results expose
// rounded coordinates only, including legacy latitude/longitude keys so older
// map clients can still place pins without receiving precise stored values.
const toApproxCoord = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

const sanitizeSearchUser = ({ latitude, longitude, ...safe }) => {
  const approxLat = toApproxCoord(latitude);
  const approxLng = toApproxCoord(longitude);
  const derivedLocation = deriveLocationFromPostalCode(
    safe.postal_code,
    safe.country,
  );

  return {
    ...safe,
    city: safe.city || derivedLocation.city || null,
    state: safe.state || derivedLocation.state || null,
    country: safe.country || derivedLocation.country || null,
    district:
      safe.district ||
      safe.suburb ||
      safe.borough ||
      safe.cityDistrict ||
      derivedLocation.district ||
      null,
    latitude: approxLat,
    longitude: approxLng,
    approximate_latitude: approxLat,
    approximate_longitude: approxLng,
  };
};

const sanitizeSearchTeam = ({ latitude, longitude, ...safe }) => {
  const approxLat = toApproxCoord(latitude);
  const approxLng = toApproxCoord(longitude);
  const derivedLocation = deriveLocationFromPostalCode(
    safe.postal_code,
    safe.country,
  );

  return {
    ...safe,
    city: safe.city || derivedLocation.city || null,
    state: safe.state || derivedLocation.state || null,
    country: safe.country || derivedLocation.country || null,
    district:
      safe.district ||
      safe.suburb ||
      safe.borough ||
      safe.cityDistrict ||
      derivedLocation.district ||
      null,
    latitude: approxLat,
    longitude: approxLng,
    approximate_latitude: approxLat,
    approximate_longitude: approxLng,
  };
};

module.exports = {
  computeJaccardOverlap,
  enrichRolesWithTagsAndBadges,
  applyViewerRoleMatchScores,
  appendTeamSearchClause,
  appendUserSearchClause,
  sanitizeSearchUser,
  sanitizeSearchTeam,
};
