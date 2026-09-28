const db = require("../../config/database");

/**
 * `password_reset_expires` and `verification_token_expires` were
 * `timestamp without time zone`, and that made the token lifetime depend on the
 * backend process's timezone rather than on the TTL in the code.
 *
 * `forgotPassword` writes `new Date(Date.now() + 60 * 60 * 1000)`. node-postgres
 * serialises that Date with the backend process's local offset, and a naive
 * column keeps the wall-clock part and discards the offset. `resetPassword`
 * then compares it against `NOW()` in a session whose TimeZone is GMT. On a
 * backend running in CEST a token issued at 17:42:28 UTC was stored as
 * 20:42:28 and lived three hours instead of one; west of UTC the stored wall
 * clock is behind `NOW()`, so a reset token is expired the moment it is issued
 * and password reset stops working altogether. Render runs UTC, so production
 * worked by accident rather than by construction.
 *
 * `email_change_token_expires` was already `TIMESTAMPTZ`
 * (`add_email_change_fields_to_users.js`) and is the precedent followed here.
 *
 * Existing values are interpreted as UTC, which is the timezone of the server
 * that wrote the rows in production (Render). ⚠️ A row written by a backend
 * running in another zone — a developer machine against the shared database —
 * is off by that machine's offset. Both tokens live at most 24 hours, so any
 * row old enough to matter is expired under either reading.
 */
const fixTokenExpiryTimestamps = async () => {
  const columns = ["password_reset_expires", "verification_token_expires"];

  for (const column of columns) {
    const { rows } = await db.query(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = $1`,
      [column],
    );

    if (rows.length === 0) {
      console.log(`users.${column} not found — skipping`);
      continue;
    }

    // Guard the conversion on the current type. `x AT TIME ZONE 'UTC'` reads a
    // naive timestamp as UTC, but applied to a value that is already
    // TIMESTAMPTZ it returns a naive wall clock instead, which would be shifted
    // again by the session timezone on the way back in. Running this migration
    // twice must not move the data.
    if (rows[0].data_type !== "timestamp without time zone") {
      console.log(
        `users.${column} is already ${rows[0].data_type} — skipping`,
      );
      continue;
    }

    await db.query(
      `ALTER TABLE users
         ALTER COLUMN ${column} TYPE TIMESTAMPTZ
         USING ${column} AT TIME ZONE 'UTC'`,
    );
    console.log(`users.${column} converted to TIMESTAMPTZ`);
  }
};

module.exports = fixTokenExpiryTimestamps;
