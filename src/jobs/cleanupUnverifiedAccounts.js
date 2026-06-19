const cron = require("node-cron");
const db = require("../config/database");

const BUFFER_HOURS = 1;
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
};

const cleanupUnverifiedAccounts = () => {
  cron.schedule("0 */6 * * *", async () => {
    try {
      const result = await db.query(
        `
        WITH expired_users AS (
          SELECT id FROM users
          WHERE email_verified = FALSE
            AND verification_token_expires IS NOT NULL
            AND verification_token_expires < NOW() - INTERVAL '${BUFFER_HOURS} hours'
        ),
        deleted_tags AS (
          DELETE FROM user_tags
          WHERE user_id IN (SELECT id FROM expired_users)
        )
        DELETE FROM users
        WHERE id IN (SELECT id FROM expired_users)
        RETURNING id, email, created_at
        `,
      );

      const count = result.rowCount || 0;
      if (count > 0) {
        debugLog(
          `[Cleanup] Deleted ${count} unverified account(s):`,
          result.rows.map((r) => ({ id: r.id, created: r.created_at })),
        );
      } else {
        debugLog("[Cleanup] No expired unverified accounts to delete.");
      }
    } catch (error) {
      console.error("[Cleanup] Error cleaning up unverified accounts:", error);
    }
  });

  debugLog("[Cleanup] Unverified account cleanup job scheduled (every 6 hours).");
};

module.exports = cleanupUnverifiedAccounts;
