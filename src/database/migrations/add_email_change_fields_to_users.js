const db = require("../../config/database");

const addEmailChangeFieldsToUsers = async () => {
  try {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS pending_email TEXT,
        ADD COLUMN IF NOT EXISTS email_change_token TEXT,
        ADD COLUMN IF NOT EXISTS email_change_token_expires TIMESTAMPTZ
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS users_email_change_token_idx
      ON users (email_change_token)
      WHERE email_change_token IS NOT NULL
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS users_pending_email_lower_idx
      ON users (LOWER(pending_email))
      WHERE pending_email IS NOT NULL
    `);

    console.log("Email change fields added to users (or already exist)");
  } catch (error) {
    console.error("Error adding email change fields to users:", error);
    throw error;
  }
};

module.exports = addEmailChangeFieldsToUsers;
