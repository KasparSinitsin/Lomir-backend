const db = require("../config/database");
const {
  parseBooleanSearch,
  hasBooleanOperators,
  validateBooleanQuery,
} = require("../utils/booleanSearchParser");
const {
  computeTeamProfileMatchScores,
  computeUserProfileOverlap,
  scoreUserAgainstRole,
} = require("../utils/matchingScorer");
const {
  buildCityDistanceSQL,
  buildDistanceFilterSQL,
  buildDistanceSelectSQL,
  buildNearestPrioritySQL,
  buildPostalCodeDistanceSQL,
} = require("../utils/searchQueryBuilder");
const { deriveLocationFromPostalCode } = require("../utils/locationDerivation");

const VALID_SEARCH_TYPES = ["all", "teams", "users", "roles"];
const VALID_ROLE_SORTS = ["recent", "newest", "name", "match", "proximity"];

function parseSearchType(value) {
  if (typeof value !== "string") return "all";

  const normalized = value.toLowerCase();
  return VALID_SEARCH_TYPES.includes(normalized) ? normalized : "all";
}

function parseBooleanFlag(value) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function parseIncludeDemoData(value) {
  return !(typeof value === "string" && value.toLowerCase() === "false");
}

function parseRoleSort(value) {
  if (typeof value !== "string") return "newest";

  const normalized = value.toLowerCase();
  return VALID_ROLE_SORTS.includes(normalized) ? normalized : "newest";
}

function parseSearchParams(req) {
  const { sortBy, sortDir } = req.query;
  const userId = req.user?.id;
  const searchType = parseSearchType(req.query.searchType);
  const includeTeams = searchType === "all" || searchType === "teams";
  const includeUsers = searchType === "all" || searchType === "users";
  const includeRoles = searchType === "roles";
  const openRolesOnly = parseBooleanFlag(req.query.openRolesOnly);
  const includeDemoData = parseIncludeDemoData(req.query.includeDemoData);
  const excludeOwnTeams =
    parseBooleanFlag(req.query.excludeOwnTeams) && !!userId;
  const excludeTeamId = req.query.excludeTeamId
    ? parseInt(req.query.excludeTeamId, 10)
    : null;
  const hasValidExcludeTeamId =
    excludeTeamId !== null &&
    Number.isFinite(excludeTeamId) &&
    excludeTeamId > 0;

  const tagIds = req.query.tagIds
    ? req.query.tagIds.split(",").map(Number).filter(Number.isFinite)
    : [];
  const badgeIds = req.query.badgeIds
    ? req.query.badgeIds.split(",").map(Number).filter(Number.isFinite)
    : [];

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;

  const validSortOptions = [
    "recent",
    "newest",
    "name",
    "capacity",
    "proximity",
    "match",
  ];
  const sort = validSortOptions.includes(sortBy) ? sortBy : "name";
  const roleSort = parseRoleSort(sortBy);

  const validDirections = ["asc", "desc", "remote"];
  const direction = validDirections.includes(sortDir)
    ? sortDir.toUpperCase()
    : "ASC";

  const isMatchSort = sort === "match" && !!userId;
  const matchRoleId = req.query.roleId
    ? parseInt(req.query.roleId, 10)
    : null;

  const maxDistance = req.query.maxDistance
    ? parseFloat(req.query.maxDistance)
    : null;
  const hasValidMaxDistance =
    maxDistance !== null && Number.isFinite(maxDistance) && maxDistance > 0;

  const capacityMode = req.query.capacityMode === "roles" ? "roles" : "spots";

  return {
    badgeIds,
    capacityMode,
    direction,
    excludeOwnTeams,
    excludeTeamId,
    hasValidExcludeTeamId,
    hasValidMaxDistance,
    includeDemoData,
    includeRoles,
    includeTeams,
    includeUsers,
    isMatchSort,
    limit,
    matchRoleId,
    maxDistance,
    offset,
    openRolesOnly,
    page,
    roleSort,
    searchType,
    sort,
    tagIds,
    userId,
  };
}

function getRolesSortDir(sort, direction) {
  if (sort === "proximity") {
    return direction === "REMOTE" ? "remote" : "asc";
  }

  if (sort === "name") {
    return direction === "DESC" ? "desc" : "asc";
  }

  return "desc";
}

function roundOverlapScore(value) {
  return Math.round(value * 100) / 100;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("Error parsing JSON array:", value, error);
      return [];
    }
  }

  return [];
}

function normalizeRoleSearchRow(role) {
  const distanceKm = normalizeNullableNumber(role.distance_km);

  return {
    ...role,
    latitude: normalizeNullableNumber(role.latitude),
    longitude: normalizeNullableNumber(role.longitude),
    max_distance_km: normalizeNullableNumber(role.max_distance_km),
    distance_km:
      distanceKm !== null ? parseFloat(Number(distanceKm).toFixed(1)) : null,
    is_remote: role.is_remote === true || role.is_remote === "true",
    team_is_remote:
      role.team_is_remote === true || role.team_is_remote === "true",
  };
}

function buildRoleNearestPrioritySQL(userLocation) {
  return buildNearestPrioritySQL("vr", userLocation);
}

function buildRoleOrderBy(sort, direction, userLocation) {
  if (sort === "name") {
    return direction === "DESC"
      ? "vr.role_name DESC, vr.created_at DESC"
      : "vr.role_name ASC, vr.created_at DESC";
  }

  if (sort === "proximity") {
    if (direction === "REMOTE" && userLocation) {
      return "(CASE WHEN vr.is_remote IS TRUE THEN 0 ELSE 1 END) ASC, distance_km DESC, vr.role_name ASC";
    }

    if (direction === "REMOTE") {
      return "(CASE WHEN vr.is_remote IS TRUE THEN 0 ELSE 1 END) ASC, vr.role_name ASC";
    }

    if (userLocation) {
      return `${buildRoleNearestPrioritySQL(userLocation)} ASC, distance_km ASC, vr.role_name ASC`;
    }

    return "(CASE WHEN vr.is_remote IS TRUE THEN 1 ELSE 0 END) ASC, vr.role_name ASC";
  }

  return "vr.created_at DESC";
}

function buildTeamNearestPrioritySQL(userLocation) {
  return buildNearestPrioritySQL("t", userLocation);
}

