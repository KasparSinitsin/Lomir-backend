const db = require("../../config/database");

const addPasswordChangedAtToUsers = async () => {
  try {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ
    `);

    console.log(
      "password_changed_at column added to users (or already exists)",
    );
  } catch (error) {
    console.error("Error adding password_changed_at to users:", error);
    throw error;
  }
};

module.exports = addPasswordChangedAtToUsers;
