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

      // Insert user with all location fields
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
          city,
          country,
          latitude,
          longitude,
          avatar_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
        RETURNING id, username, email, first_name, last_name, postal_code, city, country, latitude, longitude, avatar_url
      `,
        [
          userDetails.username,
          userDetails.email,
          await bcrypt.hash(userDetails.password, 10), // Hash password
          userDetails.first_name || null,
          userDetails.last_name || null,
          userDetails.bio || null,
          userDetails.postal_code || null,
          userDetails.city || null,
          userDetails.country || null,
          userDetails.latitude || null,
          userDetails.longitude || null,
          userDetails.avatar_url || null,
        ],
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
            ],
          ),
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
   * @param {String} username - User username
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
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows[0] || null;
  },

  /**
   * Verify a password against a hash
   * @param {String} password - Plain text password
   * @param {String} hash - Hashed password
   * @returns {Boolean} True if password matches
   */
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  },

  /**
   * Hash a password
   * @param {String} password - Plain text password
   * @returns {String} Hashed password
   */
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  },

  /**
   * Get user's current location data
   * @param {Number} userId - User ID
   * @returns {Object|null} Location data or null
   */
  async getUserLocation(userId) {
    const result = await db.query(
      "SELECT postal_code, city, country, latitude, longitude FROM users WHERE id = $1",
      [userId],
    );
    return result.rows[0] || null;
  },

  /**
   * Update user's coordinates
   * @param {Number} userId - User ID
   * @param {Number} latitude - Latitude
   * @param {Number} longitude - Longitude
   */
  async updateCoordinates(userId, latitude, longitude) {
    await db.query(
      "UPDATE users SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3",
      [latitude, longitude, userId],
    );
  },
};

module.exports = userModel;
