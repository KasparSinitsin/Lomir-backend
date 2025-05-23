const db = require("../config/database");

const searchController = {
  async globalSearch(req, res) {
    try {
      const { query, authenticated } = req.query;
      const isAuthenticated = authenticated === "true";
      const userId = req.user?.id;

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters long",
        });
      }

      const searchTerm = `%${query.trim()}%`;

      const teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.creator_id,
          t.teamavatar_url as "teamavatarUrl",
          COUNT(tm.id) as current_members_count
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
          AND (
            t.is_public = TRUE
            ${
              userId
                ? `OR t.creator_id = ${userId}
               OR EXISTS (
                 SELECT 1 FROM team_members
                 WHERE team_id = t.id AND user_id = ${userId}
               )`
                : ""
            }
          )
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.creator_id
        LIMIT 20
      `;

      const userQuery = `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.bio,
          u.postal_code,
          u.avatar_url,
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
        AND (
          u.is_public = TRUE OR
          ${userId ? `u.id = ${userId}` : "FALSE"} 
        )
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code
        LIMIT 20
      `;

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery, [searchTerm]),
        db.pool.query(userQuery, [searchTerm]),
      ]);

      console.log(
        `Search for "${query}" found ${teamResults.rows.length} teams and ${userResults.rows.length} users`
      );

      const teamsWithFixedVisibility = teamResults.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true,
      }));

      res.status(200).json({
        success: true,
        data: {
          teams: teamsWithFixedVisibility,
          users: userResults.rows,
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
      const isAuthenticated = authenticated === "true";
      const userId = req.user?.id;

      const teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.creator_id,
          t.teamavatar_url as "teamavatarUrl",
          COUNT(tm.id) as current_members_count
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE
          t.archived_at IS NULL
          AND (
            t.is_public = TRUE
            ${
              userId
                ? `OR t.creator_id = ${userId}
               OR EXISTS (
                 SELECT 1 FROM team_members
                 WHERE team_id = t.id AND user_id = ${userId}
               )`
                : ""
            }
          )
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members, t.creator_id
        LIMIT 20
      `;

      const userQuery = `
        SELECT
          u.id,
          u.username,
          u.first_name,
          u.last_name,
          u.bio,
          u.postal_code,
          u.avatar_url,
          (SELECT STRING_AGG(t.name, ', ')
            FROM user_tags ut
            JOIN tags t ON ut.tag_id = t.id
            WHERE ut.user_id = u.id) as tags
        FROM users u
        WHERE (
          u.is_public = TRUE OR
          ${userId ? `u.id = ${userId}` : "FALSE"}
        )
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code
        LIMIT 20
      `;

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery),
        db.pool.query(userQuery),
      ]);

      const teamsWithFixedVisibility = teamResults.rows.map((team) => ({
        ...team,
        is_public: team.is_public === true,
      }));

      res.status(200).json({
        success: true,
        data: {
          teams: teamsWithFixedVisibility,
          users: userResults.rows,
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

      let searchQuery = `
        SELECT
          t.id,
          t.name, 
          t.description,
          t.is_public,
          t.max_members,
          t.creator_id,
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

      searchQuery += `
        AND (
          t.is_public = TRUE
          ${
            userId
              ? `OR t.creator_id = ${userId}
             OR EXISTS (
               SELECT 1 FROM team_members
               WHERE team_id = t.id AND user_id = ${userId}
             )`
              : ""
          }
        )
      `;

      const queryParams = [];
      let paramIndex = 1;

      if (query) {
        searchQuery += ` AND (t.name ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex}) `;
        queryParams.push(`%${query}%`);
        paramIndex++;
      }

      if (tags) {
        const tagIds = Array.isArray(tags) ? tags : [tags];
        const tagPlaceholders = tagIds.map(() => `$${paramIndex++}`).join(",");
        searchQuery += ` AND tag.id IN (${tagPlaceholders}) `;
        queryParams.push(...tagIds);
      }

      if (location) {
        searchQuery += ` AND t.postal_code = $${paramIndex} `;
        queryParams.push(location);
        paramIndex++;
      }

      searchQuery += `
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.creator_id
        LIMIT 20
      `;

      const result = await db.pool.query(searchQuery, queryParams);

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

      const query = `
        SELECT 
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.creator_id,
          COUNT(tm.id) as member_count
        FROM teams t
        JOIN team_tags tt ON t.id = tt.team_id
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE 
          tt.tag_id = $1
          AND t.archived_at IS NULL
          AND (
            t.is_public = TRUE
            ${
              userId
                ? `OR t.creator_id = ${userId}
               OR EXISTS (
                 SELECT 1 FROM team_members
                 WHERE team_id = t.id AND user_id = ${userId}
               )`
                : ""
            }
          )
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.creator_id
        LIMIT 20
      `;

      const result = await db.pool.query(query, [tagId]);

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

      const query = `
        SELECT 
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          t.creator_id,
          COUNT(tm.id) as member_count
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE 
          t.postal_code = $1
          AND t.archived_at IS NULL
          AND (
            t.is_public = TRUE
            ${
              userId
                ? `OR t.creator_id = ${userId}
               OR EXISTS (
                 SELECT 1 FROM team_members
                 WHERE team_id = t.id AND user_id = ${userId}
               )`
                : ""
            }
          )
        GROUP BY t.id, t.name, t.description, t.is_public, t.max_members, t.creator_id
        LIMIT 20
      `;

      const result = await db.pool.query(query, [postalCode]);

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
