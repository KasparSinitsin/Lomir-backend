const db = require("../../config/database");

const addReplyToId = async () => {
  try {
    await db.query(`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);
    `);
    console.log("reply_to_id column and index added (or already exist)");
  } catch (error) {
    console.error("Error adding reply_to_id:", error);
    throw error;
  }
};

module.exports = addReplyToId;
