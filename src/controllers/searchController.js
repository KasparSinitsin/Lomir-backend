const db = require("../config/database");

const searchController = {
  /**
   * Global search with pagination
   * Searches teams and users based on query string
   */
  async globalSearch(req, res) {
    try {
      const { query, authenticated } = req.query;
      const userId = req.user?.id;

      // === PAGINATION PARAMETERS ===
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20; // Default 20 results per page
      const offset = (page - 1) * limit;

      console.log(`=== SEARCH DEBUG ===`);
      console.log(`Search query: "${query}"`);
      console.log(`User ID from JWT: ${userId}`);
      console.log(`Pagination: page=${page}, limit=${limit}, offset=${offset}`);

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
        });
      }

      const searchTerm = `%${query.trim()}%`;

      // ========== TEAM COUNT QUERY ==========
      // First, get total count of matching teams for pagination metadata
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
      let teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          t.teamavatar_url as "teamavatarUrl",
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          STRING_AGG(
            DISTINCT CASE 
              WHEN tag.id IS NOT NULL 
              THEN json_build_object('id', tag.id, 'name', tag.name, 'category', tag.category)::text 
              ELSE NULL 
            END, 
            ','
          ) as tags_json
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

      // Add GROUP BY, ORDER BY, LIMIT and OFFSET for pagination
      teamQuery += `
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url
        ORDER BY t.name ASC
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
      let userQuery = `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.bio,
          u.postal_code,
          u.city,
          u.avatar_url,
          u.is_public,
          (SELECT STRING_AGG(t.name, ', ')
            FROM user_tags ut
            JOIN tags t ON ut.tag_id = t.id
            WHERE ut.user_id = u.id) as tags
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

      // Add GROUP BY, ORDER BY, LIMIT and OFFSET for pagination
      userQuery += `
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.avatar_url, u.is_public
        ORDER BY u.username ASC
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
        };
      });

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true,
      }));

      // ========== RETURN RESPONSE WITH PAGINATION METADATA ==========
      // Calculate totalPages based on the larger collection since teams and users
      // are paginated separately with the same offset
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
   * Get all users and teams with pagination
   * Used when page loads initially (no search query)
   */
  async getAllUsersAndTeams(req, res) {
    try {
      const { authenticated } = req.query;
      const userId = req.user?.id;

      // === PAGINATION PARAMETERS ===
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20; // Default 20 results per page
      const offset = (page - 1) * limit;

      console.log(
        `getAllUsersAndTeams: userId=${userId}, authenticated=${authenticated}, page=${page}, limit=${limit}`,
      );

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
      let teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.owner_id,
          t.teamavatar_url as "teamavatarUrl",
          COALESCE(COUNT(DISTINCT tm.user_id), 0) as current_members_count,
          STRING_AGG(
            DISTINCT CASE 
              WHEN tag.id IS NOT NULL 
              THEN json_build_object('id', tag.id, 'name', tag.name, 'category', tag.category)::text 
              ELSE NULL 
            END, 
            ','
          ) as tags_json
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

      teamQuery += `
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url
        ORDER BY t.created_at DESC
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
      let userQuery = `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.bio,
          u.postal_code,
          u.city,
          u.avatar_url,
          u.is_public,
          (SELECT STRING_AGG(t.name, ', ')
            FROM user_tags ut
            JOIN tags t ON ut.tag_id = t.id
            WHERE ut.user_id = u.id) as tags
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

      userQuery += `
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.avatar_url, u.is_public
        ORDER BY u.created_at DESC
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
        };
      });

      const usersWithFixedVisibility = userResults.rows.map((user) => ({
        ...user,
        is_public: user.is_public === true,
      }));

      // ========== RETURN RESPONSE WITH PAGINATION METADATA ==========
      // Calculate totalPages based on the larger collection since teams and users
      // are paginated separately with the same offset
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

      // Build dynamic search query with parameter placeholders
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

      // Add tag joins if searching by tags
      if (tags) {
        searchQuery += `
          JOIN team_tags tt ON t.id = tt.team_id
          JOIN tags tag ON tt.tag_id = tag.id
        `;
      }

      // Start WHERE clause
      searchQuery += ` WHERE t.archived_at IS NULL `;

      // Initialize parameters array
      const queryParams = [];
      let paramIndex = 1;

      // Add visibility condition based on authentication
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

      // Add search term condition if query is provided
      if (query) {
        searchQuery += ` AND (t.name ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex}) `;
        queryParams.push(`%${query}%`);
        paramIndex++;
      }

      // Add tag condition if tags are provided
      if (tags) {
        const tagIds = Array.isArray(tags) ? tags : [tags];
        const tagPlaceholders = tagIds
          .map((_, i) => `$${paramIndex + i}`)
          .join(",");
        searchQuery += ` AND tag.id IN (${tagPlaceholders}) `;
        queryParams.push(...tagIds);
        paramIndex += tagIds.length;
      }

      // Add location condition if location is provided
      if (location) {
        searchQuery += ` AND t.postal_code = $${paramIndex} `;
        queryParams.push(location);
        paramIndex++;
      }

      // Group by and limit
      searchQuery += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id
        LIMIT 20
      `;

      const result = await db.pool.query(searchQuery, queryParams);

      // Ensure proper boolean values for is_public in teams
      const teamsWithFixedVisibility = result.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true,
      }));

      res.status(200).json({
        success: true,
        data: {
          results: teamsWithFixedVisibility,
        },
      });
    } catch (error) {
      console.error("Error during search:", error);
      res.status(500).json({
        success: false,
        message: "Error during search",
        error: error.message,
      });
    }
  },

  /**
   * Search teams by tag ID
   */
  async searchByTag(req, res) {
    try {
      const tagId = req.params.tagId;
      const userId = req.user?.id;

      let query = `
        SELECT 
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          COUNT(tm.id) as member_count
        FROM teams t
        JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE 
          tt.tag_id = $1
          AND t.archived_at IS NULL
      `;

      const queryParams = [tagId];
      let paramIndex = 2;

      if (userId) {
        query += `
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
        query += ` AND t.is_public = TRUE`;
      }

      query += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members
        LIMIT 20
      `;

      const result = await db.pool.query(query, queryParams);

      const teamsWithFixedVisibility = result.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true,
      }));

      res.status(200).json({
        success: true,
        data: {
          results: teamsWithFixedVisibility,
        },
      });
    } catch (error) {
      console.error(`Error searching by tag ${req.params.tagId}:`, error);
      res.status(500).json({
        success: false,
        message: "Error during tag search",
        error: error.message,
      });
    }
  },

  /**
   * Search teams by location/postal code
   */
  async searchByLocation(req, res) {
    try {
      const { postalCode, distance } = req.query;
      const userId = req.user?.id;

      if (!postalCode) {
        return res.status(400).json({
          success: false,
          message: "Postal code is required for location search",
        });
      }

      let query = `
        SELECT 
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          COUNT(tm.id) as member_count
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE 
          t.postal_code = $1
          AND t.archived_at IS NULL
      `;

      const queryParams = [postalCode];
      let paramIndex = 2;

      if (userId) {
        query += `
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
        query += ` AND t.is_public = TRUE`;
      }

      query += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members
        LIMIT 20
      `;

      const result = await db.pool.query(query, queryParams);

      const teamsWithFixedVisibility = result.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true,
      }));

      res.status(200).json({
        success: true,
        data: {
          results: teamsWithFixedVisibility,
        },
      });
    } catch (error) {
      console.error("Error during location search:", error);
      res.status(500).json({
        success: false,
        message: "Error during location search",
        error: error.message,
      });
    }
  },
};

module.exports = searchController;
