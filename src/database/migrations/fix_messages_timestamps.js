const db = require("../../config/database");

const fixMessagesTimestamps = async () => {
  try {
    await db.query(`
      ALTER TABLE messages
        ALTER COLUMN sent_at       TYPE TIMESTAMPTZ USING sent_at       AT TIME ZONE 'UTC',
        ALTER COLUMN read_at       TYPE TIMESTAMPTZ USING read_at       AT TIME ZONE 'UTC',
        ALTER COLUMN file_expires_at TYPE TIMESTAMPTZ USING file_expires_at AT TIME ZONE 'UTC',
        ALTER COLUMN file_deleted_at TYPE TIMESTAMPTZ USING file_deleted_at AT TIME ZONE 'UTC',
        ALTER COLUMN deleted_at    TYPE TIMESTAMPTZ USING deleted_at    AT TIME ZONE 'UTC';
    `);
    console.log("Messages timestamp columns converted to TIMESTAMPTZ");
  } catch (error) {
    if (error.message && error.message.includes("does not exist")) {
      console.log(
        "Some columns not found — skipping (table may not have all columns yet)",
      );
    } else {
      throw error;
    }
  }
};

module.exports = fixMessagesTimestamps;
