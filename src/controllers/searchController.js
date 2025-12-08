const db = require("../config/database");

const searchController = {
  async globalSearch(req, res) {
    try {
      const { query, authenticated } = req.query;
      const userId = req.user?.id;

      console.log(`=== SEARCH DEBUG ===`);
      console.log(`Search query: "${query}"`);
      console.log(`User ID from JWT: ${userId}`);
      console.log(`User ID type: ${typeof userId}`);
      console.log(`Authenticated param: ${authenticated}`);
      console.log(`Full req.user:`, req.user);

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
        });
      }

      const searchTerm = `%${query.trim()}%`;

      // Team query - including tags and visibility conditions
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

      // Initialize parameters array with the search term
      const teamParams = [searchTerm];

      // Add visibility condition based on authentication
      if (userId) {
        teamQuery += `
          AND (
            t.is_public = TRUE
            OR t.owner_id = $2
            OR EXISTS (
              SELECT 1 FROM team_members
              WHERE team_id = t.id AND user_id = $2
            )
          )
        `;
        teamParams.push(userId);
      } else {
        teamQuery += ` AND t.is_public = TRUE`;
      }

      // Add group by and limit - UPDATED to include all non-aggregated columns
      teamQuery += `
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url
        LIMIT 20
      `;

      // User query remains the same as it was working correctly
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

      if (userId) {
        userQuery += `
          AND (
            u.is_public = TRUE
            OR u.id = $2
          )
        `;
        userParams.push(userId);
      } else {
        userQuery += ` AND u.is_public = TRUE`;
      }

      userQuery += `
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.avatar_url, u.is_public
        LIMIT 20
      `;

      console.log(`Executing team query with userId: ${userId}`);
      console.log("Team query:", teamQuery);
      console.log("Team params:", teamParams);

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery, teamParams),
        db.pool.query(userQuery, userParams),
      ]);

      console.log(`Raw team results:`, teamResults.rows);
      console.log(`Raw user results:`, userResults.rows);

      // Process team results to parse the tags JSON
      const teamsWithFixedVisibility = teamResults.rows.map((team) => {
        let parsedTags = [];

        if (team.tags_json) {
          try {
            // Split the concatenated JSON strings and parse each one
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

        // Remove the tags_json field and add the parsed tags
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

      console.log(`Final processed team results:`, teamsWithFixedVisibility);
      console.log(`Final user results:`, usersWithFixedVisibility);

      res.status(200).json({
        success: true,
        data: {
          teams: teamsWithFixedVisibility,
          users: usersWithFixedVisibility,
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

  async getAllUsersAndTeams(req, res) {
    try {
      const { authenticated } = req.query;
      const userId = req.user?.id;

      console.log(
        `getAllUsersAndTeams: userId=${userId}, authenticated=${authenticated}`
      );

      // TEAM QUERY - Fixed parameter handling
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

      if (userId) {
        teamQuery += `
        AND (
          t.is_public = TRUE
          OR t.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM team_members
            WHERE team_id = t.id AND user_id = $1
          )
        )
      `;
        teamParams.push(userId);
      } else {
        teamQuery += ` AND t.is_public = TRUE`;
      }

      teamQuery += `
      GROUP BY
        t.id, t.name, t.description, t.is_public, t.max_members, t.owner_id, t.teamavatar_url
      LIMIT 20
    `;

      // USER QUERY - Fixed parameter handling
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

      if (userId) {
        userQuery += `
        AND (
          u.is_public = TRUE
          OR u.id = $1
        )
      `;
        userParams.push(userId);
      } else {
        userQuery += ` AND u.is_public = TRUE`;
      }

      userQuery += `
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code, u.city, u.avatar_url, u.is_public
        LIMIT 20
      `;

      console.log("Team query:", teamQuery);
      console.log("Team params:", teamParams);
      console.log("User query:", userQuery);
      console.log("User params:", userParams);

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery, teamParams),
        db.pool.query(userQuery, userParams),
      ]);

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

      console.log(`Final processed team results:`, teamsWithFixedVisibility);
      console.log(`Final user results:`, usersWithFixedVisibility);

      res.status(200).json({
        success: true,
        data: {
          teams: teamsWithFixedVisibility,
          users: usersWithFixedVisibility,
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
        // For authenticated users: show public teams OR teams they created OR teams they're a member of
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
        // For non-authenticated users: show only public teams
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

  async searchByTag(req, res) {
    try {
      const tagId = req.params.tagId;
      const userId = req.user?.id;

      // Define the query to get teams with the specified tag
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

      // Add visibility condition based on authentication
      if (userId) {
        // For authenticated users: show public teams OR teams they created OR teams they're a member of
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
        // For non-authenticated users: show only public teams
        query += ` AND t.is_public = TRUE`;
      }

      // Add group by and limit
      query += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members
        LIMIT 20
      `;

      const result = await db.pool.query(query, queryParams);

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
      console.error(`Error searching by tag ${req.params.tagId}:`, error);
      res.status(500).json({
        success: false,
        message: "Error during tag search",
        error: error.message,
      });
    }
  },

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

      // A simple implementation - in a real-world scenario, you would use
      // geospatial queries with coordinates and distance calculations
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

      // Add visibility condition based on authentication
      if (userId) {
        // For authenticated users: show public teams OR teams they created OR teams they're a member of
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
        // For non-authenticated users: show only public teams
        query += ` AND t.is_public = TRUE`;
      }

      // Add group by and limit
      query += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members
        LIMIT 20
      `;

      const result = await db.pool.query(query, queryParams);

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