function buildTeamFilters(config, startParamIndex = 1) {
  const {
    badgeIds,
    combineTagBadgeWithOr = false,
    direction,
    excludeOwnTeams,
    hasValidMaxDistance,
    includeDemoData,
    matchRoleId,
    maxDistance,
    openRolesOnly,
    tagIds,
    userId,
    userLocation,
  } = config;
  const whereFragments = [];
  const params = [];
  let nextParamIndex = startParamIndex;

  if (userId) {
    whereFragments.push(`
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${nextParamIndex}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${nextParamIndex}
            )
          )
        `);
    params.push(userId);
    nextParamIndex++;
  } else {
    whereFragments.push(` AND t.is_public = TRUE`);
  }

  if (!includeDemoData) {
    whereFragments.push(` AND t.is_synthetic IS NOT TRUE`);
  }

  if (openRolesOnly) {
    whereFragments.push(`
          AND EXISTS (
            SELECT 1
            FROM team_vacant_roles vr_filter
            WHERE vr_filter.team_id = t.id
              AND vr_filter.status = 'open'
          )
        `);
  }

  if (excludeOwnTeams) {
    whereFragments.push(`
          AND NOT EXISTS (
            SELECT 1
            FROM team_members tm_excluded
            WHERE tm_excluded.team_id = t.id
              AND tm_excluded.user_id = $${nextParamIndex}
          )
        `);
    params.push(userId);
    nextParamIndex++;
  }

  if (hasValidMaxDistance && userLocation && direction !== "REMOTE") {
    const distFilter = buildDistanceFilterSQL(
      userLocation,
      "t",
      `$${nextParamIndex}`,
    );
    if (distFilter) {
      whereFragments.push(distFilter);
      params.push(maxDistance);
      nextParamIndex++;
    }
  }

  if (
    combineTagBadgeWithOr &&
    tagIds.length > 0 &&
    badgeIds.length > 0 &&
    matchRoleId
  ) {
    const tagParam = `$${nextParamIndex}`;
    const badgeParam = `$${nextParamIndex + 1}`;
    whereFragments.push(`
          AND (
            t.id IN (
              SELECT tt_filter.team_id FROM team_tags tt_filter
              WHERE tt_filter.tag_id = ANY(${tagParam}::int[])
            )
            OR t.id IN (
              SELECT DISTINCT tm_badge.team_id FROM team_members tm_badge
              JOIN badge_awards ba_badge ON tm_badge.user_id = ba_badge.awarded_to_user_id
              WHERE ba_badge.badge_id = ANY(${badgeParam}::int[])
            )
          )
        `);
    params.push(tagIds, badgeIds);
    nextParamIndex += 2;
  } else {
    if (tagIds.length > 0) {
      whereFragments.push(`
          AND t.id IN (
            SELECT tt_filter.team_id FROM team_tags tt_filter
            WHERE tt_filter.tag_id = ANY($${nextParamIndex}::int[])
          )
        `);
      params.push(tagIds);
      nextParamIndex++;
    }

    if (badgeIds.length > 0) {
      whereFragments.push(`
          AND t.id IN (
            SELECT DISTINCT tm_badge.team_id FROM team_members tm_badge
            JOIN badge_awards ba_badge ON tm_badge.user_id = ba_badge.awarded_to_user_id
            WHERE ba_badge.badge_id = ANY($${nextParamIndex}::int[])
          )
        `);
      params.push(badgeIds);
      nextParamIndex++;
    }
  }

  return { nextParamIndex, params, whereFragments };
}

function buildUserFilters(config, startParamIndex = 1) {
  const {
    badgeIds,
    combineTagBadgeWithOr = false,
    direction,
    excludeMatchingUser = false,
    excludeTeamId,
    hasValidExcludeTeamId,
    hasValidMaxDistance,
    includeDemoData,
    matchRoleId,
    maxDistance,
    tagIds,
    userId,
    userLocation,
  } = config;
  const whereFragments = [];
  const params = [];
  let nextParamIndex = startParamIndex;

  if (userId) {
    whereFragments.push(`
          AND (
            u.is_public = TRUE
            OR u.id = $${nextParamIndex}
          )
        `);
    params.push(userId);
    nextParamIndex++;
  } else {
    whereFragments.push(` AND u.is_public = TRUE`);
  }

  if (!includeDemoData) {
    whereFragments.push(` AND u.is_synthetic IS NOT TRUE`);
  }

  if (hasValidMaxDistance && userLocation && direction !== "REMOTE") {
    const distFilter = buildDistanceFilterSQL(
      userLocation,
      "u",
      `$${nextParamIndex}`,
    );
    if (distFilter) {
      whereFragments.push(distFilter);
      params.push(maxDistance);
      nextParamIndex++;
    }
  }

  if (excludeMatchingUser && matchRoleId && userId) {
    whereFragments.push(` AND u.id != $${nextParamIndex}`);
    params.push(userId);
    nextParamIndex++;
  }

  if (
    combineTagBadgeWithOr &&
    tagIds.length > 0 &&
    badgeIds.length > 0 &&
    matchRoleId
  ) {
    const tagParam = `$${nextParamIndex}`;
    const badgeParam = `$${nextParamIndex + 1}`;
    whereFragments.push(`
          AND (
            u.id IN (
              SELECT ut_filter.user_id FROM user_tags ut_filter
              WHERE ut_filter.tag_id = ANY(${tagParam}::int[])
            )
            OR u.id IN (
              SELECT DISTINCT ba_filter.awarded_to_user_id
              FROM badge_awards ba_filter
              WHERE ba_filter.badge_id = ANY(${badgeParam}::int[])
            )
          )
        `);
    params.push(tagIds, badgeIds);
    nextParamIndex += 2;
  } else {
    if (tagIds.length > 0) {
      whereFragments.push(`
          AND u.id IN (
            SELECT ut_filter.user_id FROM user_tags ut_filter
            WHERE ut_filter.tag_id = ANY($${nextParamIndex}::int[])
          )
        `);
      params.push(tagIds);
      nextParamIndex++;
    }

    if (badgeIds.length > 0) {
      whereFragments.push(`
          AND u.id IN (
            SELECT DISTINCT ba_filter.awarded_to_user_id
            FROM badge_awards ba_filter
            WHERE ba_filter.badge_id = ANY($${nextParamIndex}::int[])
          )
        `);
      params.push(badgeIds);
      nextParamIndex++;
    }
  }

  if (hasValidExcludeTeamId) {
    whereFragments.push(`
          AND NOT EXISTS (
            SELECT 1 FROM team_members tm_excl
            WHERE tm_excl.team_id = $${nextParamIndex}
              AND tm_excl.user_id = u.id
          )
        `);
    params.push(excludeTeamId);
    nextParamIndex++;
  }

  return { nextParamIndex, params, whereFragments };
}

