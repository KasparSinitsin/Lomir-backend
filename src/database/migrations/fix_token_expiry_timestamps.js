const { convertColumnsToTimestamptz } = require("./_helpers");

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
 *
 * The guard that makes a second run a no-op is in `_helpers.js`, which this
 * migration's first version introduced and `fix_messages_timestamps.js` now
 * shares.
 */
const fixTokenExpiryTimestamps = async () => {
  await convertColumnsToTimestamptz("users", [
    "password_reset_expires",
    "verification_token_expires",
  ]);
};

module.exports = fixTokenExpiryTimestamps;
