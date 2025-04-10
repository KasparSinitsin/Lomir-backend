const db = require('../config/database');

const searchController = {
  async globalSearch(req, res) {
    try {
      const { query, authenticated } = req.query;
      const isAuthenticated = authenticated === 'true'; // Ensure boolean interpretation

      // Basic security check: prevent searching with too short queries
      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search query must be at least 2 characters long'
        });
      }

      // Prepare the search query with wildcard
      const searchTerm = `%${query.trim()}%`;

      // Base team search query
      const teamQuery = `
        SELECT
          id,
          name,
          description,
          is_public,
          max_members,
          postal_code,
          (SELECT COUNT(*) FROM team_members WHERE team_id = teams.id) as current_members_count
        FROM teams
        WHERE
          (name ILIKE $1 OR description ILIKE $1)
          AND archived_at IS NULL
          ${!isAuthenticated ? 'AND is_public = TRUE' : ''}
        LIMIT 12
      `;

      // Base user search query (assuming an is_public field exists in your users table)
      const userQuery = `
        SELECT
          id,
          username,
          first_name,
          last_name,
          bio
        FROM users
        WHERE
          (username ILIKE $1
           OR first_name ILIKE $1
           OR last_name ILIKE $1
           OR bio ILIKE $1)
          ${!isAuthenticated ? 'AND is_public = TRUE' : ''}
        LIMIT 12
      `;

      // Execute both searches
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

  search: async (req, res) => {
    try {
      res.status(200).json({
        success: true,
        message: 'General search placeholder',
        data: { results: [] }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error during general search',
        error: error.message
      });
    }
  },


  searchByTag: async (req, res) => {
    try {
      const tagId = req.params.tagId;
      res.status(200).json({
        success: true,
        message: `Search by tag ${tagId} placeholder`,
        data: { results: [] }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error during tag search',
        error: error.message
      });
    }
  },

  searchByLocation: async (req, res) => {
    try {
      res.status(200).json({
        success: true,
        message: 'Search by location placeholder',
        data: { results: [] }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error during location search',
        error: error.message
      });
    }
  }
};

module.exports = searchController;