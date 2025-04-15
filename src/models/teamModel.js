const db = require('../config/database');

const teamModel = {
  /**
   * Create a new team in the database
   * @param {Object} teamData - Team data (name, description, tags, etc.)
   * @returns {Object} Created team object
   */
  async createTeam(teamData) {
    const { tags, ...teamDetails } = teamData;
    
    const client = await db.pool.connect();
    
    try {
      // Start a database transaction
      await client.query('BEGIN');
      
      // Insert team
      const teamResult = await client.query(`
        INSERT INTO teams (
          name, 
          description, 
          is_public, 
          max_members
        ) VALUES ($1, $2, $3, $4) 
        RETURNING id, name, description, is_public, max_members
      `, [
        teamDetails.name,
        teamDetails.description,
        teamDetails.is_public,
        teamDetails.max_members
      ]);
      
      const teamId = teamResult.rows[0].id;
      
      // Insert team tags if present
      if (tags && tags.length > 0) {
        const tagInserts = tags.map(tag => 
          client.query(`
            INSERT INTO team_tags (
              team_id, 
              tag_id
            ) VALUES ($1, $2)
          `, [
            teamId, 
            tag.tag_id
          ])
        );
        
        await Promise.all(tagInserts);
      }
      
      // Commit the transaction
      await client.query('COMMIT');
      
      // Return the team details
      return teamResult.rows[0];
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query('ROLLBACK');
      console.error('Error creating team:', error);
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  },
  
  /**
   * Find a team by ID
   * @param {Number} id - Team ID
   * @returns {Object|null} Team object or null if not found
   */
  async findById(id) {
    const result = await db.query(
      'SELECT id, name, description, is_public, max_members FROM teams WHERE id = $1',
      [id]
    );
    
    return result.rows[0] || null;
  },
  
  /**
   * Get all teams
   * @returns {Array} List of teams
   */
  async getAllTeams() {
    const result = await db.query('SELECT * FROM teams');
    return result.rows;
  },
};

module.exports = teamModel;