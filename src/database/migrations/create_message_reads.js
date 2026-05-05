const db = require("../../config/database");

const createMessageReads = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS message_reads (
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    INT    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, user_id)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_message_reads_message_id
        ON message_reads (message_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_message_reads_user_id
        ON message_reads (user_id)
    `);
    await db.query(`
      INSERT INTO message_reads (message_id, user_id, read_at)
      SELECT m.id, tm.user_id, m.read_at
      FROM messages m
      JOIN team_members tm
        ON tm.team_id = m.team_id
       AND tm.user_id != m.sender_id
      WHERE m.team_id IS NOT NULL
        AND m.read_at IS NOT NULL
      ON CONFLICT (message_id, user_id) DO NOTHING
    `);
    console.log("message_reads table created (or already exists)");
  } catch (error) {
    console.error("Error creating message_reads table:", error);
    throw error;
  }
};

module.exports = createMessageReads;
