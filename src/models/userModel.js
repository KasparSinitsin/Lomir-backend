const db = require("../config/database");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;

const userModel = {
  // ==============================
  // CREATE USER
  // ==============================
  async createUser(userData) {
    try {
      const hashedPassword = await this.hashPassword(userData.password);

      const result = await db.query(
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
          state,
          district,
          country,
          latitude,
          longitude,
          avatar_url,
          email_verified,
          is_public,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,FALSE,TRUE,NOW(),NOW())
        RETURNING *
        `,
        [
          userData.username,
          userData.email,
          hashedPassword,
          userData.first_name || null,
          userData.last_name || null,
          userData.bio || null,
          userData.postal_code || null,
          userData.city || null,
          userData.state || null,
          userData.district || null,
          userData.country || null,
          userData.latitude || null,
          userData.longitude || null,
          userData.avatar_url || null,
        ],
      );

      return result.rows[0];
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    }
  },

  // ==============================
  // FIND BY EMAIL (case-insensitive)
  // ==============================
  async findByEmail(email) {
    const result = await db.query(
      `SELECT * FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return result.rows[0];
  },

  // ==============================
  // FIND BY USERNAME (case-insensitive)
  // ==============================
  async findByUsername(username) {
    const result = await db.query(
      `SELECT * FROM users WHERE lower(username) = lower($1)`,
      [username],
    );
    return result.rows[0];
  },

  // ==============================
  // FIND BY ID
  // ==============================
  async findById(id) {
    const result = await db.query(
      `SELECT * FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  },

  // ==============================
  // PASSWORD HASHING
  // ==============================
  async hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  },
};

module.exports = userModel;