function buildTeamOrderBy(sort, direction, capacityMode, userLocation) {
  switch (sort) {
    case "recent":
      return direction === "DESC"
        ? "t.updated_at DESC NULLS LAST"
        : "t.updated_at ASC NULLS LAST";
    case "newest":
      return direction === "DESC" ? "t.created_at DESC" : "t.created_at ASC";
    case "capacity":
      if (capacityMode === "roles") {
        return direction === "ASC"
          ? "open_role_count ASC, t.name ASC"
          : "open_role_count DESC, t.name ASC";
      }

      return direction === "ASC"
        ? "(CASE WHEN t.max_members IS NULL THEN 999999 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) ASC"
        : "(CASE WHEN t.max_members IS NULL THEN -1 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) DESC";
    case "match":
      return "t.name ASC";
    case "proximity":
      if (direction === "REMOTE" && userLocation) {
        return "(CASE WHEN t.is_remote IS TRUE THEN 0 ELSE 1 END) ASC, distance_km DESC, t.name ASC";
      }

      if (direction === "REMOTE") {
        return "(CASE WHEN t.is_remote IS TRUE THEN 0 ELSE 1 END) ASC, t.name ASC";
      }

      if (userLocation) {
        return direction === "DESC"
          ? "(CASE WHEN t.is_remote IS TRUE THEN 0 ELSE 1 END) ASC, distance_km DESC, t.name ASC"
          : `${buildTeamNearestPrioritySQL(userLocation)} ASC, distance_km ASC, t.name ASC`;
      }

      return "(CASE WHEN t.is_remote IS TRUE THEN 1 ELSE 0 END) ASC, t.name ASC";
    case "name":
    default:
      return direction === "DESC" ? "t.name DESC" : "t.name ASC";
  }
}

function buildUserOrderBy(sort, direction, userLocation) {
  switch (sort) {
    case "recent":
      return direction === "DESC"
        ? "u.updated_at DESC NULLS LAST"
        : "u.updated_at ASC NULLS LAST";
    case "newest":
      return direction === "DESC" ? "u.created_at DESC" : "u.created_at ASC";
    case "capacity":
      return "u.username ASC";
    case "match":
      return "u.username ASC";
    case "proximity":
      if (direction === "REMOTE") {
        return "u.username ASC";
      }

      if (userLocation) {
        return direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
      }

      return "u.username ASC";
    case "name":
    default:
      return direction === "DESC" ? "u.username DESC" : "u.username ASC";
  }
}

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

