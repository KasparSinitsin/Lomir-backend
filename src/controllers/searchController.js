const db = require("../config/database");

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

    // coords are valid only if both parse into finite numbers
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
   * Global search with pagination and sorting
   * Searches teams and users based on query string
   */
  async globalSearch(req, res) {
    try {
      const { query, authenticated, sortBy, sortDir } = req.query;
      const userId = req.user?.id;

      // === PAGINATION PARAMETERS ===
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;

      // === SORTING PARAMETERS ===
      // Options: 'recent' (updated_at), 'newest' (created_at), 'name' (alphabetical), 'capacity' (available spots), 'proximity' (distance)
      const validSortOptions = [
        "recent",
        "newest",
        "name",
        "capacity",
        "proximity",
      ];
      const sort = validSortOptions.includes(sortBy) ? sortBy : "name";

      // Direction: 'asc' or 'desc'
      const validDirections = ["asc", "desc"];
      const direction = validDirections.includes(sortDir)
        ? sortDir.toUpperCase()
        : "ASC";

      console.log(`=== SEARCH DEBUG ===`);
      console.log(`Search query: "${query}"`);
      console.log(`User ID from JWT: ${userId}`);
      console.log(`Pagination: page=${page}, limit=${limit}, offset=${offset}`);
      console.log(`Sort by: ${sort}, direction: ${direction}`);

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
        });
      }

      const searchTerm = `%${query.trim()}%`;

      // === GET USER LOCATION (needed for proximity sorting + for UI metadata) ===
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
        WHERE (
            t.name ILIKE $1 OR
            t.description ILIKE $1 OR
            tag.name ILIKE $1
          )
          AND t.archived_at IS NULL
      `;

      const teamCountParams = [searchTerm];

      if (userId) {
        teamCountQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $2
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $2
            )
          )
        `;
        teamCountParams.push(userId);
      } else {
        teamCountQuery += ` AND t.is_public = TRUE`;
      }

      // ========== TEAM DATA QUERY ==========
      // Build distance calculation for proximity sort
      let teamDistanceSelect = "";
      let teamDistanceGroupBy = "";
      if (sort === "proximity" && userLocation) {
        if (userLocation.hasCoordinates) {
          // Use Haversine formula for coordinate-based distance
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
          // Use postal code based distance
          teamDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "t")} as distance_km`;
          teamDistanceGroupBy = ", t.postal_code";
        } else if (userLocation.hasCity) {
          // Use city based distance
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
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          CASE 
            WHEN t.max_members IS NULL THEN NULL
            ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0)
          END as available_capacity,
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
        WHERE (
            t.name ILIKE $1 OR
            t.description ILIKE $1 OR
            tag.name ILIKE $1
          )
          AND t.archived_at IS NULL
      `;

      const teamParams = [searchTerm];
      let teamParamIndex = 2;

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

      // Determine ORDER BY clause based on sort parameter and direction
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
          teamOrderBy =
            direction === "DESC"
              ? "(CASE WHEN t.max_members IS NULL THEN -1 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) DESC"
              : "(CASE WHEN t.max_members IS NULL THEN 999999 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) ASC";
          break;
        case "proximity":
          if (userLocation) {
            // Sort by distance, high values (no location) go last
            teamOrderBy =
              direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
          } else {
            // No user location, fall back to name
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
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url, t.created_at, t.updated_at${teamDistanceGroupBy}
        ORDER BY ${teamOrderBy}
        LIMIT $${teamParamIndex} OFFSET $${teamParamIndex + 1}
      `;
      teamParams.push(limit, offset);

      // ========== USER COUNT QUERY ==========
      let userCountQuery = `
        SELECT COUNT(DISTINCT u.id) as total
        FROM users u
        LEFT JOIN user_tags ut ON u.id = ut.user_id
        LEFT JOIN tags t ON ut.tag_id = t.id
        WHERE (
            u.username ILIKE $1 OR
            u.first_name ILIKE $1 OR
            u.last_name ILIKE $1 OR
            u.bio ILIKE $1 OR
            t.name ILIKE $1
        )
      `;

      const userCountParams = [searchTerm];

      if (userId) {
        userCountQuery += `
          AND (
            u.is_public = TRUE
            OR u.id = $2
          )
        `;
        userCountParams.push(userId);
      } else {
        userCountQuery += ` AND u.is_public = TRUE`;
      }

      // ========== USER DATA QUERY ==========
      // Build distance calculation for proximity sort
      let userDistanceSelect = "";
      let userDistanceGroupBy = "";
      if (sort === "proximity" && userLocation) {
        if (userLocation.hasCoordinates) {
          // Use Haversine formula for coordinate-based distance
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
          userDistanceGroupBy = ", u.latitude, u.longitude";
        } else if (userLocation.hasPostalCode) {
          // Use postal code based distance
          userDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "u")} as distance_km`;
          // postal_code already in GROUP BY
        } else if (userLocation.hasCity) {
          // Use city based distance
          userDistanceSelect = `,
            ${searchController.buildCityDistanceSQL(userLocation.city, "u")} as distance_km`;
          // city already in GROUP BY
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
          (SELECT STRING_AGG(t.name, ', ')
            FROM user_tags ut
            JOIN tags t ON ut.tag_id = t.id
            WHERE ut.user_id = u.id) as tags
          ${userDistanceSelect}
        FROM users u
        LEFT JOIN user_tags ut ON u.id = ut.user_id
        LEFT JOIN tags t ON ut.tag_id = t.id
        WHERE (
            u.username ILIKE $1 OR
            u.first_name ILIKE $1 OR
            u.last_name ILIKE $1 OR
            u.bio ILIKE $1 OR
            t.name ILIKE $1
        )
      `;

      const userParams = [searchTerm];
      let userParamIndex = 2;

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

      // Determine ORDER BY clause for users based on sort parameter and direction
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
          // Capacity doesn't apply to users, default to name
          userOrderBy = "u.username ASC";
          break;
        case "proximity":
          if (userLocation) {
            // Sort by distance, high values (no location) go last
            userOrderBy =
              direction === "DESC" ? "distance_km DESC" : "distance_km ASC";
          } else {
            // No user location, fall back to name
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
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.country, u.state, u.avatar_url, u.is_public, u.created_at, u.updated_at${userDistanceGroupBy}
        ORDER BY ${userOrderBy}
        LIMIT $${userParamIndex} OFFSET $${userParamIndex + 1}
      `;
      userParams.push(limit, offset);

      // ========== EXECUTE ALL QUERIES ==========
      const [teamCountResult, teamResults, userCountResult, userResults] =
        await Promise.all([
          db.pool.query(teamCountQuery, teamCountParams),
          db.pool.query(teamQuery, teamParams),
          db.pool.query(userCountQuery, userCountParams),
          db.pool.query(userQuery, userParams),
        ]);

      const totalTeams = parseInt(teamCountResult.rows[0].total);
      const totalUsers = parseInt(userCountResult.rows[0].total);

      // Process team results to parse the tags JSON
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
          is_public: team.is_public === true,
          tags: parsedTags,
          available_capacity:
            team.available_capacity !== null
              ? parseInt(team.available_capacity)
              : null,
          distance_km:
            team.distance_km !== undefined && team.distance_km !== null
              ? parseFloat(team.distance_km.toFixed(1))
              : null,
        };
      });

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true,
        distance_km:
          user.distance_km !== undefined && user.distance_km !== null
            ? parseFloat(user.distance_km.toFixed(1))
            : null,
      }));

      // ========== RETURN RESPONSE WITH PAGINATION METADATA ==========
      const maxItems = Math.max(totalTeams, totalUsers);

      res.status(200).json({
        success: true,
        data: {
          teams: teamsWithFixedVisibility,
          users: usersWithFixedVisibility,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
          totalItems: totalTeams + totalUsers,
          totalPages: Math.ceil(maxItems / limit),
          hasNextPage: offset + limit < maxItems,
          hasPrevPage: page > 1,
        },
        sorting: {
          sortBy: sort,
          sortDir: direction.toLowerCase(),
        },
        userLocation: userLocation
          ? { hasLocation: true }
          : { hasLocation: false },
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
      const { authenticated, sortBy, sortDir } = req.query;
      const userId = req.user?.id;

      console.log("GETALL DEBUG: req.user =", req.user);
      console.log("GETALL DEBUG: userId =", userId);

      // === PAGINATION PARAMETERS ===
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;

      // === SORTING PARAMETERS ===
      const validSortOptions = [
        "recent",
        "newest",
        "name",
        "capacity",
        "proximity",
      ];
      const sort = validSortOptions.includes(sortBy) ? sortBy : "name";

      // Direction: 'asc' or 'desc'
      const validDirections = ["asc", "desc"];
      const direction = validDirections.includes(sortDir)
        ? sortDir.toUpperCase()
        : "ASC";

      console.log(
        `getAllUsersAndTeams: userId=${userId}, authenticated=${authenticated}, page=${page}, limit=${limit}, sortBy=${sort}, sortDir=${direction}`,
      );

      // === GET USER LOCATION (needed to decide if UI can show proximity) ===
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

      // ========== TEAM DATA QUERY ==========
      // Build distance calculation for proximity sort
      let teamDistanceSelect = "";
      let teamDistanceGroupBy = "";
      if (sort === "proximity" && userLocation) {
        if (userLocation.hasCoordinates) {
          // Use Haversine formula for coordinate-based distance
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
          // Use postal code based distance
          teamDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "t")} as distance_km`;
          teamDistanceGroupBy = ", t.postal_code";
        } else if (userLocation.hasCity) {
          // Use city based distance (teams don't have city, use postal_code only)
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
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          CASE 
            WHEN t.max_members IS NULL THEN NULL
            ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0)
          END as available_capacity,
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

      // Determine ORDER BY clause based on sort parameter and direction
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
          teamOrderBy =
            direction === "DESC"
              ? "(CASE WHEN t.max_members IS NULL THEN -1 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) DESC"
              : "(CASE WHEN t.max_members IS NULL THEN 999999 ELSE t.max_members - COALESCE(COUNT(DISTINCT tm.user_id), 0) END) ASC";
          break;
        case "proximity":
          if (userLocation) {
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
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url, t.created_at, t.updated_at${teamDistanceGroupBy}
        ORDER BY ${teamOrderBy}
        LIMIT $${teamParamIndex} OFFSET $${teamParamIndex + 1}
      `;
      teamParams.push(limit, offset);

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

      // ========== USER DATA QUERY ==========
      // Build distance calculation for proximity sort
      let userDistanceSelect = "";
      let userDistanceGroupBy = "";
      if (sort === "proximity" && userLocation) {
        if (userLocation.hasCoordinates) {
          // Use Haversine formula for coordinate-based distance
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
          userDistanceGroupBy = ", u.latitude, u.longitude";
        } else if (userLocation.hasPostalCode) {
          // Use postal code based distance
          userDistanceSelect = `,
            ${searchController.buildPostalCodeDistanceSQL(userLocation.postal_code, "u")} as distance_km`;
          // postal_code already in GROUP BY
        } else if (userLocation.hasCity) {
          // Use city based distance
          userDistanceSelect = `,
            ${searchController.buildCityDistanceSQL(userLocation.city, "u")} as distance_km`;
          // city already in GROUP BY
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
          (SELECT STRING_AGG(t.name, ', ')
            FROM user_tags ut
            JOIN tags t ON ut.tag_id = t.id
            WHERE ut.user_id = u.id) as tags
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

      // Determine ORDER BY clause for users based on sort parameter and direction
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
        case "proximity":
          if (userLocation) {
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
        LIMIT $${userParamIndex} OFFSET $${userParamIndex + 1}
      `;
      userParams.push(limit, offset);

      // ========== EXECUTE ALL QUERIES ==========
      const [teamCountResult, teamResults, userCountResult, userResults] =
        await Promise.all([
          db.pool.query(teamCountQuery, teamCountParams),
          db.pool.query(teamQuery, teamParams),
          db.pool.query(userCountQuery, userCountParams),
          db.pool.query(userQuery, userParams),
        ]);

      const totalTeams = parseInt(teamCountResult.rows[0].total);
      const totalUsers = parseInt(userCountResult.rows[0].total);

      // Process team results to parse the tags JSON
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
          is_public: team.is_public === true,
          tags: parsedTags,
          available_capacity:
            team.available_capacity !== null
              ? parseInt(team.available_capacity)
              : null,
          distance_km:
            team.distance_km !== undefined && team.distance_km !== null
              ? parseFloat(team.distance_km.toFixed(1))
              : null,
        };
      });

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true,
        distance_km:
          user.distance_km !== undefined && user.distance_km !== null
            ? parseFloat(user.distance_km.toFixed(1))
            : null,
      }));

      // ========== RETURN RESPONSE WITH PAGINATION METADATA ==========
      const maxItems = Math.max(totalTeams, totalUsers);

      res.status(200).json({
        success: true,
        data: {
          teams: teamsWithFixedVisibility,
          users: usersWithFixedVisibility,
        },
        pagination: {
          page,
          limit,
          totalTeams,
          totalUsers,
          totalItems: totalTeams + totalUsers,
          totalPages: Math.ceil(maxItems / limit),
          hasNextPage: offset + limit < maxItems,
          hasPrevPage: page > 1,
        },
        sorting: {
          sortBy: sort,
          sortDir: direction.toLowerCase(),
        },
        userLocation: userLocation
          ? { hasLocation: true }
          : { hasLocation: false },
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
      const { query, tags, location, distance } = req.query;
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

      // Calculate distance using Haversine formula in PostgreSQL
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
