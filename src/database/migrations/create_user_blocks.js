const db = require("../../config/database");

const createUserBlocks = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id),
        CHECK (blocker_id <> blocked_id)
      )
    `);
    // Reverse lookups ("who has blocked me?") hit blocked_id, which is not the
    // leading column of the primary key, so it needs its own index.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id
        ON user_blocks (blocked_id)
    `);
    console.log("user_blocks table created (or already exists)");
  } catch (error) {
    console.error("Error creating user_blocks table:", error);
    throw error;
  }
};

module.exports = createUserBlocks;
