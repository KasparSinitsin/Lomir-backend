// Core search query executors: builds and runs the paginated team/user and
// open-role SQL, delegating to the filter/order builders and result shapers.

const db = require("../../config/database");
const {
  buildDistanceSelectSQL,
  buildDistanceFilterSQL,
} = require("../searchQueryBuilder");
const {
  buildRoleOrderBy,
  buildTeamFilters,
  buildUserFilters,
  buildTeamOrderBy,
  buildUserOrderBy,
} = require("./searchSqlBuilders");
const {
  enrichRolesWithTagsAndBadges,
  applyViewerRoleMatchScores,
  appendTeamSearchClause,
  appendUserSearchClause,
} = require("./searchResultProcessing");

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
    const distFilter = buildDistanceFilterSQL(
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
  if (userLocation) {
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
    const distFilter = buildDistanceFilterSQL(
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
  if (userLocation) {
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
          (SELECT COALESCE(json_agg(vr.role_name ORDER BY vr.role_name ASC), '[]'::json) FROM team_vacant_roles vr WHERE vr.team_id = t.id AND vr.status = 'open') AS open_role_names,
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
  if (userLocation) {
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

module.exports = {
  fetchOpenRoleSearchResults,
  executeSearchQueries,
};
