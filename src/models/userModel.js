const db = require("../config/database");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;

const CREATED_USER_FIELDS = `
  id,
  username,
  email,
  first_name,
  last_name,
  bio,
  postal_code,
  city,
  state,
  district,
  country,
  avatar_url,
  accepted_terms_at,
  accepted_privacy_at,
  confirmed_age_16_at,
  accepted_terms_version,
  accepted_privacy_version,
  confirmed_age_16_version,
  email_verified,
  is_public,
  is_synthetic,
  created_at,
  updated_at
`;

const AUTH_USER_FIELDS = `
  id,
  username,
  email,
  password_hash,
  email_verified,
  first_name,
  last_name,
  bio,
  postal_code,
  city,
  state,
  district,
  country,
  avatar_url,
  accepted_terms_at,
  accepted_privacy_at,
  confirmed_age_16_at,
  accepted_terms_version,
  accepted_privacy_version,
  confirmed_age_16_version,
  is_public,
  is_synthetic,
  created_at,
  updated_at
`;

const CURRENT_USER_FIELDS = `
  id,
  username,
  email,
  first_name,
  last_name,
  bio,
  postal_code,
  city,
  state,
  district,
  country,
  avatar_url,
  accepted_terms_at,
  accepted_privacy_at,
  confirmed_age_16_at,
  accepted_terms_version,
  accepted_privacy_version,
  confirmed_age_16_version,
  is_public,
  is_synthetic,
  created_at,
  updated_at
`;

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
          accepted_terms_at,
          accepted_privacy_at,
          confirmed_age_16_at,
          accepted_terms_version,
          accepted_privacy_version,
          confirmed_age_16_version,
          email_verified,
          is_public,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),NOW(),$15,$16,$17,FALSE,FALSE,NOW(),NOW())
        RETURNING ${CREATED_USER_FIELDS}
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
          userData.accepted_terms_version,
          userData.accepted_privacy_version,
          userData.confirmed_age_16_version,
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
      `SELECT ${AUTH_USER_FIELDS}
       FROM users
       WHERE lower(email) = lower($1)`,
      [email],
    );
    return result.rows[0];
  },

  // ==============================
  // FIND BY USERNAME (case-insensitive)
  // ==============================
  async findByUsername(username) {
    const result = await db.query(
      `SELECT id, username
       FROM users
       WHERE lower(username) = lower($1)`,
      [username],
    );
    return result.rows[0];
  },

  // ==============================
  // FIND BY ID
  // ==============================
  async findById(id) {
    const result = await db.query(
      `SELECT ${CURRENT_USER_FIELDS}
       FROM users
       WHERE id = $1`,
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

  // ==============================
  // USER BLOCKS
  // ==============================
  async blockUser(blockerId, blockedId) {
    await db.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId],
    );
  },

  async unblockUser(blockerId, blockedId) {
    await db.query(
      `DELETE FROM user_blocks
       WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, blockedId],
    );
  },

  // Users that `blockerId` has blocked (these are the ones they can unblock),
  // returned with the card fields the blocklist UI needs, newest first.
  async getBlockedUsers(blockerId) {
    const result = await db.query(
      `SELECT u.id, u.username, u.first_name, u.last_name, u.avatar_url,
              u.city, u.country, u.is_public, u.is_synthetic, ub.created_at,
              COALESCE((
                SELECT json_agg(t.name ORDER BY t.name ASC)
                FROM teams t
                JOIN team_members tm1 ON t.id = tm1.team_id AND tm1.user_id = ub.blocker_id
                JOIN team_members tm2 ON t.id = tm2.team_id AND tm2.user_id = ub.blocked_id
                WHERE t.archived_at IS NULL
              ), '[]'::json) AS shared_teams
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = $1
       ORDER BY ub.created_at DESC`,
      [blockerId],
    );
    return result.rows;
  },

  // Every user id in a block relationship with `userId` in EITHER direction —
  // used to mutually hide/anonymize profiles across the app.
  async getBlockRelationshipIds(userId) {
    const result = await db.query(
      `SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = $1
       UNION
       SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = $1`,
      [userId],
    );
    return result.rows.map((row) => row.id);
  },

  // True when either user has blocked the other.
  async isBlockedBetween(a, b) {
    const result = await db.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [a, b],
    );
    return result.rows.length > 0;
  },
};

module.exports = userModel;
