const db = require('../config/database');

const searchController = {
  // Global search function
  async globalSearch(req, res) {
    try {
      const { query, authenticated } = req.query;
      const isAuthenticated = authenticated === 'true';
      const userId = req.user?.id;

      if (query && query.trim().length >= 2) {
        const searchTerm = `%${query.trim()}%`;

        const teamQuery = `
          SELECT
            t.id,
            t.name,
            t.description,
            t.is_public,
            t.max_members,
            t.postal_code,
            COUNT(tm.id) as current_members_count
          FROM teams t
          LEFT JOIN team_members tm ON t.id = tm.team_id
          LEFT JOIN team_tags tt ON t.id = tt.team_id
          LEFT JOIN tags tag ON tt.tag_id = tag.id
          WHERE
            (t.name ILIKE $1 OR t.description ILIKE $1 OR tag.name ILIKE $1)
            AND t.archived_at IS NULL
            ${!isAuthenticated ? 'AND t.is_public = TRUE' : ''}
          GROUP BY
            t.id, t.name, t.description, t.is_public, t.max_members, t.postal_code
          LIMIT 20
        `;

        const userQuery = `
          SELECT 
            u.id,
            u.username,
            u.first_name,
            u.last_name,
            u.bio,
            (SELECT STRING_AGG(t.name, ', ') 
             FROM user_tags ut 
             JOIN tags t ON ut.tag_id = t.id 
             WHERE ut.user_id = u.id) as tags
          FROM users u
          LEFT JOIN user_tags ut ON u.id = ut.user_id
          LEFT JOIN tags t ON ut.tag_id = t.id
          WHERE 
            (u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR u.bio ILIKE $1 OR t.name ILIKE $1)
          GROUP BY 
            u.id, u.username, u.first_name, u.last_name, u.bio
          LIMIT 20
        `;

        const [teamResults, userResults] = await Promise.all([
          db.pool.query(teamQuery, [searchTerm]),
          db.pool.query(userQuery, [searchTerm])
        ]);

        return res.status(200).json({
          success: true,
          data: {
            teams: teamResults.rows,
            users: userResults.rows
          }
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'Missing query and unauthenticated request, cannot find shared tags'
        });
      }

      const userTagsResult = await db.pool.query(`
        SELECT tag_id FROM user_tags WHERE user_id = $1
      `, [userId]);

      const tagIds = userTagsResult.rows.map(row => row.tag_id);

      if (tagIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            teams: [],
            users: []
          },
          message: 'No tags found for this user, nothing to match with'
        });
      }

      const usersWithSharedTags = await db.pool.query(`
        SELECT u.id, u.username, u.first_name, u.last_name, u.bio
        FROM users u
        JOIN user_tags ut ON u.id = ut.user_id
        WHERE ut.tag_id = ANY($1)
          AND u.id != $2
          ${!isAuthenticated ? 'AND u.is_public = TRUE' : ''}
        GROUP BY u.id
        LIMIT 20
      `, [tagIds, userId]);

      const teamsWithSharedTags = await db.pool.query(`
        SELECT t.id, t.name, t.description, t.is_public, t.max_members, t.postal_code
        FROM teams t
        JOIN team_tags tt ON t.id = tt.team_id
        WHERE tt.tag_id = ANY($1)
          AND t.archived_at IS NULL
          ${!isAuthenticated ? 'AND t.is_public = TRUE' : ''}
        GROUP BY t.id
        LIMIT 20
      `, [tagIds]);

      return res.status(200).json({
        success: true,
        data: {
          teams: teamsWithSharedTags.rows,
          users: usersWithSharedTags.rows
        }
      });

    } catch (error) {
      console.error('Search error:', error);
      res.status(500).json({
        success: false,
        message: 'Error performing search',
        error: error.message
      });
    }
  },

  // Recommended search based on shared tags
  async getRecommended(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User is not authenticated'
        });
      }

      const userTagsResult = await db.pool.query(`
        SELECT tag_id FROM user_tags WHERE user_id = $1
      `, [userId]);

      const tagIds = userTagsResult.rows.map(row => row.tag_id);

      if (tagIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            teams: [],
            users: []
          },
          message: 'No tags found for this user, nothing to recommend'
        });
      }

      const recommendedUsers = await db.pool.query(`
        SELECT u.id, u.username, u.first_name, u.last_name, u.bio
        FROM users u
        JOIN user_tags ut ON u.id = ut.user_id
        WHERE ut.tag_id = ANY($1)
          AND u.id != $2
        LIMIT 20
      `, [tagIds, userId]);

      const recommendedTeams = await db.pool.query(`
        SELECT t.id, t.name, t.description, t.is_public, t.max_members, t.postal_code
        FROM teams t
        JOIN team_tags tt ON t.id = tt.team_id
        WHERE tt.tag_id = ANY($1)
          AND t.archived_at IS NULL
        LIMIT 20
      `, [tagIds]);

      res.status(200).json({
        success: true,
        data: {
          users: recommendedUsers.rows,
          teams: recommendedTeams.rows
        }
      });
    } catch (error) {
      console.error('Error fetching recommended results:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching recommended results',
        error: error.message
      });
    }
  },

  // Search by tag
  async searchByTag(req, res) {
    try {
      const { tag } = req.query;
      const userId = req.user?.id;
      const isAuthenticated = req.query.authenticated === 'true';

      if (!tag || tag.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Tag query is too short or missing'
        });
      }

      const tagTerm = `%${tag.trim()}%`;

      const tagMatchResult = await db.pool.query(`
        SELECT id FROM tags WHERE name ILIKE $1 LIMIT 1
      `, [tagTerm]);

      if (tagMatchResult.rows.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            users: [],
            teams: []
          },
          message: 'No matching tag found'
        });
      }

      const tagId = tagMatchResult.rows[0].id;

      const userResults = await db.pool.query(`
        SELECT u.id, u.username, u.first_name, u.last_name, u.bio
        FROM users u
        JOIN user_tags ut ON u.id = ut.user_id
        WHERE ut.tag_id = $1
        ${!isAuthenticated ? 'AND u.is_public = TRUE' : ''}
        GROUP BY u.id
        LIMIT 20
      `, [tagId]);

      const teamResults = await db.pool.query(`
        SELECT t.id, t.name, t.description, t.is_public, t.max_members, t.postal_code
        FROM teams t
        JOIN team_tags tt ON t.id = tt.team_id
        WHERE tt.tag_id = $1
          AND t.archived_at IS NULL
        ${!isAuthenticated ? 'AND t.is_public = TRUE' : ''}
        GROUP BY t.id
        LIMIT 20
      `, [tagId]);

      return res.status(200).json({
        success: true,
        data: {
          users: userResults.rows,
          teams: teamResults.rows
        }
      });

    } catch (error) {
      console.error('Search by tag error:', error);
      res.status(500).json({
        success: false,
        message: 'Error performing search by tag',
        error: error.message
      });
    }
  },

  // Search by location (users only)
  async searchByLocation(req, res) {
    try {
      const { location, authenticated } = req.query;
      const isAuthenticated = authenticated === 'true';

      if (location && location.trim().length >= 2) {
        const searchTerm = `%${location.trim()}%`;

        const userQuery = `
          SELECT 
            u.id,
            u.username,
            u.first_name,
            u.last_name,
            u.bio,
            u.location,
            (SELECT STRING_AGG(t.name, ', ') 
             FROM user_tags ut 
             JOIN tags t ON ut.tag_id = t.id 
             WHERE ut.user_id = u.id) as tags
          FROM users u
          WHERE 
            (u.location ILIKE $1 OR u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR u.bio ILIKE $1)
          ${!isAuthenticated ? 'AND u.is_public = TRUE' : ''}
          GROUP BY 
            u.id, u.username, u.first_name, u.last_name, u.bio, u.location
          LIMIT 20
        `;

        const userResults = await db.pool.query(userQuery, [searchTerm]);

        return res.status(200).json({
          success: true,
          data: {
            users: userResults.rows
          }
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Location query is too short or missing'
      });

    } catch (error) {
      console.error('Search by location error:', error);
      res.status(500).json({
        success: false,
        message: 'Error performing search by location',
        error: error.message
      });
    }
  }
};

module.exports = {
  globalSearch: searchController.globalSearch,
  getRecommended: searchController.getRecommended,
  searchByTag: searchController.searchByTag,
  searchByLocation: searchController.searchByLocation
};