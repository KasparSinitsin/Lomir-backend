const cron = require("node-cron");
const db = require("../config/database");

const BUFFER_HOURS = 1;
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
};

const purgeExpiredUnverifiedAccounts = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const expiredUsersResult = await client.query(
      `
      SELECT id
      FROM users
      WHERE email_verified = FALSE
        AND verification_token_expires IS NOT NULL
        AND verification_token_expires < NOW() - INTERVAL '${BUFFER_HOURS} hours'
      `,
    );

    const expiredUserIds = expiredUsersResult.rows.map((row) => Number(row.id));

    if (expiredUserIds.length === 0) {
      await client.query("COMMIT");
      return { deleted: 0, accounts: [] };
    }

    await client.query(
      `UPDATE teams SET owner_id = NULL WHERE owner_id = ANY($1::int[])`,
      [expiredUserIds],
    );
    await client.query(
      `UPDATE team_vacant_roles SET created_by = NULL WHERE created_by = ANY($1::int[])`,
      [expiredUserIds],
    );
    await client.query(
      `UPDATE team_vacant_roles SET filled_by = NULL WHERE filled_by = ANY($1::int[])`,
      [expiredUserIds],
    );
    await client.query(
      `UPDATE team_applications SET reviewed_by = NULL WHERE reviewed_by = ANY($1::int[])`,
      [expiredUserIds],
    );
    await client.query(
      `UPDATE user_badges SET awarded_by = NULL WHERE awarded_by = ANY($1::int[])`,
      [expiredUserIds],
    );
    await client.query(
      `UPDATE tags SET created_by = NULL WHERE created_by = ANY($1::int[])`,
      [expiredUserIds],
    );

    const result = await client.query(
      `
      DELETE FROM users
      WHERE id = ANY($1::int[])
      RETURNING id, created_at
      `,
      [expiredUserIds],
    );

    await client.query("COMMIT");

    return {
      deleted: result.rowCount || 0,
      accounts: result.rows.map((row) => ({
        id: row.id,
        created: row.created_at,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const logCleanupResult = ({ deleted, accounts }) => {
  if (deleted > 0) {
    debugLog(`[Cleanup] Deleted ${deleted} unverified account(s):`, accounts);
  } else {
    debugLog("[Cleanup] No expired unverified accounts to delete.");
  }
};

const cleanupUnverifiedAccounts = () => {
  cron.schedule("0 */6 * * *", async () => {
    try {
      const result = await purgeExpiredUnverifiedAccounts();
      logCleanupResult(result);
    } catch (error) {
      console.error("[Cleanup] Error cleaning up unverified accounts:", error);
    }
  });

  debugLog("[Cleanup] Unverified account cleanup job scheduled (every 6 hours).");
};

module.exports = cleanupUnverifiedAccounts;
module.exports.purgeExpiredUnverifiedAccounts = purgeExpiredUnverifiedAccounts;
module.exports.BUFFER_HOURS = BUFFER_HOURS;
