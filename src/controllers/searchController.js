const db = require('../config/database');
// const geocodingService = require('../services/geocodingService'); // Uncomment when implementing geocoding

const searchController = {
  // ... other existing methods (globalSearch, etc.) ...

  async searchByLocation(req, res) {
    try {
      const { postalCode, radius = 50 } = req.query;

      if (!postalCode) {
        return res.status(400).json({
          success: false,
          message: 'Postal code is required'
        });
      }

      // TODO: Implement Geocoding Service
      // Potential future implementation:
      /*
      try {
        // Fetch nearby postal codes using a geocoding service
        const nearbyCodes = await geocodingService.findNearbyPostalCodes(
          postalCode, 
          radius
        );

        // Use nearby postal codes for searching
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
            postal_code = ANY($1)
            AND archived_at IS NULL
          LIMIT 12
        `;

        const userQuery = `
          SELECT 
            id, 
            username, 
            first_name, 
            last_name, 
            bio
          FROM users
          WHERE 
            postal_code = ANY($1)
          LIMIT 12
        `;

        const [teamResults, userResults] = await Promise.all([
          db.pool.query(teamQuery, [nearbyCodes]),
          db.pool.query(userQuery, [nearbyCodes])
        ]);

        return res.status(200).json({
          success: true,
          data: {
            teams: teamResults.rows,
            users: userResults.rows,
            radius: radius
          }
        });
      } catch (geocodingError) {
        console.error('Geocoding error:', geocodingError);
        // Fallback to exact postal code match if geocoding fails
      }
      */

      // Current simple implementation (exact postal code match)
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
          postal_code = $1
          AND archived_at IS NULL
        LIMIT 12
      `;

      const userQuery = `
        SELECT 
          id, 
          username, 
          first_name, 
          last_name, 
          bio
        FROM users
        WHERE 
          postal_code = $1
        LIMIT 12
      `;

      const [teamResults, userResults] = await Promise.all([
        db.pool.query(teamQuery, [postalCode]),
        db.pool.query(userQuery, [postalCode])
      ]);

      res.status(200).json({
        success: true,
        data: {
          teams: teamResults.rows,
          users: userResults.rows,
          radius: radius
        }
      });
    } catch (error) {
      console.error('Location search error:', error);
      res.status(500).json({
        success: false,
        message: 'Error performing location search',
        error: error.message
      });
    }
  }
};

module.exports = searchController;