async function fetchOpenRoleSearchResults({
  query = null,
  sort = "newest",
  direction = "ASC",
  page = 1,
  limit = 20,
  userId = null,
  includeDemoData = true,
  userLocation = null,
  maxDistance = null,
}) {
  const searchValue = typeof query === "string" ? query.trim() : query;
  const offset = (page - 1) * limit;
  const isMatchSort = sort === "match" && !!userId;
  const hasValidMaxDistance =
    maxDistance !== null && Number.isFinite(maxDistance) && maxDistance > 0;

  const roleCountParams = [searchValue];
  let roleCountQuery = `
    SELECT COUNT(DISTINCT vr.id) AS total
    FROM team_vacant_roles vr
    JOIN teams t ON vr.team_id = t.id
    LEFT JOIN team_vacant_role_tags vrt ON vrt.role_id = vr.id
    LEFT JOIN tags tg ON vrt.tag_id = tg.id
    WHERE vr.status = 'open'
      AND t.archived_at IS NULL
      AND (
        $1 = '' OR $1 IS NULL
        OR vr.role_name ILIKE '%' || $1 || '%'
        OR vr.bio ILIKE '%' || $1 || '%'
        OR t.name ILIKE '%' || $1 || '%'
        OR tg.name ILIKE '%' || $1 || '%'
      )
  `;

  if (!includeDemoData) {
    roleCountQuery += `
      AND vr.is_synthetic IS NOT TRUE
    `;
  }

  if (hasValidMaxDistance && userLocation && direction !== "REMOTE") {
    const distFilter = searchController.buildDistanceFilterSQL(
      userLocation,
      "vr",
      `$${roleCountParams.length + 1}`,
    );
    if (distFilter) {
      roleCountQuery += distFilter;
      roleCountParams.push(maxDistance);
    }
  }

  let roleDistanceSelect = "";
  if (userLocation && (sort === "proximity" || hasValidMaxDistance)) {
    roleDistanceSelect = buildDistanceSelectSQL("vr", userLocation);
  }

  const roleDataParams = [searchValue];
  let roleDataQuery = `
    SELECT
      vr.id,
      vr.role_name,
      vr.bio,
      vr.city,
      vr.country,
      vr.state,
      vr.district,
      vr.postal_code,
      vr.latitude,
      vr.longitude,
      vr.max_distance_km,
      vr.is_remote,
      vr.is_synthetic,
      vr.status,
      vr.created_at,
      vr.team_id,
      t.name AS team_name,
      t.teamavatar_url AS team_avatar_url,
      t.city AS team_city,
      t.country AS team_country,
      t.is_synthetic AS team_is_synthetic,
      t.is_remote AS team_is_remote
      ${roleDistanceSelect}
    FROM team_vacant_roles vr
    JOIN teams t ON vr.team_id = t.id
    WHERE vr.status = 'open'
      AND t.archived_at IS NULL
      AND (
        $1 = '' OR $1 IS NULL
        OR vr.role_name ILIKE '%' || $1 || '%'
        OR vr.bio ILIKE '%' || $1 || '%'
        OR t.name ILIKE '%' || $1 || '%'
        OR EXISTS (
          SELECT 1 FROM team_vacant_role_tags vrt2
          JOIN tags tg2 ON vrt2.tag_id = tg2.id
          WHERE vrt2.role_id = vr.id AND tg2.name ILIKE '%' || $1 || '%'
        )
      )
  `;

  if (!includeDemoData) {
    roleDataQuery += `
      AND vr.is_synthetic IS NOT TRUE
    `;
  }

  if (hasValidMaxDistance && userLocation && direction !== "REMOTE") {
    const distFilter = searchController.buildDistanceFilterSQL(
      userLocation,
      "vr",
      `$${roleDataParams.length + 1}`,
    );
    if (distFilter) {
      roleDataQuery += distFilter;
      roleDataParams.push(maxDistance);
    }
  }

  roleDataQuery += `
    ORDER BY ${buildRoleOrderBy(sort, direction, userLocation)}
  `;

  if (!isMatchSort) {
    roleDataQuery += `
      LIMIT $${roleDataParams.length + 1} OFFSET $${roleDataParams.length + 2}
    `;
    roleDataParams.push(limit, offset);
  }

  const [roleCountResult, roleDataResult] = await Promise.all([
    db.pool.query(roleCountQuery, roleCountParams),
    db.pool.query(roleDataQuery, roleDataParams),
  ]);

  const totalRoles = parseInt(roleCountResult.rows[0]?.total, 10) || 0;

  let roles = await enrichRolesWithTagsAndBadges(roleDataResult.rows);

  if (isMatchSort) {
    roles = await applyViewerRoleMatchScores(roles, userId);
    roles.sort((a, b) => {
      const scoreDiff = b.best_match_score - a.best_match_score;
      if (scoreDiff !== 0) return scoreDiff;

      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    roles = roles.slice(offset, offset + limit);
  }

  return {
    roles,
    totalRoles,
  };
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

async function executeSearchQueries({
  params,
  query = null,
  useBoolean = false,
  userLocation = null,
}) {
  const {
    badgeIds,
    capacityMode,
    direction,
    excludeOwnTeams,
    excludeTeamId,
    hasValidExcludeTeamId,
    hasValidMaxDistance,
    includeDemoData,
    includeTeams,
    includeUsers,
    isMatchSort,
    limit,
    matchRoleId,
    maxDistance,
    offset,
    openRolesOnly,
    sort,
    tagIds,
    userId,
  } = params;
  const hasSearchTerm = typeof query === "string";
  const searchTerm = hasSearchTerm ? `%${query.trim()}%` : null;
  const filterConfig = {
    badgeIds,
    combineTagBadgeWithOr: !hasSearchTerm,
    direction,
    excludeMatchingUser: !hasSearchTerm,
    excludeOwnTeams,
    excludeTeamId,
    hasValidExcludeTeamId,
    hasValidMaxDistance,
    includeDemoData,
    matchRoleId,
    maxDistance,
    openRolesOnly,
    tagIds,
    userId,
    userLocation,
  };

  let teamCountQuery = hasSearchTerm
    ? `
        SELECT COUNT(DISTINCT t.id) as total
        FROM teams t
        LEFT JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE t.archived_at IS NULL
      `
    : `
        SELECT COUNT(*) as total
        FROM teams t
        WHERE t.archived_at IS NULL
      `;
  let teamCountParams = [];

  if (hasSearchTerm) {
    const teamSearch = appendTeamSearchClause({
      teamQuery: teamCountQuery,
      teamParams: teamCountParams,
      query,
      searchTerm,
      useBoolean,
      startParamIndex: 1,
    });
    teamCountQuery = teamSearch.query;
  }

  const teamCountFilters = buildTeamFilters(
    filterConfig,
    teamCountParams.length + 1,
  );
  teamCountQuery += teamCountFilters.whereFragments.join("");
  teamCountParams.push(...teamCountFilters.params);

  let teamDistanceSelect = "";
  if (userLocation && (sort === "proximity" || hasValidMaxDistance)) {
    teamDistanceSelect = buildDistanceSelectSQL(
      "t",
      userLocation,
      hasSearchTerm ? {} : { cityFallback: "constant" },
    );
  }

  let teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.is_synthetic,
          t.max_members,
          t.owner_id,
          t.teamavatar_url as "teamavatarUrl",
          t.created_at,
          t.updated_at,
          t.is_remote,
          t.postal_code,
          t.city,
          t.state,
          t.district,
          t.country,
          t.latitude,
          t.longitude,
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          CASE
            WHEN t.max_members IS NULL THEN NULL
            ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0)
          END as available_capacity,
          (SELECT COUNT(*) FROM team_vacant_roles vr WHERE vr.team_id = t.id AND vr.status = 'open') AS open_role_count,
          COALESCE(
  json_agg(
    DISTINCT jsonb_build_object(
      'id', tag.id,
      'name', tag.name,
      'category', tag.category
    )
  ) FILTER (WHERE tag.id IS NOT NULL),
  '[]'::json
) as tags
${teamDistanceSelect}
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        LEFT JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE t.archived_at IS NULL
      `;
  let teamParams = [];
  let teamParamIndex = 1;

  if (hasSearchTerm) {
    const teamSearch = appendTeamSearchClause({
      teamQuery,
      teamParams,
      query,
      searchTerm,
      useBoolean,
      startParamIndex: teamParamIndex,
    });
    teamQuery = teamSearch.query;
    teamParamIndex = teamSearch.nextParamIndex;
  }

  const teamFilters = buildTeamFilters(filterConfig, teamParamIndex);
  teamQuery += teamFilters.whereFragments.join("");
  teamParams.push(...teamFilters.params);
  teamParamIndex = teamFilters.nextParamIndex;

  const teamOrderBy = buildTeamOrderBy(
    sort,
    direction,
    capacityMode,
    userLocation,
  );
  const teamGroupByClause = `
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.is_synthetic, t.max_members, t.owner_id, t.teamavatar_url, t.created_at, t.updated_at, t.is_remote, t.postal_code, t.city, t.state, t.district, t.country, t.latitude, t.longitude
      `;

  teamQuery += `
        ${teamGroupByClause}
        ORDER BY ${teamOrderBy}
      `;

  if (!isMatchSort) {
    teamQuery += `
          LIMIT $${teamParamIndex} OFFSET $${teamParamIndex + 1}
        `;
    teamParams.push(limit, offset);
  }

  let userCountQuery = hasSearchTerm
    ? `
        SELECT COUNT(DISTINCT u.id) as total
        FROM users u
        LEFT JOIN user_tags ut ON u.id = ut.user_id
        LEFT JOIN tags t ON ut.tag_id = t.id
        WHERE 1=1
      `
    : `
        SELECT COUNT(*) as total
        FROM users u
        WHERE 1=1
      `;
  let userCountParams = [];

  if (hasSearchTerm) {
    const userSearch = appendUserSearchClause({
      userQuery: userCountQuery,
      userParams: userCountParams,
      query,
      searchTerm,
      useBoolean,
      startParamIndex: 1,
    });
    userCountQuery = userSearch.query;
  }

  const userCountFilters = buildUserFilters(
    filterConfig,
    userCountParams.length + 1,
  );
  userCountQuery += userCountFilters.whereFragments.join("");
  userCountParams.push(...userCountFilters.params);

  let userDistanceSelect = "";
  const userDistanceGroupBy = "";
  if (
    userLocation &&
    ((sort === "proximity" && direction !== "REMOTE") || hasValidMaxDistance)
  ) {
    userDistanceSelect = buildDistanceSelectSQL("u", userLocation);
  }

  let userQuery = `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.bio,
          u.postal_code,
          u.city,
          u.country,
          u.state,
          u.district,
          u.avatar_url,
          u.is_public,
          u.is_synthetic,
          u.created_at,
          u.updated_at,
          u.latitude,
          u.longitude,
          (SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', t.id,
                'name', t.name,
                'supercategory', t.supercategory,
                'badge_credits', COALESCE(ut.badge_credits, 0),
                'dominant_badge_category', ut.dominant_badge_category
              )
              ORDER BY COALESCE(ut.badge_credits, 0) DESC, t.name ASC
            ),
            '[]'::json
          )
          FROM user_tags ut
          JOIN tags t ON ut.tag_id = t.id
          WHERE ut.user_id = u.id) as tags,
          (SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', v.badge_id,
                'name', v.badge_name,
                'category', v.category,
                'color', v.badge_color,
                'cat_image_url', v.cat_image_url,
                'total_credits', v.total_credits,
                'award_count', v.award_count,
                'awarder_count', v.awarder_count,
                'category_total_credits', v.category_total_credits,
                'category_award_count', v.category_award_count,
                'category_awarder_count', v.category_awarder_count,
                'last_awarded_at', v.last_awarded_at
              )
              ORDER BY
                v.category_total_credits DESC,
                v.category ASC,
                v.total_credits DESC,
                v.badge_name ASC
            ),
            '[]'::json
          )
          FROM v_user_badges_with_category_totals v
          WHERE v.user_id = u.id) as badges
          ${userDistanceSelect}
        FROM users u
        ${hasSearchTerm ? "LEFT JOIN user_tags ut ON u.id = ut.user_id\n        LEFT JOIN tags t ON ut.tag_id = t.id" : ""}
        WHERE 1=1
      `;
  let userParams = [];
  let userParamIndex = 1;

  if (hasSearchTerm) {
    const userSearch = appendUserSearchClause({
      userQuery,
      userParams,
      query,
      searchTerm,
      useBoolean,
      startParamIndex: userParamIndex,
    });
    userQuery = userSearch.query;
    userParamIndex = userSearch.nextParamIndex;
  }

  const userFilters = buildUserFilters(filterConfig, userParamIndex);
  userQuery += userFilters.whereFragments.join("");
  userParams.push(...userFilters.params);
  userParamIndex = userFilters.nextParamIndex;

  const userOrderBy = buildUserOrderBy(sort, direction, userLocation);

  if (hasSearchTerm) {
    userQuery += `
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.country, u.state, u.district, u.avatar_url, u.is_public, u.is_synthetic, u.created_at, u.updated_at, u.latitude, u.longitude${userDistanceGroupBy}
        ORDER BY ${userOrderBy}
      `;
  } else {
    userQuery += `
        ORDER BY ${userOrderBy}
      `;
  }

  if (!isMatchSort) {
    userQuery += `
          LIMIT $${userParamIndex} OFFSET $${userParamIndex + 1}
        `;
    userParams.push(limit, offset);
  }

  const [teamCountResult, teamResults, userCountResult, userResults] =
    await Promise.all([
      includeTeams
        ? db.pool.query(teamCountQuery, teamCountParams)
        : Promise.resolve({ rows: [{ total: "0" }] }),
      includeTeams
        ? db.pool.query(teamQuery, teamParams)
        : Promise.resolve({ rows: [] }),
      includeUsers
        ? db.pool.query(userCountQuery, userCountParams)
        : Promise.resolve({ rows: [{ total: "0" }] }),
      includeUsers
        ? db.pool.query(userQuery, userParams)
        : Promise.resolve({ rows: [] }),
    ]);

  return {
    teamCountResult,
    teamResults,
    userCountResult,
    userResults,
  };
}

const searchController = {
  /**
   * Helper function to get user's location data (coordinates, postal_code, city)
   */
  async getUserLocation(userId) {
    if (!userId) return null;

    const result = await db.pool.query(
      "SELECT latitude, longitude, postal_code, city FROM users WHERE id = $1",
      [userId],
    );

    if (result.rows.length === 0) return null;

    const user = result.rows[0];

    const lat =
      user.latitude !== null && user.latitude !== undefined
        ? parseFloat(user.latitude)
        : null;

    const lng =
      user.longitude !== null && user.longitude !== undefined
        ? parseFloat(user.longitude)
        : null;

    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);

    const hasPostalCode =
      typeof user.postal_code === "string" && user.postal_code.trim() !== "";

    const hasCity = typeof user.city === "string" && user.city.trim() !== "";

    if (!hasCoordinates && !hasPostalCode && !hasCity) return null;

    return {
      latitude: hasCoordinates ? lat : null,
      longitude: hasCoordinates ? lng : null,
      postal_code: hasPostalCode ? user.postal_code.trim() : null,
      city: hasCity ? user.city.trim().toLowerCase() : null,
      hasCoordinates,
      hasPostalCode,
      hasCity,
    };
  },

  /**
   * Build SQL for postal code based distance calculation
   * German postal codes: same prefix = closer proximity
   * Returns a score from 0 (same) to 5 (completely different)
   */
  buildPostalCodeDistanceSQL(
    userPostalCode,
    tableAlias,
    postalCodeColumn = "postal_code",
  ) {
    return buildPostalCodeDistanceSQL(
      userPostalCode,
      tableAlias,
      postalCodeColumn,
    );
  },

  /**
   * Build SQL for city based distance calculation
   * Returns 0 for same city, 999999 for different/no city
   */
  buildCityDistanceSQL(userCity, tableAlias) {
    return buildCityDistanceSQL(userCity, tableAlias);
  },

  /**
   * Build SQL WHERE clause for filtering by maximum distance in km
   * Only works with coordinate-based (Haversine) distance
   */
  buildDistanceFilterSQL(userLocation, tableAlias, paramPlaceholder) {
    return buildDistanceFilterSQL(userLocation, tableAlias, paramPlaceholder);
  },

  /**
   * Global search with pagination and sorting
   * Searches teams and users based on query string
   */
  async globalSearch(req, res) {
    try {
      const { query } = req.query;
      const searchParams = parseSearchParams(req);
      const {
        badgeIds,
        capacityMode,
        direction,
        excludeOwnTeams,
        excludeTeamId,
        hasValidExcludeTeamId,
        hasValidMaxDistance,
        includeDemoData,
        includeRoles,
        includeTeams,
        includeUsers,
        isMatchSort,
        limit,
        matchRoleId,
        maxDistance,
        offset,
        openRolesOnly,
        page,
        roleSort,
        searchType,
        sort,
        tagIds,
        userId,
      } = searchParams;

      if (process.env.NODE_ENV !== "production") {
        console.log(`Search query: "${query}"`);
        console.log(`User ID from JWT: ${userId}`);
        console.log(
          `Pagination: page=${page}, limit=${limit}, offset=${offset}`,
        );
        console.log(
          `Sort by: ${sort}, direction: ${direction}, capacityMode: ${capacityMode}, searchType: ${searchType}, openRolesOnly: ${openRolesOnly}`,
        );
        console.log(
          `Tag filter IDs: ${JSON.stringify(tagIds)}, Badge filter IDs: ${JSON.stringify(badgeIds)}`,
        );
        console.log(
          `Match sort: roleId=${matchRoleId || "none (profile-based)"}`,
        );
        console.log(`Exclude team members: teamId=${excludeTeamId || "none"}`);
      }

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
        });
      }

      let userLocation = null;
      if (userId) {
        userLocation = await searchController.getUserLocation(userId);
      }

      if (includeRoles) {
        const { roles, totalRoles } = await fetchOpenRoleSearchResults({
          query,
          sort: roleSort,
          direction,
          page,
          limit,
          userId,
          includeDemoData,
          userLocation,
          maxDistance,
        });

        return res.status(200).json({
          success: true,
          data: {
            teams: [],
            users: [],
            roles,
          },
          pagination: {
            page,
            limit,
            totalTeams: 0,
            totalUsers: 0,
            totalRoles,
            totalItems: totalRoles,
            totalPages: Math.ceil(totalRoles / limit),
            hasNextPage: offset + limit < totalRoles,
            hasPrevPage: page > 1,
          },
          sorting: {
            sortBy: roleSort,
            sortDir: getRolesSortDir(roleSort, direction),
          },
        });
      }

      const useBoolean = hasBooleanOperators(query);

      if (useBoolean) {
        const validation = validateBooleanQuery(query);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            message: "Invalid boolean search query",
            error: validation.message,
          });
        }
      }

      const {
        teamCountResult,
        teamResults,
        userCountResult,
        userResults,
      } = await executeSearchQueries({
        params: searchParams,
        query,
        useBoolean,
        userLocation,
      });

      const totalTeams = parseInt(teamCountResult.rows[0].total, 10);
      const totalUsers = parseInt(userCountResult.rows[0].total, 10);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true || team.is_public === "true",
        is_remote: team.is_remote === true || team.is_remote === "true",
        tags: normalizeJsonArray(team.tags),
        available_capacity:
          team.available_capacity !== null
            ? parseInt(team.available_capacity, 10)
            : null,
        latitude: normalizeNullableNumber(team.latitude),
        longitude: normalizeNullableNumber(team.longitude),
        distance_km:
          team.distance_km !== undefined && team.distance_km !== null
            ? parseFloat(Number(team.distance_km).toFixed(1))
            : null,
        open_role_count:
          team.open_role_count !== null && team.open_role_count !== undefined
            ? parseInt(team.open_role_count, 10)
            : 0,
      }));

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true || user.is_public === "true",
        distance_km:
          user.distance_km !== undefined && user.distance_km !== null
            ? parseFloat(Number(user.distance_km).toFixed(1))
            : null,
      }));

      // ========== MATCH SORT POST-PROCESSING ==========
      let finalTeams = teamsWithFixedVisibility;
      let finalUsers = usersWithFixedVisibility;
      let roleData = null;

      // Best Match only re-ranks the SQL result set; maxDistance stays active as an independent filter.
      if (isMatchSort) {
        try {
          // --- Team scoring: always profile-based ---
          const teamIds = teamsWithFixedVisibility.map((t) => t.id);

          const teamMatches = await computeTeamProfileMatchScores(
            db,
            userId,
            teamIds,
          );
          finalTeams = teamsWithFixedVisibility.map((team) => {
            const match = teamMatches.get(team.id);
            return {
              ...team,
              match_score: match ? match.matchScore : 0,
              best_match_score: match ? match.matchScore : 0,
              match_details: {
                tag_score: match ? match.tagScore : 0,
                badge_score: match ? match.badgeScore : 0,
                distance_score: match ? match.distanceScore : 0,
                shared_tag_count: match ? match.sharedTagCount : 0,
                total_team_tags: match ? match.totalUniqueTeamTags : 0,
                shared_badge_count: match ? match.sharedBadgeCount : 0,
                total_team_badges: match ? match.totalUniqueTeamBadges : 0,
                distance_km: match ? match.distanceKm : null,
              },
              shared_tag_count: match ? match.sharedTagCount : 0,
              shared_badge_count: match ? match.sharedBadgeCount : 0,
              match_type: "team_profile_match",
            };
          });

          finalTeams.sort((a, b) => b.best_match_score - a.best_match_score);

          // --- User scoring: role-based OR profile-based ---
          if (matchRoleId) {
            const roleResult = await db.pool.query(
              `SELECT id, role_name, is_remote, latitude, longitude, max_distance_km,
                      city, country, state, district
               FROM team_vacant_roles WHERE id = $1 AND status = 'open'`,
              [matchRoleId],
            );

            if (roleResult.rows.length > 0) {
              roleData = roleResult.rows[0];

              const [roleTagsRes, roleBadgesRes] = await Promise.all([
                db.pool.query(
                  `SELECT tag_id FROM team_vacant_role_tags WHERE role_id = $1`,
                  [matchRoleId],
                ),
                db.pool.query(
                  `SELECT badge_id FROM team_vacant_role_badges WHERE role_id = $1`,
                  [matchRoleId],
                ),
              ]);

              const roleTagIds = roleTagsRes.rows.map((r) => Number(r.tag_id));
              const roleBadgeIds = roleBadgesRes.rows.map((r) =>
                Number(r.badge_id),
              );

              const userIds = usersWithFixedVisibility.map((u) => u.id);

              const [allUserTags, allUserBadges] = await Promise.all([
                db.pool.query(
                  `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
                  [userIds],
                ),
                db.pool.query(
                  `SELECT DISTINCT awarded_to_user_id AS user_id, badge_id
                   FROM badge_awards
                   WHERE awarded_to_user_id = ANY($1)`,
                  [userIds],
                ),
              ]);

              const userTagMap = {};
              const userBadgeMap = {};
              for (const r of allUserTags.rows) {
                if (!userTagMap[r.user_id]) userTagMap[r.user_id] = new Set();
                userTagMap[r.user_id].add(Number(r.tag_id));
              }
              for (const r of allUserBadges.rows) {
                if (!userBadgeMap[r.user_id])
                  userBadgeMap[r.user_id] = new Set();
                userBadgeMap[r.user_id].add(Number(r.badge_id));
              }

              finalUsers = usersWithFixedVisibility.map((user) => {
                const scores = scoreUserAgainstRole({
                  userTagIds: userTagMap[user.id] || new Set(),
                  userBadgeIds: userBadgeMap[user.id] || new Set(),
                  userLat: user.latitude,
                  userLng: user.longitude,
                  roleTagIds,
                  roleBadgeIds,
                  role: roleData,
                });

                return {
                  ...user,
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

              finalUsers.sort(
                (a, b) => b.best_match_score - a.best_match_score,
              );
            }
          }

          // Profile-based user scoring (default when no roleId, or role not found)
          if (!matchRoleId || finalUsers === usersWithFixedVisibility) {
            const userIds = usersWithFixedVisibility.map((u) => u.id);
            const userOverlap = await computeUserProfileOverlap(
              db,
              userId,
              userIds,
            );
            finalUsers = usersWithFixedVisibility.map((user) => {
              const overlap = userOverlap.get(user.id);
              return {
                ...user,
                best_match_score: overlap ? overlap.overlapScore : 0,
                shared_tag_count: overlap ? overlap.sharedTagCount : 0,
                shared_badge_count: overlap ? overlap.sharedBadgeCount : 0,
                match_type: "profile_overlap",
              };
            });

            finalUsers.sort((a, b) => b.best_match_score - a.best_match_score);
          }
        } catch (matchErr) {
          console.error("Error computing match scores for search:", matchErr);
        }
      }

      const paginatedTeams = isMatchSort
        ? finalTeams.slice(offset, offset + limit)
        : finalTeams;

      const paginatedUsers = isMatchSort
        ? finalUsers.slice(offset, offset + limit)
        : finalUsers;

      let rolesForAll = [];
      let totalRolesForAll = 0;

      if (searchType === "all") {
        ({ roles: rolesForAll, totalRoles: totalRolesForAll } =
          await fetchOpenRoleSearchResults({
            query,
            sort: roleSort,
            direction,
            page,
            limit,
            userId,
            includeDemoData,
            userLocation,
            maxDistance,
          }));
      }

      const paginationBaseItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : Math.max(totalTeams, totalUsers, totalRolesForAll);
      const totalItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : totalTeams + totalUsers + totalRolesForAll;

      res.status(200).json({
        success: true,
        data: {
          teams: paginatedTeams.map(sanitizeSearchTeam),
          users: paginatedUsers.map(sanitizeSearchUser),
          roles: rolesForAll,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
          totalRoles: totalRolesForAll,
          totalItems,
          totalPages: Math.ceil(paginationBaseItems / limit),
          hasNextPage: offset + limit < paginationBaseItems,
          hasPrevPage: page > 1,
        },
        sorting: {
          sortBy: sort,
          sortDir: direction.toLowerCase(),
        },
        matchRole: roleData
          ? {
              id: roleData.id,
              roleName: roleData.role_name,
              isRemote: roleData.is_remote,
              city: roleData.city,
              country: roleData.country,
            }
          : null,
        userLocation: userLocation
          ? { hasLocation: true, hasCoordinates: !!userLocation.hasCoordinates }
          : { hasLocation: false, hasCoordinates: false },
      });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({
        success: false,
        message: "Error performing search",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

  /**
   * Get all users and teams with pagination and sorting
   * Used when page loads initially (no search query)
   */
  async getAllUsersAndTeams(req, res) {
    try {
      const searchParams = parseSearchParams(req);
      const {
        badgeIds,
        capacityMode,
        direction,
        excludeOwnTeams,
        excludeTeamId,
        hasValidExcludeTeamId,
        hasValidMaxDistance,
        includeDemoData,
        includeRoles,
        includeTeams,
        includeUsers,
        isMatchSort,
        limit,
        matchRoleId,
        maxDistance,
        offset,
        openRolesOnly,
        page,
        roleSort,
        searchType,
        sort,
        tagIds,
        userId,
      } = searchParams;

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `getAllUsersAndTeams: userId=${userId}, page=${page}, limit=${limit}, sortBy=${sort}, sortDir=${direction}, capacityMode=${capacityMode}, searchType=${searchType}, openRolesOnly=${openRolesOnly}`,
        );
        console.log(
          `Tag filter IDs: ${JSON.stringify(tagIds)}, Badge filter IDs: ${JSON.stringify(badgeIds)}`,
        );
        console.log(
          `Match sort: roleId=${matchRoleId || "none (profile-based)"}`,
        );
        console.log(`Exclude team members: teamId=${excludeTeamId || "none"}`);
      }

      let userLocation = null;
      if (userId) {
        userLocation = await searchController.getUserLocation(userId);
      }

      if (includeRoles) {
        const { roles, totalRoles } = await fetchOpenRoleSearchResults({
          sort: roleSort,
          direction,
          page,
          limit,
          userId,
          includeDemoData,
          userLocation,
          maxDistance,
        });

        return res.status(200).json({
          success: true,
          data: {
            teams: [],
            users: [],
            roles,
          },
          pagination: {
            page,
            limit,
            totalTeams: 0,
            totalUsers: 0,
            totalRoles,
            totalItems: totalRoles,
            totalPages: Math.ceil(totalRoles / limit),
            hasNextPage: offset + limit < totalRoles,
            hasPrevPage: page > 1,
          },
          sorting: {
            sortBy: roleSort,
            sortDir: getRolesSortDir(roleSort, direction),
          },
        });
      }

      const {
        teamCountResult,
        teamResults,
        userCountResult,
        userResults,
      } = await executeSearchQueries({
        params: searchParams,
        userLocation,
      });

      const totalTeams = parseInt(teamCountResult.rows[0].total, 10);
      const totalUsers = parseInt(userCountResult.rows[0].total, 10);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true || team.is_public === "true",
        is_remote: team.is_remote === true || team.is_remote === "true",
        tags: normalizeJsonArray(team.tags),
        available_capacity:
          team.available_capacity !== null
            ? parseInt(team.available_capacity, 10)
            : null,
        latitude: normalizeNullableNumber(team.latitude),
        longitude: normalizeNullableNumber(team.longitude),
        distance_km:
          team.distance_km !== undefined && team.distance_km !== null
            ? parseFloat(Number(team.distance_km).toFixed(1))
            : null,
        open_role_count:
          team.open_role_count !== null && team.open_role_count !== undefined
            ? parseInt(team.open_role_count, 10)
            : 0,
      }));

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true || user.is_public === "true",
        distance_km:
          user.distance_km !== undefined && user.distance_km !== null
            ? parseFloat(Number(user.distance_km).toFixed(1))
            : null,
      }));

      // ========== MATCH SORT POST-PROCESSING ==========
      let finalTeams = teamsWithFixedVisibility;
      let finalUsers = usersWithFixedVisibility;
      let roleData = null;

      // Best Match only re-ranks the SQL result set; maxDistance stays active as an independent filter.
      if (isMatchSort) {
        try {
          // --- Team scoring: always profile-based ---
          const teamIds = teamsWithFixedVisibility.map((t) => t.id);

          const teamMatches = await computeTeamProfileMatchScores(
            db,
            userId,
            teamIds,
          );
          finalTeams = teamsWithFixedVisibility.map((team) => {
            const match = teamMatches.get(team.id);
            return {
              ...team,
              match_score: match ? match.matchScore : 0,
              best_match_score: match ? match.matchScore : 0,
              match_details: {
                tag_score: match ? match.tagScore : 0,
                badge_score: match ? match.badgeScore : 0,
                distance_score: match ? match.distanceScore : 0,
                shared_tag_count: match ? match.sharedTagCount : 0,
                total_team_tags: match ? match.totalUniqueTeamTags : 0,
                shared_badge_count: match ? match.sharedBadgeCount : 0,
                total_team_badges: match ? match.totalUniqueTeamBadges : 0,
                distance_km: match ? match.distanceKm : null,
              },
              shared_tag_count: match ? match.sharedTagCount : 0,
              shared_badge_count: match ? match.sharedBadgeCount : 0,
              match_type: "team_profile_match",
            };
          });

          finalTeams.sort((a, b) => b.best_match_score - a.best_match_score);

          // --- User scoring: role-based OR profile-based ---
          if (matchRoleId) {
            const roleResult = await db.pool.query(
              `SELECT id, role_name, is_remote, latitude, longitude, max_distance_km,
                      city, country, state, district
               FROM team_vacant_roles WHERE id = $1 AND status = 'open'`,
              [matchRoleId],
            );

            if (roleResult.rows.length > 0) {
              roleData = roleResult.rows[0];

              const [roleTagsRes, roleBadgesRes] = await Promise.all([
                db.pool.query(
                  `SELECT tag_id FROM team_vacant_role_tags WHERE role_id = $1`,
                  [matchRoleId],
                ),
                db.pool.query(
                  `SELECT badge_id FROM team_vacant_role_badges WHERE role_id = $1`,
                  [matchRoleId],
                ),
              ]);

              const roleTagIds = roleTagsRes.rows.map((r) => Number(r.tag_id));
              const roleBadgeIds = roleBadgesRes.rows.map((r) =>
                Number(r.badge_id),
              );

              const userIds = usersWithFixedVisibility.map((u) => u.id);

              const [allUserTags, allUserBadges] = await Promise.all([
                db.pool.query(
                  `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
                  [userIds],
                ),
                db.pool.query(
                  `SELECT DISTINCT awarded_to_user_id AS user_id, badge_id
                   FROM badge_awards
                   WHERE awarded_to_user_id = ANY($1)`,
                  [userIds],
                ),
              ]);

              const userTagMap = {};
              const userBadgeMap = {};
              for (const r of allUserTags.rows) {
                if (!userTagMap[r.user_id]) userTagMap[r.user_id] = new Set();
                userTagMap[r.user_id].add(Number(r.tag_id));
              }
              for (const r of allUserBadges.rows) {
                if (!userBadgeMap[r.user_id])
                  userBadgeMap[r.user_id] = new Set();
                userBadgeMap[r.user_id].add(Number(r.badge_id));
              }

              finalUsers = usersWithFixedVisibility.map((user) => {
                const scores = scoreUserAgainstRole({
                  userTagIds: userTagMap[user.id] || new Set(),
                  userBadgeIds: userBadgeMap[user.id] || new Set(),
                  userLat: user.latitude,
                  userLng: user.longitude,
                  roleTagIds,
                  roleBadgeIds,
                  role: roleData,
                });

                return {
                  ...user,
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

              finalUsers.sort(
                (a, b) => b.best_match_score - a.best_match_score,
              );
            }
          }

          // Profile-based user scoring (default when no roleId, or role not found)
          if (!matchRoleId || finalUsers === usersWithFixedVisibility) {
            const userIds = usersWithFixedVisibility.map((u) => u.id);
            const userOverlap = await computeUserProfileOverlap(
              db,
              userId,
              userIds,
            );
            finalUsers = usersWithFixedVisibility.map((user) => {
              const overlap = userOverlap.get(user.id);
              return {
                ...user,
                best_match_score: overlap ? overlap.overlapScore : 0,
                shared_tag_count: overlap ? overlap.sharedTagCount : 0,
                shared_badge_count: overlap ? overlap.sharedBadgeCount : 0,
                match_type: "profile_overlap",
              };
            });

            finalUsers.sort((a, b) => b.best_match_score - a.best_match_score);
          }
        } catch (matchErr) {
          console.error("Error computing match scores for search:", matchErr);
        }
      }

      const paginatedTeams = isMatchSort
        ? finalTeams.slice(offset, offset + limit)
        : finalTeams;

      const paginatedUsers = isMatchSort
        ? finalUsers.slice(offset, offset + limit)
        : finalUsers;

      let rolesForAll = [];
      let totalRolesForAll = 0;

      if (searchType === "all") {
        ({ roles: rolesForAll, totalRoles: totalRolesForAll } =
          await fetchOpenRoleSearchResults({
            sort: roleSort,
            direction,
            page,
            limit,
            userId,
            includeDemoData,
            userLocation,
            maxDistance,
          }));
      }

      const paginationBaseItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : Math.max(totalTeams, totalUsers, totalRolesForAll);
      const totalItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : totalTeams + totalUsers + totalRolesForAll;

      res.status(200).json({
        success: true,
        data: {
          teams: paginatedTeams.map(sanitizeSearchTeam),
          users: paginatedUsers.map(sanitizeSearchUser),
          roles: rolesForAll,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
          totalRoles: totalRolesForAll,
          totalItems,
          totalPages: Math.ceil(paginationBaseItems / limit),
          hasNextPage: offset + limit < paginationBaseItems,
          hasPrevPage: page > 1,
        },
        sorting: {
          sortBy: sort,
          sortDir: direction.toLowerCase(),
        },
        matchRole: roleData
          ? {
              id: roleData.id,
              roleName: roleData.role_name,
              isRemote: roleData.is_remote,
              city: roleData.city,
              country: roleData.country,
            }
          : null,
        userLocation: userLocation
          ? { hasLocation: true, hasCoordinates: !!userLocation.hasCoordinates }
          : { hasLocation: false, hasCoordinates: false },
      });
    } catch (error) {
      console.error("Error fetching all users and teams:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching data",
        ...(process.env.NODE_ENV === "development" && { error: error.message }),
      });
    }
  },

};

module.exports = searchController;
