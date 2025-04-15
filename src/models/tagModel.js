const db = require('../config/database');

const tagModel = {
  /**
   * Create a new tag in the database
   * @param {Object} tagData - Tag data (name)
   * @returns {Object} Created tag object
   */
  async createTag(tagData) {
    const { name } = tagData;
    
    const client = await db.pool.connect();
    
    try {
      // Insert tag
      const tagResult = await client.query(`
        INSERT INTO tags (
          name
        ) VALUES ($1) 
        RETURNING id, name
      `, [name]);
      
      return tagResult.rows[0];
    } catch (error) {
      console.error('Error creating tag:', error);
      throw error;
    } finally {
      client.release();
    }
  },
  
  /**
   * Find a tag by name
   * @param {String} name - Tag name
   * @returns {Object|null} Tag object or null if not found
   */
  async findByName(name) {
    const result = await db.query(
      'SELECT id, name FROM tags WHERE name = $1',
      [name]
    );
    
    return result.rows[0] || null;
  },
  
  /**
   * Get all tags
   * @returns {Array} List of tags
   */
  async getAllTags() {
    const result = await db.query('SELECT * FROM tags');
    return result.rows;
  },
};

module.exports = tagModel;