const db = require("../config/database");
const {
  parseBooleanSearch,
  hasBooleanOperators,
  validateBooleanQuery,
} = require("../utils/booleanSearchParser");
const {
  computeTeamMatchScores,
  computeTeamTagOverlap,
  computeUserProfileOverlap,
  scoreUserAgainstRole,
} = require("../utils/matchingScorer");

const VALID_SEARCH_TYPES = ["all", "teams", "users"];

function parseSearchType(value) {
  if (typeof value !== "string") return "all";

  const normalized = value.toLowerCase();
  return VALID_SEARCH_TYPES.includes(normalized) ? normalized : "all";
}

function parseBooleanFlag(value) {
  return typeof value === "string" && value.toLowerCase() === "true";
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
    const sanitizedPostalCode = userPostalCode.replace(/'/g, "''");
    return `
      CASE
        WHEN ${tableAlias}.${postalCodeColumn} IS NULL OR ${tableAlias}.${postalCodeColumn} = '' THEN 999999
        WHEN ${tableAlias}.${postalCodeColumn} = '${sanitizedPostalCode}' THEN 0
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 4) = LEFT('${sanitizedPostalCode}', 4) THEN 1
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 3) = LEFT('${sanitizedPostalCode}', 3) THEN 2
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 2) = LEFT('${sanitizedPostalCode}', 2) THEN 3
        WHEN LEFT(${tableAlias}.${postalCodeColumn}::text, 1) = LEFT('${sanitizedPostalCode}', 1) THEN 4
        ELSE 5
      END
    `;
  },

  /**
   * Build SQL for city based distance calculation
   * Returns 0 for same city, 999999 for different/no city
   */
  buildCityDistanceSQL(userCity, tableAlias) {
    const sanitizedCity = userCity.replace(/'/g, "''");
    return `
      CASE
        WHEN ${tableAlias}.city IS NULL OR ${tableAlias}.city = '' THEN 999999
        WHEN LOWER(${tableAlias}.city) = '${sanitizedCity}' THEN 0
        ELSE 999998
      END
    `;
  },

  /**
   * Build SQL WHERE clause for filtering by maximum distance in km
   * Only works with coordinate-based (Haversine) distance
   */
  buildDistanceFilterSQL(userLocation, tableAlias, paramPlaceholder) {
    if (!userLocation || !userLocation.hasCoordinates) return null;

    return `
      AND ${tableAlias}.latitude IS NOT NULL
      AND ${tableAlias}.longitude IS NOT NULL
      AND (
        6371 * acos(
          LEAST(1.0, GREATEST(-1.0,
            cos(radians(${userLocation.latitude})) * cos(radians(${tableAlias}.latitude)) *
            cos(radians(${tableAlias}.longitude) - radians(${userLocation.longitude})) +
            sin(radians(${userLocation.latitude})) * sin(radians(${tableAlias}.latitude))
          ))
        )
      ) <= ${paramPlaceholder}
    `;
  },

  /**
   * Global search with pagination and sorting
   * Searches teams and users based on query string
   */
  async globalSearch(req, res) {
    try {
      const { query, sortBy, sortDir } = req.query;
      const userId = req.user?.id;
      const searchType = parseSearchType(req.query.searchType);
      const includeTeams = searchType !== "users";
      const includeUsers = searchType !== "teams";
      const openRolesOnly = parseBooleanFlag(req.query.openRolesOnly);
      const excludeOwnTeams = parseBooleanFlag(req.query.excludeOwnTeams) && !!userId;

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

      const validDirections = ["asc", "desc", "remote"];
      const direction = validDirections.includes(sortDir)
        ? sortDir.toUpperCase()
        : "ASC";

      const isMatchSort = sort === "match" && !!userId;
      const matchRoleId = req.query.roleId ? parseInt(req.query.roleId, 10) : null;

      const maxDistance = req.query.maxDistance
        ? parseFloat(req.query.maxDistance)
        : null;
      const hasValidMaxDistance =
        maxDistance !== null && Number.isFinite(maxDistance) && maxDistance > 0;

      const capacityMode = req.query.capacityMode === "roles" ? "roles" : "spots";

      console.log(`=== SEARCH DEBUG ===`);
      console.log(`Search query: "${query}"`);
      console.log(`User ID from JWT: ${userId}`);
      console.log(`Pagination: page=${page}, limit=${limit}, offset=${offset}`);
      console.log(
        `Sort by: ${sort}, direction: ${direction}, capacityMode: ${capacityMode}, searchType: ${searchType}, openRolesOnly: ${openRolesOnly}`,
      );
      console.log(`Tag filter IDs: ${JSON.stringify(tagIds)}, Badge filter IDs: ${JSON.stringify(badgeIds)}`);
      console.log(`Match sort: roleId=${matchRoleId || 'none (profile-based)'}`);

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
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

      const teamColumns = ["t.name", "t.description", "tag.name", "t.city"];

      const userColumns = [
        "u.username",
        "u.first_name",
        "u.last_name",
        "u.bio",
        "t.name",
        "u.city",
      ];

      const searchTerm = `%${query.trim()}%`;

      let userLocation = null;
      if (userId) {
        userLocation = await searchController.getUserLocation(userId);
        console.log("SEARCH DEBUG: userLocation =", userLocation);
      }

      // ========== TEAM COUNT QUERY ==========
      let teamCountQuery = `
        SELECT COUNT(DISTINCT t.id) as total
        FROM teams t
        LEFT JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE t.archived_at IS NULL
      `;

      let teamCountParams = [];

      if (useBoolean) {
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
          1,
          teamTagConfig,
        );
        teamCountQuery += ` AND ${teamSearch.whereClause}`;
        teamCountParams.push(...teamSearch.params);
      } else {
        teamCountQuery += `
          AND (
            t.name ILIKE $1 OR
            t.description ILIKE $1 OR
            t.city ILIKE $1 OR
            tag.name ILIKE $1
          )
        `;
        teamCountParams.push(searchTerm);
      }

      if (userId) {
        const userParamIdx = teamCountParams.length + 1;
        teamCountQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${userParamIdx}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${userParamIdx}
            )
          )
        `;
        teamCountParams.push(userId);
      } else {
        teamCountQuery += ` AND t.is_public = TRUE`;
      }

      if (openRolesOnly) {
        teamCountQuery += `
          AND EXISTS (
            SELECT 1
            FROM team_vacant_roles vr_filter
            WHERE vr_filter.team_id = t.id
              AND vr_filter.status = 'open'
          )
        `;
      }

      if (excludeOwnTeams) {
        const memberParamIdx = teamCountParams.length + 1;
        teamCountQuery += `
          AND NOT EXISTS (
            SELECT 1
            FROM team_members tm_excluded
            WHERE tm_excluded.team_id = t.id
              AND tm_excluded.user_id = $${memberParamIdx}
          )
        `;
        teamCountParams.push(userId);
      }

      if (sort === "proximity" && direction === "REMOTE") {
        teamCountQuery += ` AND t.is_remote = TRUE`;
      } else if (sort === "proximity") {
        teamCountQuery += ` AND t.is_remote IS NOT TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "t",
          `$${teamCountParams.length + 1}`,
        );
        if (distFilter) {
          teamCountQuery += distFilter;
          teamCountParams.push(maxDistance);
        }
      }

      if (tagIds.length > 0) {
        teamCountQuery += `
          AND t.id IN (
            SELECT tt_filter.team_id FROM team_tags tt_filter
            WHERE tt_filter.tag_id = ANY($${teamCountParams.length + 1}::int[])
          )
        `;
        teamCountParams.push(tagIds);
      }

      if (badgeIds.length > 0) {
        teamCountQuery += `
          AND t.id IN (
            SELECT tm_badge.team_id FROM team_members tm_badge
            JOIN user_badges ub_badge ON tm_badge.user_id = ub_badge.user_id
            WHERE ub_badge.badge_id = ANY($${teamCountParams.length + 1}::int[])
          )
        `;
        teamCountParams.push(badgeIds);
      }

      // ========== TEAM DATA QUERY ==========
      let teamDistanceSelect = "";
      let teamDistanceGroupBy = "";
      if (sort === "proximity" && userLocation && direction !== "REMOTE") {
        if (userLocation.hasCoordinates) {
          teamDistanceSelect = `,
            CASE
              WHEN t.latitude IS NULL OR t.longitude IS NULL THEN 999999
              ELSE (
                6371 * acos(
                  LEAST(1.0, GREATEST(-1.0,
                    cos(radians(${userLocation.latitude})) * cos(radians(t.latitude)) *
                    cos(radians(t.longitude) - radians(${userLocation.longitude})) +
                    sin(radians(${userLocation.latitude})) * sin(radians(t.latitude))
                  ))
                )
              )
            END as distance_km`;
          teamDistanceGroupBy = ", t.latitude, t.longitude";
        } else if (userLocation.hasPostalCode) {
          teamDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "t")} as distance_km`;
          teamDistanceGroupBy = ", t.postal_code";
        } else if (userLocation.hasCity) {
          teamDistanceSelect = `,
            ${searchController.buildCityDistanceSQL(userLocation.city, "t")} as distance_km`;
          teamDistanceGroupBy = ", t.city";
        }
      }

      let teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          t.teamavatar_url as "teamavatarUrl",
          t.created_at,
          t.updated_at,
          t.is_remote,
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          CASE
            WHEN t.max_members IS NULL THEN NULL
            ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0)
          END as available_capacity,
          (SELECT COUNT(*) FROM team_vacant_roles vr WHERE vr.team_id = t.id AND vr.status = 'open') AS open_role_count,
          STRING_AGG(
            DISTINCT CASE
              WHEN tag.id IS NOT NULL
              THEN json_build_object('id', tag.id, 'name', tag.name, 'category', tag.category)::text
              ELSE NULL
            END,
            ','
          ) as tags_json
          ${teamDistanceSelect}
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        LEFT JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE t.archived_at IS NULL
      `;

      let teamParams = [];
      let teamParamIndex = 1;

      if (useBoolean) {
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
          teamParamIndex,
          teamTagConfig,
        );
        teamQuery += ` AND ${teamSearch.whereClause}`;
        teamParams.push(...teamSearch.params);
        teamParamIndex = teamSearch.nextParamIndex;
      } else {
        teamQuery += `
          AND (
            t.name ILIKE $${teamParamIndex} OR
            t.description ILIKE $${teamParamIndex} OR
            t.city ILIKE $${teamParamIndex} OR
            tag.name ILIKE $${teamParamIndex}
          )
        `;
        teamParams.push(searchTerm);
        teamParamIndex++;
      }

      if (userId) {
        teamQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${teamParamIndex}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${teamParamIndex}
            )
          )
        `;
        teamParams.push(userId);
        teamParamIndex++;
      } else {
        teamQuery += ` AND t.is_public = TRUE`;
      }

      if (openRolesOnly) {
        teamQuery += `
          AND EXISTS (
            SELECT 1
            FROM team_vacant_roles vr_filter
            WHERE vr_filter.team_id = t.id
              AND vr_filter.status = 'open'
          )
        `;
      }

      if (excludeOwnTeams) {
        teamQuery += `
          AND NOT EXISTS (
            SELECT 1
            FROM team_members tm_excluded
            WHERE tm_excluded.team_id = t.id
              AND tm_excluded.user_id = $${teamParamIndex}
          )
        `;
        teamParams.push(userId);
        teamParamIndex++;
      }

      if (sort === "proximity" && direction === "REMOTE") {
        teamQuery += ` AND t.is_remote = TRUE`;
      } else if (sort === "proximity") {
        teamQuery += ` AND t.is_remote IS NOT TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "t",
          `$${teamParamIndex}`,
        );
        if (distFilter) {
          teamQuery += distFilter;
          teamParams.push(maxDistance);
          teamParamIndex++;
        }
      }

      if (tagIds.length > 0) {
        teamQuery += `
          AND t.id IN (
            SELECT tt_filter.team_id FROM team_tags tt_filter
            WHERE tt_filter.tag_id = ANY($${teamParamIndex}::int[])
          )
        `;
        teamParams.push(tagIds);
        teamParamIndex++;
      }

      if (badgeIds.length > 0) {
        teamQuery += `
          AND t.id IN (
            SELECT tm_badge.team_id FROM team_members tm_badge
            JOIN user_badges ub_badge ON tm_badge.user_id = ub_badge.user_id
            WHERE ub_badge.badge_id = ANY($${teamParamIndex}::int[])
          )
        `;
        teamParams.push(badgeIds);
        teamParamIndex++;
      }

      let teamOrderBy;
      switch (sort) {
        case "recent":
          teamOrderBy =
            direction === "DESC"
              ? "t.updated_at DESC NULLS LAST"
              : "t.updated_at ASC NULLS LAST";
          break;
        case "newest":
          teamOrderBy =
            direction === "DESC" ? "t.created_at DESC" : "t.created_at ASC";
          break;
        case "capacity":
          if (capacityMode === "roles") {
            teamOrderBy =
              direction === "ASC"
                ? "open_role_count ASC, t.name ASC"
                : "open_role_count DESC, t.name ASC";
          } else {
            teamOrderBy =
              direction === "ASC"
                ? "(CASE WHEN t.max_members IS NULL THEN 999999 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) ASC"
                : "(CASE WHEN t.max_members IS NULL THEN -1 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) DESC";
          }
          break;
        case "match":
          teamOrderBy = "t.name ASC";
          break;
        case "proximity":
          if (direction === "REMOTE") {
            teamOrderBy = "t.name ASC";
          } else if (userLocation) {
            teamOrderBy =
              direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
          } else {
            teamOrderBy = "t.name ASC";
          }
          break;
        case "name":
        default:
          teamOrderBy = direction === "DESC" ? "t.name DESC" : "t.name ASC";
          break;
      }

      teamQuery += `
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url, t.created_at, t.updated_at, t.is_remote${teamDistanceGroupBy}
        ORDER BY ${teamOrderBy}
      `;

      if (!isMatchSort) {
        teamQuery += `
          LIMIT $${teamParamIndex} OFFSET $${teamParamIndex + 1}
        `;
        teamParams.push(limit, offset);
      }

      // ========== USER COUNT QUERY ==========
      let userCountQuery = `
        SELECT COUNT(DISTINCT u.id) as total
        FROM users u
        LEFT JOIN user_tags ut ON u.id = ut.user_id
        LEFT JOIN tags t ON ut.tag_id = t.id
        WHERE 1=1
      `;

      let userCountParams = [];

      if (useBoolean) {
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
          1,
          userTagConfig,
        );
        userCountQuery += ` AND ${userSearch.whereClause}`;
        userCountParams.push(...userSearch.params);
      } else {
        userCountQuery += `
          AND (
            u.username ILIKE $1 OR
            u.first_name ILIKE $1 OR
            u.last_name ILIKE $1 OR
            u.bio ILIKE $1 OR
            u.city ILIKE $1 OR
            t.name ILIKE $1 OR
            EXISTS (
              SELECT 1
              FROM v_user_badges_with_totals ubt
              WHERE ubt.user_id = u.id
                AND ubt.badge_name ILIKE $1
            )
          )
        `;
        userCountParams.push(searchTerm);
      }

      if (userId) {
        const userParamIdx = userCountParams.length + 1;
        userCountQuery += `
          AND (
            u.is_public = TRUE
            OR u.id = $${userParamIdx}
          )
        `;
        userCountParams.push(userId);
      } else {
        userCountQuery += ` AND u.is_public = TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "u",
          `$${userCountParams.length + 1}`,
        );
        if (distFilter) {
          userCountQuery += distFilter;
          userCountParams.push(maxDistance);
        }
      }

      if (tagIds.length > 0) {
        userCountQuery += `
          AND u.id IN (
            SELECT ut_filter.user_id FROM user_tags ut_filter
            WHERE ut_filter.tag_id = ANY($${userCountParams.length + 1}::int[])
          )
        `;
        userCountParams.push(tagIds);
      }

      if (badgeIds.length > 0) {
        userCountQuery += `
          AND u.id IN (
            SELECT ub_filter.user_id FROM user_badges ub_filter
            WHERE ub_filter.badge_id = ANY($${userCountParams.length + 1}::int[])
          )
        `;
        userCountParams.push(badgeIds);
      }

      // ========== USER DATA QUERY ==========
      let userDistanceSelect = "";
      let userDistanceGroupBy = "";
      if (sort === "proximity" && userLocation && direction !== "REMOTE") {
        if (userLocation.hasCoordinates) {
          userDistanceSelect = `,
            CASE
              WHEN u.latitude IS NULL OR u.longitude IS NULL THEN 999999
              ELSE (
                6371 * acos(
                  LEAST(1.0, GREATEST(-1.0,
                    cos(radians(${userLocation.latitude})) * cos(radians(u.latitude)) *
                    cos(radians(u.longitude) - radians(${userLocation.longitude})) +
                    sin(radians(${userLocation.latitude})) * sin(radians(u.latitude))
                  ))
                )
              )
            END as distance_km`;
          userDistanceGroupBy = "";
        } else if (userLocation.hasPostalCode) {
          userDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "u")} as distance_km`;
        } else if (userLocation.hasCity) {
          userDistanceSelect = `,
            ${searchController.buildCityDistanceSQL(userLocation.city, "u")} as distance_km`;
        }
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
          u.avatar_url,
          u.is_public,
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
        LEFT JOIN user_tags ut ON u.id = ut.user_id
        LEFT JOIN tags t ON ut.tag_id = t.id
        WHERE 1=1
      `;

      let userParams = [];
      let userParamIndex = 1;

      if (useBoolean) {
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
          userParamIndex,
          userTagConfig,
        );
        userQuery += ` AND ${userSearch.whereClause}`;
        userParams.push(...userSearch.params);
        userParamIndex = userSearch.nextParamIndex;
      } else {
        userQuery += `
          AND (
            u.username ILIKE $${userParamIndex} OR
            u.first_name ILIKE $${userParamIndex} OR
            u.last_name ILIKE $${userParamIndex} OR
            u.bio ILIKE $${userParamIndex} OR
            u.city ILIKE $${userParamIndex} OR
            t.name ILIKE $${userParamIndex} OR
            EXISTS (
              SELECT 1
              FROM v_user_badges_with_totals ubt
              WHERE ubt.user_id = u.id
                AND ubt.badge_name ILIKE $${userParamIndex}
            )
          )
        `;
        userParams.push(searchTerm);
        userParamIndex++;
      }

      if (userId) {
        userQuery += `
          AND (
            u.is_public = TRUE
            OR u.id = $${userParamIndex}
          )
        `;
        userParams.push(userId);
        userParamIndex++;
      } else {
        userQuery += ` AND u.is_public = TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "u",
          `$${userParamIndex}`,
        );
        if (distFilter) {
          userQuery += distFilter;
          userParams.push(maxDistance);
          userParamIndex++;
        }
      }

      if (tagIds.length > 0) {
        userQuery += `
          AND u.id IN (
            SELECT ut_filter.user_id FROM user_tags ut_filter
            WHERE ut_filter.tag_id = ANY($${userParamIndex}::int[])
          )
        `;
        userParams.push(tagIds);
        userParamIndex++;
      }

      if (badgeIds.length > 0) {
        userQuery += `
          AND u.id IN (
            SELECT ub_filter.user_id FROM user_badges ub_filter
            WHERE ub_filter.badge_id = ANY($${userParamIndex}::int[])
          )
        `;
        userParams.push(badgeIds);
        userParamIndex++;
      }

      let userOrderBy;
      switch (sort) {
        case "recent":
          userOrderBy =
            direction === "DESC"
              ? "u.updated_at DESC NULLS LAST"
              : "u.updated_at ASC NULLS LAST";
          break;
        case "newest":
          userOrderBy =
            direction === "DESC" ? "u.created_at DESC" : "u.created_at ASC";
          break;
        case "capacity":
          userOrderBy = "u.username ASC";
          break;
        case "match":
          userOrderBy = "u.username ASC";
          break;
        case "proximity":
          if (direction === "REMOTE") {
            userOrderBy = "u.username ASC";
          } else if (userLocation) {
            userOrderBy =
              direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
          } else {
            userOrderBy = "u.username ASC";
          }
          break;
        case "name":
        default:
          userOrderBy =
            direction === "DESC" ? "u.username DESC" : "u.username ASC";
          break;
      }

      userQuery += `
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.country, u.state, u.avatar_url, u.is_public, u.created_at, u.updated_at, u.latitude, u.longitude${userDistanceGroupBy}
        ORDER BY ${userOrderBy}
      `;

      if (!isMatchSort) {
        userQuery += `
          LIMIT $${userParamIndex} OFFSET $${userParamIndex + 1}
        `;
        userParams.push(limit, offset);
      }

      // ========== EXECUTE ALL QUERIES ==========
      console.log("=== DEBUG SQL ===");
      console.log("teamCountQuery:", teamCountQuery);
      console.log("teamCountParams:", teamCountParams);
      console.log("teamQuery:", teamQuery);
      console.log("teamParams:", teamParams);
      console.log("userCountQuery:", userCountQuery);
      console.log("userCountParams:", userCountParams);
      console.log("userQuery:", userQuery);
      console.log("userParams:", userParams);

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

      const totalTeams = parseInt(teamCountResult.rows[0].total, 10);
      const totalUsers = parseInt(userCountResult.rows[0].total, 10);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => {
        let parsedTags = [];

        if (team.tags_json) {
          try {
            const tagStrings = team.tags_json.split(",");
            parsedTags = tagStrings
              .filter((tagStr) => tagStr && tagStr.trim() !== "null")
              .map((tagStr) => {
                try {
                  return JSON.parse(tagStr.trim());
                } catch (parseError) {
                  console.warn("Error parsing tag JSON:", tagStr, parseError);
                  return null;
                }
              })
              .filter((tag) => tag !== null);
          } catch (error) {
            console.warn("Error processing team tags:", error);
          }
        }

        const { tags_json, ...teamWithoutTagsJson } = team;

        return {
          ...teamWithoutTagsJson,
          is_public: team.is_public === true || team.is_public === "true",
          tags: parsedTags,
          available_capacity:
            team.available_capacity !== null
              ? parseInt(team.available_capacity, 10)
              : null,
          distance_km:
            team.distance_km !== undefined && team.distance_km !== null
              ? parseFloat(Number(team.distance_km).toFixed(1))
              : null,
          open_role_count:
            team.open_role_count !== null && team.open_role_count !== undefined
              ? parseInt(team.open_role_count, 10)
              : 0,
        };
      });

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

      if (isMatchSort) {
        try {
          // --- Team scoring: always profile-based ---
          const teamIds = teamsWithFixedVisibility.map((t) => t.id);

          const teamOverlap = await computeTeamTagOverlap(db, userId, teamIds);
          finalTeams = teamsWithFixedVisibility.map((team) => {
            const overlap = teamOverlap.get(team.id);
            return {
              ...team,
              best_match_score: overlap ? overlap.overlapScore : 0,
              shared_tag_count: overlap ? overlap.sharedCount : 0,
              match_type: "tag_overlap",
            };
          });

          finalTeams.sort((a, b) => b.best_match_score - a.best_match_score);

          // --- User scoring: role-based OR profile-based ---
          if (matchRoleId) {
            const roleResult = await db.pool.query(
              `SELECT id, role_name, is_remote, latitude, longitude, max_distance_km,
                      city, country, state
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
              const roleBadgeIds = roleBadgesRes.rows.map((r) => Number(r.badge_id));

              const userIds = usersWithFixedVisibility.map((u) => u.id);

              const [allUserTags, allUserBadges] = await Promise.all([
                db.pool.query(
                  `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
                  [userIds],
                ),
                db.pool.query(
                  `SELECT DISTINCT user_id, badge_id FROM user_badges WHERE user_id = ANY($1)`,
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
                if (!userBadgeMap[r.user_id]) userBadgeMap[r.user_id] = new Set();
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

              finalUsers.sort((a, b) => b.best_match_score - a.best_match_score);
            }
          }

          // Profile-based user scoring (default when no roleId, or role not found)
          if (!matchRoleId || finalUsers === usersWithFixedVisibility) {
            const userIds = usersWithFixedVisibility.map((u) => u.id);
            const userOverlap = await computeUserProfileOverlap(db, userId, userIds);
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

      const paginationBaseItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : Math.max(totalTeams, totalUsers);
      const totalItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : totalTeams + totalUsers;

      res.status(200).json({
        success: true,
        data: {
          teams: paginatedTeams,
          users: paginatedUsers,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
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
        error: error.message,
      });
    }
  },

  /**
   * Get all users and teams with pagination and sorting
   * Used when page loads initially (no search query)
   */
  async getAllUsersAndTeams(req, res) {
    try {
      const { sortBy, sortDir } = req.query;
      const userId = req.user?.id;
      const searchType = parseSearchType(req.query.searchType);
      const includeTeams = searchType !== "users";
      const includeUsers = searchType !== "teams";
      const openRolesOnly = parseBooleanFlag(req.query.openRolesOnly);
      const excludeOwnTeams = parseBooleanFlag(req.query.excludeOwnTeams) && !!userId;

      const tagIds = req.query.tagIds
        ? req.query.tagIds.split(",").map(Number).filter(Number.isFinite)
        : [];
      const badgeIds = req.query.badgeIds
        ? req.query.badgeIds.split(",").map(Number).filter(Number.isFinite)
        : [];

      console.log("GETALL DEBUG: req.user =", req.user);
      console.log("GETALL DEBUG: userId =", userId);

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

      const validDirections = ["asc", "desc", "remote"];
      const direction = validDirections.includes(sortDir)
        ? sortDir.toUpperCase()
        : "ASC";

      const isMatchSort = sort === "match" && !!userId;
      const matchRoleId = req.query.roleId ? parseInt(req.query.roleId, 10) : null;

      const maxDistance = req.query.maxDistance
        ? parseFloat(req.query.maxDistance)
        : null;
      const hasValidMaxDistance =
        maxDistance !== null && Number.isFinite(maxDistance) && maxDistance > 0;

      const capacityMode = req.query.capacityMode === "roles" ? "roles" : "spots";

      console.log(
        `getAllUsersAndTeams: userId=${userId}, page=${page}, limit=${limit}, sortBy=${sort}, sortDir=${direction}, capacityMode=${capacityMode}, searchType=${searchType}, openRolesOnly=${openRolesOnly}`,
      );
      console.log(`Tag filter IDs: ${JSON.stringify(tagIds)}, Badge filter IDs: ${JSON.stringify(badgeIds)}`);
      console.log(`Match sort: roleId=${matchRoleId || 'none (profile-based)'}`);

      let userLocation = null;

      if (userId) {
        userLocation = await searchController.getUserLocation(userId);
        console.log("GETALL DEBUG: userLocation =", userLocation);
      } else {
        console.log(
          "GETALL DEBUG: no userId (req.user missing) -> userLocation null",
        );
      }

      // ========== TEAM COUNT QUERY ==========
      let teamCountQuery = `
        SELECT COUNT(*) as total
        FROM teams t
        WHERE t.archived_at IS NULL
      `;

      let teamCountParams = [];

      if (userId) {
        teamCountQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $1
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $1
            )
          )
        `;
        teamCountParams.push(userId);
      } else {
        teamCountQuery += ` AND t.is_public = TRUE`;
      }

      if (openRolesOnly) {
        teamCountQuery += `
          AND EXISTS (
            SELECT 1
            FROM team_vacant_roles vr_filter
            WHERE vr_filter.team_id = t.id
              AND vr_filter.status = 'open'
          )
        `;
      }

      if (excludeOwnTeams) {
        const memberParamIdx = teamCountParams.length + 1;
        teamCountQuery += `
          AND NOT EXISTS (
            SELECT 1
            FROM team_members tm_excluded
            WHERE tm_excluded.team_id = t.id
              AND tm_excluded.user_id = $${memberParamIdx}
          )
        `;
        teamCountParams.push(userId);
      }

      if (sort === "proximity" && direction === "REMOTE") {
        teamCountQuery += ` AND t.is_remote = TRUE`;
      } else if (sort === "proximity") {
        teamCountQuery += ` AND t.is_remote IS NOT TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "t",
          `$${teamCountParams.length + 1}`,
        );
        if (distFilter) {
          teamCountQuery += distFilter;
          teamCountParams.push(maxDistance);
        }
      }

      if (tagIds.length > 0 && badgeIds.length > 0 && matchRoleId) {
        const tagParam = `$${teamCountParams.length + 1}`;
        const badgeParam = `$${teamCountParams.length + 2}`;
        teamCountQuery += `
          AND (
            t.id IN (
              SELECT tt_filter.team_id FROM team_tags tt_filter
              WHERE tt_filter.tag_id = ANY(${tagParam}::int[])
            )
            OR t.id IN (
              SELECT tm_badge.team_id FROM team_members tm_badge
              JOIN user_badges ub_badge ON tm_badge.user_id = ub_badge.user_id
              WHERE ub_badge.badge_id = ANY(${badgeParam}::int[])
            )
          )
        `;
        teamCountParams.push(tagIds, badgeIds);
      } else {
        if (tagIds.length > 0) {
          teamCountQuery += `
            AND t.id IN (
              SELECT tt_filter.team_id FROM team_tags tt_filter
              WHERE tt_filter.tag_id = ANY($${teamCountParams.length + 1}::int[])
            )
          `;
          teamCountParams.push(tagIds);
        }

        if (badgeIds.length > 0) {
          teamCountQuery += `
            AND t.id IN (
              SELECT tm_badge.team_id FROM team_members tm_badge
              JOIN user_badges ub_badge ON tm_badge.user_id = ub_badge.user_id
              WHERE ub_badge.badge_id = ANY($${teamCountParams.length + 1}::int[])
            )
          `;
          teamCountParams.push(badgeIds);
        }
      }

      // ========== TEAM DATA QUERY ==========
      let teamDistanceSelect = "";
      let teamDistanceGroupBy = "";
      if (sort === "proximity" && userLocation && direction !== "REMOTE") {
        if (userLocation.hasCoordinates) {
          teamDistanceSelect = `,
            CASE
              WHEN t.latitude IS NULL OR t.longitude IS NULL THEN 999999
              ELSE (
                6371 * acos(
                  LEAST(1.0, GREATEST(-1.0,
                    cos(radians(${userLocation.latitude})) * cos(radians(t.latitude)) *
                    cos(radians(t.longitude) - radians(${userLocation.longitude})) +
                    sin(radians(${userLocation.latitude})) * sin(radians(t.latitude))
                  ))
                )
              )
            END as distance_km`;
          teamDistanceGroupBy = ", t.latitude, t.longitude";
        } else if (userLocation.hasPostalCode) {
          teamDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "t")} as distance_km`;
          teamDistanceGroupBy = ", t.postal_code";
        } else if (userLocation.hasCity) {
          teamDistanceSelect = `, 999999 as distance_km`;
        }
      }

      let teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          t.teamavatar_url as "teamavatarUrl",
          t.created_at,
          t.updated_at,
          t.is_remote,
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          CASE
            WHEN t.max_members IS NULL THEN NULL
            ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0)
          END as available_capacity,
          (SELECT COUNT(*) FROM team_vacant_roles vr WHERE vr.team_id = t.id AND vr.status = 'open') AS open_role_count,
          STRING_AGG(
            DISTINCT CASE
              WHEN tag.id IS NOT NULL
              THEN json_build_object('id', tag.id, 'name', tag.name, 'category', tag.category)::text
              ELSE NULL
            END,
            ','
          ) as tags_json
          ${teamDistanceSelect}
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        LEFT JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN tags tag ON tt.tag_id = tag.id
        WHERE t.archived_at IS NULL
      `;

      let teamParams = [];
      let teamParamIndex = 1;

      if (userId) {
        teamQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${teamParamIndex}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${teamParamIndex}
            )
          )
        `;
        teamParams.push(userId);
        teamParamIndex++;
      } else {
        teamQuery += ` AND t.is_public = TRUE`;
      }

      if (openRolesOnly) {
        teamQuery += `
          AND EXISTS (
            SELECT 1
            FROM team_vacant_roles vr_filter
            WHERE vr_filter.team_id = t.id
              AND vr_filter.status = 'open'
          )
        `;
      }

      if (excludeOwnTeams) {
        teamQuery += `
          AND NOT EXISTS (
            SELECT 1
            FROM team_members tm_excluded
            WHERE tm_excluded.team_id = t.id
              AND tm_excluded.user_id = $${teamParamIndex}
          )
        `;
        teamParams.push(userId);
        teamParamIndex++;
      }

      if (sort === "proximity" && direction === "REMOTE") {
        teamQuery += ` AND t.is_remote = TRUE`;
      } else if (sort === "proximity") {
        teamQuery += ` AND t.is_remote IS NOT TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "t",
          `$${teamParamIndex}`,
        );
        if (distFilter) {
          teamQuery += distFilter;
          teamParams.push(maxDistance);
          teamParamIndex++;
        }
      }

      if (tagIds.length > 0 && badgeIds.length > 0 && matchRoleId) {
        const tagParam2 = `$${teamParamIndex}`;
        const badgeParam2 = `$${teamParamIndex + 1}`;
        teamQuery += `
          AND (
            t.id IN (
              SELECT tt_filter.team_id FROM team_tags tt_filter
              WHERE tt_filter.tag_id = ANY(${tagParam2}::int[])
            )
            OR t.id IN (
              SELECT tm_badge.team_id FROM team_members tm_badge
              JOIN user_badges ub_badge ON tm_badge.user_id = ub_badge.user_id
              WHERE ub_badge.badge_id = ANY(${badgeParam2}::int[])
            )
          )
        `;
        teamParams.push(tagIds, badgeIds);
        teamParamIndex += 2;
      } else {
        if (tagIds.length > 0) {
          teamQuery += `
            AND t.id IN (
              SELECT tt_filter.team_id FROM team_tags tt_filter
              WHERE tt_filter.tag_id = ANY($${teamParamIndex}::int[])
            )
          `;
          teamParams.push(tagIds);
          teamParamIndex++;
        }

        if (badgeIds.length > 0) {
          teamQuery += `
            AND t.id IN (
              SELECT tm_badge.team_id FROM team_members tm_badge
              JOIN user_badges ub_badge ON tm_badge.user_id = ub_badge.user_id
              WHERE ub_badge.badge_id = ANY($${teamParamIndex}::int[])
            )
          `;
          teamParams.push(badgeIds);
          teamParamIndex++;
        }
      }

      let teamOrderBy;
      switch (sort) {
        case "recent":
          teamOrderBy =
            direction === "DESC"
              ? "t.updated_at DESC NULLS LAST"
              : "t.updated_at ASC NULLS LAST";
          break;
        case "newest":
          teamOrderBy =
            direction === "DESC" ? "t.created_at DESC" : "t.created_at ASC";
          break;
        case "capacity":
          if (capacityMode === "roles") {
            teamOrderBy =
              direction === "ASC"
                ? "open_role_count ASC, t.name ASC"
                : "open_role_count DESC, t.name ASC";
          } else {
            teamOrderBy =
              direction === "ASC"
                ? "(CASE WHEN t.max_members IS NULL THEN 999999 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) ASC"
                : "(CASE WHEN t.max_members IS NULL THEN -1 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) DESC";
          }
          break;
        case "match":
          teamOrderBy = "t.name ASC";
          break;
        case "proximity":
          if (direction === "REMOTE") {
            teamOrderBy = "t.name ASC";
          } else if (userLocation) {
            teamOrderBy =
              direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
          } else {
            teamOrderBy = "t.name ASC";
          }
          break;
        case "name":
        default:
          teamOrderBy = direction === "DESC" ? "t.name DESC" : "t.name ASC";
          break;
      }

      teamQuery += `
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url, t.created_at, t.updated_at, t.is_remote${teamDistanceGroupBy}
        ORDER BY ${teamOrderBy}
      `;

      if (!isMatchSort) {
        teamQuery += `
          LIMIT $${teamParamIndex} OFFSET $${teamParamIndex + 1}
        `;
        teamParams.push(limit, offset);
      }

      // ========== USER COUNT QUERY ==========
      let userCountQuery = `
        SELECT COUNT(*) as total
        FROM users u
        WHERE 1=1
      `;

      let userCountParams = [];

      if (userId) {
        userCountQuery += `
          AND (
            u.is_public = TRUE
            OR u.id = $1
          )
        `;
        userCountParams.push(userId);
      } else {
        userCountQuery += ` AND u.is_public = TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "u",
          `$${userCountParams.length + 1}`,
        );
        if (distFilter) {
          userCountQuery += distFilter;
          userCountParams.push(maxDistance);
        }
      }

      if (matchRoleId && userId) {
        userCountQuery += ` AND u.id != $${userCountParams.length + 1}`;
        userCountParams.push(userId);
      }

      if (tagIds.length > 0 && badgeIds.length > 0 && matchRoleId) {
        const tagParam = `$${userCountParams.length + 1}`;
        const badgeParam = `$${userCountParams.length + 2}`;
        userCountQuery += `
          AND (
            u.id IN (
              SELECT ut_filter.user_id FROM user_tags ut_filter
              WHERE ut_filter.tag_id = ANY(${tagParam}::int[])
            )
            OR u.id IN (
              SELECT ub_filter.user_id FROM user_badges ub_filter
              WHERE ub_filter.badge_id = ANY(${badgeParam}::int[])
            )
          )
        `;
        userCountParams.push(tagIds, badgeIds);
      } else {
        if (tagIds.length > 0) {
          userCountQuery += `
            AND u.id IN (
              SELECT ut_filter.user_id FROM user_tags ut_filter
              WHERE ut_filter.tag_id = ANY($${userCountParams.length + 1}::int[])
            )
          `;
          userCountParams.push(tagIds);
        }

        if (badgeIds.length > 0) {
          userCountQuery += `
            AND u.id IN (
              SELECT ub_filter.user_id FROM user_badges ub_filter
              WHERE ub_filter.badge_id = ANY($${userCountParams.length + 1}::int[])
            )
          `;
          userCountParams.push(badgeIds);
        }
      }

      // ========== USER DATA QUERY ==========
      let userDistanceSelect = "";
      let userDistanceGroupBy = "";
      if (sort === "proximity" && userLocation && direction !== "REMOTE") {
        if (userLocation.hasCoordinates) {
          userDistanceSelect = `,
            CASE
              WHEN u.latitude IS NULL OR u.longitude IS NULL THEN 999999
              ELSE (
                6371 * acos(
                  LEAST(1.0, GREATEST(-1.0,
                    cos(radians(${userLocation.latitude})) * cos(radians(u.latitude)) *
                    cos(radians(u.longitude) - radians(${userLocation.longitude})) +
                    sin(radians(${userLocation.latitude})) * sin(radians(u.latitude))
                  ))
                )
              )
            END as distance_km`;
          userDistanceGroupBy = "";
        } else if (userLocation.hasPostalCode) {
          userDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "u")} as distance_km`;
        } else if (userLocation.hasCity) {
          userDistanceSelect = `,
            ${searchController.buildCityDistanceSQL(userLocation.city, "u")} as distance_km`;
        }
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
          u.avatar_url,
          u.is_public,
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
        WHERE 1=1
      `;

      let userParams = [];
      let userParamIndex = 1;

      if (userId) {
        userQuery += `
          AND (
            u.is_public = TRUE
            OR u.id = $${userParamIndex}
          )
        `;
        userParams.push(userId);
        userParamIndex++;
      } else {
        userQuery += ` AND u.is_public = TRUE`;
      }

      if (
        hasValidMaxDistance &&
        sort === "proximity" &&
        direction !== "REMOTE"
      ) {
        const distFilter = searchController.buildDistanceFilterSQL(
          userLocation,
          "u",
          `$${userParamIndex}`,
        );
        if (distFilter) {
          userQuery += distFilter;
          userParams.push(maxDistance);
          userParamIndex++;
        }
      }

      if (matchRoleId && userId) {
        userQuery += ` AND u.id != $${userParamIndex}`;
        userParams.push(userId);
        userParamIndex++;
      }

      if (tagIds.length > 0 && badgeIds.length > 0 && matchRoleId) {
        const tagParam2 = `$${userParamIndex}`;
        const badgeParam2 = `$${userParamIndex + 1}`;
        userQuery += `
          AND (
            u.id IN (
              SELECT ut_filter.user_id FROM user_tags ut_filter
              WHERE ut_filter.tag_id = ANY(${tagParam2}::int[])
            )
            OR u.id IN (
              SELECT ub_filter.user_id FROM user_badges ub_filter
              WHERE ub_filter.badge_id = ANY(${badgeParam2}::int[])
            )
          )
        `;
        userParams.push(tagIds, badgeIds);
        userParamIndex += 2;
      } else {
        if (tagIds.length > 0) {
          userQuery += `
            AND u.id IN (
              SELECT ut_filter.user_id FROM user_tags ut_filter
              WHERE ut_filter.tag_id = ANY($${userParamIndex}::int[])
            )
          `;
          userParams.push(tagIds);
          userParamIndex++;
        }

        if (badgeIds.length > 0) {
          userQuery += `
            AND u.id IN (
              SELECT ub_filter.user_id FROM user_badges ub_filter
              WHERE ub_filter.badge_id = ANY($${userParamIndex}::int[])
            )
          `;
          userParams.push(badgeIds);
          userParamIndex++;
        }
      }

      let userOrderBy;
      switch (sort) {
        case "recent":
          userOrderBy =
            direction === "DESC"
              ? "u.updated_at DESC NULLS LAST"
              : "u.updated_at ASC NULLS LAST";
          break;
        case "newest":
          userOrderBy =
            direction === "DESC" ? "u.created_at DESC" : "u.created_at ASC";
          break;
        case "capacity":
          userOrderBy = "u.username ASC";
          break;
        case "match":
          userOrderBy = "u.username ASC";
          break;
        case "proximity":
          if (direction === "REMOTE") {
            userOrderBy = "u.username ASC";
          } else if (userLocation) {
            userOrderBy =
              direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
          } else {
            userOrderBy = "u.username ASC";
          }
          break;
        case "name":
        default:
          userOrderBy =
            direction === "DESC" ? "u.username DESC" : "u.username ASC";
          break;
      }

      userQuery += `
        ORDER BY ${userOrderBy}
      `;

      if (!isMatchSort) {
        userQuery += `
          LIMIT $${userParamIndex} OFFSET $${userParamIndex + 1}
        `;
        userParams.push(limit, offset);
      }

      // ========== EXECUTE ALL QUERIES ==========
      console.log("=== DEBUG SQL ===");
      console.log("teamCountQuery:", teamCountQuery);
      console.log("teamCountParams:", teamCountParams);
      console.log("teamQuery:", teamQuery);
      console.log("teamParams:", teamParams);
      console.log("userCountQuery:", userCountQuery);
      console.log("userCountParams:", userCountParams);
      console.log("userQuery:", userQuery);
      console.log("userParams:", userParams);

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

      const totalTeams = parseInt(teamCountResult.rows[0].total, 10);
      const totalUsers = parseInt(userCountResult.rows[0].total, 10);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => {
        let parsedTags = [];

        if (team.tags_json) {
          try {
            const tagStrings = team.tags_json.split(",");
            parsedTags = tagStrings
              .filter((tagStr) => tagStr && tagStr.trim() !== "null")
              .map((tagStr) => {
                try {
                  return JSON.parse(tagStr.trim());
                } catch (parseError) {
                  console.warn("Error parsing tag JSON:", tagStr, parseError);
                  return null;
                }
              })
              .filter((tag) => tag !== null);
          } catch (error) {
            console.warn("Error processing team tags:", error);
          }
        }

        const { tags_json, ...teamWithoutTagsJson } = team;

        return {
          ...teamWithoutTagsJson,
          is_public: team.is_public === true || team.is_public === "true",
          tags: parsedTags,
          available_capacity:
            team.available_capacity !== null
              ? parseInt(team.available_capacity, 10)
              : null,
          distance_km:
            team.distance_km !== undefined && team.distance_km !== null
              ? parseFloat(Number(team.distance_km).toFixed(1))
              : null,
          open_role_count:
            team.open_role_count !== null && team.open_role_count !== undefined
              ? parseInt(team.open_role_count, 10)
              : 0,
        };
      });

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

      if (isMatchSort) {
        try {
          // --- Team scoring: always profile-based ---
          const teamIds = teamsWithFixedVisibility.map((t) => t.id);

          const teamOverlap = await computeTeamTagOverlap(db, userId, teamIds);
          finalTeams = teamsWithFixedVisibility.map((team) => {
            const overlap = teamOverlap.get(team.id);
            return {
              ...team,
              best_match_score: overlap ? overlap.overlapScore : 0,
              shared_tag_count: overlap ? overlap.sharedCount : 0,
              match_type: "tag_overlap",
            };
          });

          finalTeams.sort((a, b) => b.best_match_score - a.best_match_score);

          // --- User scoring: role-based OR profile-based ---
          if (matchRoleId) {
            const roleResult = await db.pool.query(
              `SELECT id, role_name, is_remote, latitude, longitude, max_distance_km,
                      city, country, state
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
              const roleBadgeIds = roleBadgesRes.rows.map((r) => Number(r.badge_id));

              const userIds = usersWithFixedVisibility.map((u) => u.id);

              const [allUserTags, allUserBadges] = await Promise.all([
                db.pool.query(
                  `SELECT user_id, tag_id FROM user_tags WHERE user_id = ANY($1)`,
                  [userIds],
                ),
                db.pool.query(
                  `SELECT DISTINCT user_id, badge_id FROM user_badges WHERE user_id = ANY($1)`,
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
                if (!userBadgeMap[r.user_id]) userBadgeMap[r.user_id] = new Set();
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

              finalUsers.sort((a, b) => b.best_match_score - a.best_match_score);
            }
          }

          // Profile-based user scoring (default when no roleId, or role not found)
          if (!matchRoleId || finalUsers === usersWithFixedVisibility) {
            const userIds = usersWithFixedVisibility.map((u) => u.id);
            const userOverlap = await computeUserProfileOverlap(db, userId, userIds);
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

      const paginationBaseItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : Math.max(totalTeams, totalUsers);
      const totalItems =
        searchType === "teams"
          ? totalTeams
          : searchType === "users"
            ? totalUsers
            : totalTeams + totalUsers;

      res.status(200).json({
        success: true,
        data: {
          teams: paginatedTeams,
          users: paginatedUsers,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
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
        error: error.message,
      });
    }
  },

  /**
   * Search with filters (existing method - kept for compatibility)
   */
  async search(req, res) {
    try {
      const { query, tags } = req.query;
      const userId = req.user?.id;

      let searchQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          COUNT(tm.id) as member_count
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
      `;

      if (tags) {
        searchQuery += `
          JOIN team_tags tt ON t.id = tt.team_id
          JOIN tags tag ON tt.tag_id = tag.id
        `;
      }

      searchQuery += ` WHERE t.archived_at IS NULL `;

      const queryParams = [];
      let paramIndex = 1;

      if (userId) {
        searchQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${paramIndex}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${paramIndex}
            )
          )
        `;
        queryParams.push(userId);
        paramIndex++;
      } else {
        searchQuery += ` AND t.is_public = TRUE`;
      }

      if (query) {
        searchQuery += ` AND (t.name ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex}) `;
        queryParams.push(`%${query}%`);
        paramIndex++;
      }

      if (tags) {
        const tagIds = Array.isArray(tags) ? tags : [tags];
        searchQuery += ` AND tag.id = ANY($${paramIndex}::int[]) `;
        queryParams.push(tagIds);
        paramIndex++;
      }

      searchQuery += ` GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id `;
      searchQuery += ` ORDER BY t.name ASC LIMIT 20`;

      const result = await db.pool.query(searchQuery, queryParams);

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({
        success: false,
        message: "Error performing search",
        error: error.message,
      });
    }
  },

  /**
   * Search by tag
   */
  async searchByTag(req, res) {
    try {
      const { tagId } = req.params;
      const userId = req.user?.id;

      let searchQuery = `
        SELECT DISTINCT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          COUNT(tm.id) as member_count
        FROM teams t
        JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE tt.tag_id = $1
          AND t.archived_at IS NULL
      `;

      const queryParams = [tagId];
      let paramIndex = 2;

      if (userId) {
        searchQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${paramIndex}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${paramIndex}
            )
          )
        `;
        queryParams.push(userId);
      } else {
        searchQuery += ` AND t.is_public = TRUE`;
      }

      searchQuery += ` GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id `;
      searchQuery += ` ORDER BY t.name ASC LIMIT 20`;

      const result = await db.pool.query(searchQuery, queryParams);

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Search by tag error:", error);
      res.status(500).json({
        success: false,
        message: "Error searching by tag",
        error: error.message,
      });
    }
  },

  /**
   * Search by location
   */
  async searchByLocation(req, res) {
    try {
      const { latitude, longitude, distance = 50 } = req.query;
      const userId = req.user?.id;

      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: "Latitude and longitude are required",
        });
      }

      let searchQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          t.latitude,
          t.longitude,
          COUNT(tm.id) as member_count,
          (
            6371 * acos(
              cos(radians($1)) * cos(radians(t.latitude)) *
              cos(radians(t.longitude) - radians($2)) +
              sin(radians($1)) * sin(radians(t.latitude))
            )
          ) as distance_km
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE t.latitude IS NOT NULL
          AND t.longitude IS NOT NULL
          AND t.archived_at IS NULL
      `;

      const queryParams = [latitude, longitude];
      let paramIndex = 3;

      if (userId) {
        searchQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $${paramIndex}
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $${paramIndex}
            )
          )
        `;
        queryParams.push(userId);
        paramIndex++;
      } else {
        searchQuery += ` AND t.is_public = TRUE`;
      }

      searchQuery += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.latitude, t.longitude
        HAVING (
          6371 * acos(
            cos(radians($1)) * cos(radians(t.latitude)) *
            cos(radians(t.longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(t.latitude))
          )
        ) <= $${paramIndex}
        ORDER BY distance_km ASC
        LIMIT 20
      `;
      queryParams.push(distance);

      const result = await db.pool.query(searchQuery, queryParams);

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error("Search by location error:", error);
      res.status(500).json({
        success: false,
        message: "Error searching by location",
        error: error.message,
      });
    }
  },
};

module.exports = searchController;
