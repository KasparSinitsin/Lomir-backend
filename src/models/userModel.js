const bcrypt = require("bcrypt");
const db = require("../config/database");

const userModel = {
  /**
   * Create a new user in the database
   * @param {Object} user - User data (username, email, password, etc.)
   * @returns {Object} Created user object
   */
  async createUser(userData) {
    const { tags, ...userDetails } = userData;

    const client = await db.pool.connect();

    try {
      // Start a database transaction
      await client.query("BEGIN");

      // Insert user
      const userResult = await client.query(
        `
        INSERT INTO users (
          username, 
          email, 
          password_hash, 
          first_name, 
          last_name, 
          bio, 
          postal_code, 
          avatar_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING id, username, email, first_name, last_name, avatar_url
      `,
        [
          userDetails.username,
          userDetails.email,
          await bcrypt.hash(userDetails.password, 10), // Hash password
          userDetails.first_name,
          userDetails.last_name,
          userDetails.bio,
          userDetails.postal_code,
          userDetails.avatar_url,
        ]
      );

      const userId = userResult.rows[0].id;

      // Insert user tags if present
      if (tags && tags.length > 0) {
        const tagInserts = tags.map((tag) =>
          client.query(
            `
            INSERT INTO user_tags (
              user_id, 
              tag_id, 
              experience_level, 
              interest_level
            ) VALUES ($1, $2, $3, $4)
          `,
            [
              userId,
              tag.tag_id,
              tag.experience_level || 2,
              tag.interest_level || 3,
            ]
          )
        );

        await Promise.all(tagInserts);
      }

      // Commit the transaction
      await client.query("COMMIT");

      // Return the user details
      return userResult.rows[0];
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query("ROLLBACK");
      console.error("Error creating user:", error);
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  },

  /**
   * Find a user by email
   * @param {String} email - User email
   * @returns {Object|null} User object or null if not found
   */
  async findByEmail(email) {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    return result.rows[0] || null;
  },

  /**
   * Find a user by username
   * @param {String} username - Username
   * @returns {Object|null} User object or null if not found
   */
  async findByUsername(username) {
    const result = await db.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);

    return result.rows[0] || null;
  },

  /**
   * Find a user by ID
   * @param {Number} id - User ID
   * @returns {Object|null} User object or null if not found
   */
  async findById(id) {
    const result = await db.query(
      "SELECT id, username, email, first_name, last_name, bio, postal_code, city, avatar_url, is_public, created_at, updated_at FROM users WHERE id = $1",
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
  },
};

module.exports = userModel;
