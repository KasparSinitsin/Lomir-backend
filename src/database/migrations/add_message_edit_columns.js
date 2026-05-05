const db = require("../../config/database");

const addMessageEditColumns = async () => {
  try {
    await db.query(`
      ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS edited_by INT REFERENCES users(id) ON DELETE SET NULL
    `);
    console.log("Message edit columns added (or already exist)");
  } catch (error) {
    console.error("Error adding message edit columns:", error);
    throw error;
  }
};

module.exports = addMessageEditColumns;
