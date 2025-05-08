const db = require('../config/database');

const searchController = {
  async globalSearch(req, res) {
    try {
      const { query, authenticated } = req.query;
      const isAuthenticated = authenticated === 'true';
      const userId = req.user?.id; // Get the current user's ID if authenticated

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search query must be at least 2 characters long'
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
          ${!isAuthenticated ? 'AND t.is_public = TRUE' : ''}
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members
        LIMIT 20
      `;

      // Updated user query to respect profile visibility settings
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
          ${userId ? `u.id = ${userId}` : 'FALSE'} 
        )
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code
        LIMIT 20
      `;

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery, [searchTerm]),
        db.pool.query(userQuery, [searchTerm])
      ]);

      res.status(200).json({
        success: true,
        data: {
          teams: teamResults.rows,
          users: userResults.rows
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

  async getAllUsersAndTeams(req, res) {
    try {
      const { authenticated } = req.query;
      const isAuthenticated = authenticated === 'true';
      const userId = req.user?.id; // Get the current user's ID if authenticated

      const teamQuery = `
        SELECT
          t.id,
          t.name,
          t.description,
          t.is_public,
          t.max_members,
          COUNT(tm.id) as current_members_count
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        WHERE
          t.archived_at IS NULL
          ${!isAuthenticated ? 'AND t.is_public = TRUE' : ''}
        GROUP BY
          t.id, t.name, t.description, t.is_public, t.max_members
        LIMIT 20
      `;

      // Updated user query to respect profile visibility settings
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
          ${userId ? `u.id = ${userId}` : 'FALSE'}
        )
        GROUP BY
          u.id, u.username, u.first_name, u.last_name, u.bio, u.postal_code
        LIMIT 20
      `;

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery),
        db.pool.query(userQuery)
      ]);

      res.status(200).json({
        success: true,
        data: {
          teams: teamResults.rows,
          users: userResults.rows
        }
      });
    } catch (error) {
      console.error('Error fetching all users and teams:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching data',
        error: error.message
      });
    }
  },


  async search(req, res) {
    res.status(200).json({
      success: true,
      message: 'Protected general search',
      data: { results: [] }
    });
  },

  async searchByTag(req, res) {
    const tagId = req.params.tagId;
    res.status(200).json({
      success: true,
      message: `Search by tag ${tagId} placeholder`,
      data: { results: [] }
    });
  },

  async searchByLocation(req, res) {
    res.status(200).json({
      success: true,
      message: 'Search by location placeholder',
      data: { results: [] }
    });
  }
};

module.exports = searchController;