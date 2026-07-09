// Result-row normalizers and SQL fragment builders (WHERE filters, ORDER BY,
// nearest-priority) shared by the search query executor.

const {
  buildNearestPrioritySQL,
  buildDistanceFilterSQL,
} = require("../searchQueryBuilder");

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
      if (process.env.NODE_ENV !== "production") {
        console.warn("Error parsing JSON array:", value, error.message);
      }
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

  // Mutually hide blocked users: drop anyone the viewer has blocked or who has
  // blocked the viewer from search results.
  if (userId) {
    whereFragments.push(`
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = u.id AND ub.blocked_id = $${nextParamIndex})
               OR (ub.blocked_id = u.id AND ub.blocker_id = $${nextParamIndex})
          )
        `);
    params.push(userId);
    nextParamIndex++;
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

module.exports = {
  getRolesSortDir,
  roundOverlapScore,
  normalizeNullableNumber,
  normalizeJsonArray,
  normalizeRoleSearchRow,
  buildRoleNearestPrioritySQL,
  buildRoleOrderBy,
  buildTeamNearestPrioritySQL,
  buildTeamFilters,
  buildUserFilters,
  buildTeamOrderBy,
  buildUserOrderBy,
};
