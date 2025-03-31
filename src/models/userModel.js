const db = require('../config/database');
const bcrypt = require('bcrypt');

const userModel = {
  /**
   * Create a new user in the database
   * @param {Object} user - User data (username, email, password, etc.)
   * @returns {Object} Created user object
   */
  async createUser(userData) {
    const { username, email, password, first_name, last_name, bio, postal_code } = userData;
    
    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    const result = await db.query(
      `INSERT INTO users 
        (username, email, password_hash, first_name, last_name, bio, postal_code) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, username, email, first_name, last_name, bio, postal_code, created_at`,
      [username, email, password_hash, first_name, last_name, bio, postal_code]
    );
    
    return result.rows[0];
  },
  
  /**
   * Find a user by email
   * @param {String} email - User email
   * @returns {Object|null} User object or null if not found
   */
  async findByEmail(email) {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    return result.rows[0] || null;
  },
  
  /**
   * Find a user by username
   * @param {String} username - Username
   * @returns {Object|null} User object or null if not found
   */
  async findByUsername(username) {
    const result = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    return result.rows[0] || null;
  },
  
  /**
   * Find a user by ID
   * @param {Number} id - User ID
   * @returns {Object|null} User object or null if not found
   */
  async findById(id) {
    const result = await db.query(
      'SELECT id, username, email, first_name, last_name, bio, postal_code, avatar_url, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    
    return result.rows[0] || null;
  },
  
  /**
   * Check if password matches for a user
   * @param {String} password - Plain text password to check
   * @param {String} hashedPassword - Hashed password from database
   * @returns {Boolean} True if password matches, false otherwise
   */
  async comparePassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
  }
};

module.exports = userModel;