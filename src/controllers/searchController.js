const db = require('../config/database');

const searchController = {
  async globalSearch(req, res) {
    try {
      const { query, authenticated = false } = req.query;

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
          ${!authenticated ? 'AND is_public = TRUE' : ''}
        LIMIT 12
      `;

      // Base user search query
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
          ${!authenticated ? 'AND is_public = TRUE' : ''}
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
  }
};

module.exports = searchController;