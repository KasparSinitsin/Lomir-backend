const { convertColumnsToTimestamptz } = require("./_helpers");

/**
 * The chat's timestamps as `TIMESTAMPTZ`, so the pg driver never applies a
 * local-timezone shift when it builds a JavaScript `Date`.
 *
 * ⚠️ **This used to be one unguarded `ALTER TABLE` and was a loaded gun.** It
 * converted all five columns on every `npm run migrate`, including runs where
 * they were already `TIMESTAMPTZ` — and on an already-converted value
 * `AT TIME ZONE 'UTC'` strips the zone instead of attaching it, so the value
 * comes back through the session timezone. It never fired because the session is
 * GMT. The day a session or role timezone is set, it would have shifted the whole
 * chat history: every message's `sent_at`, every read receipt, every file expiry.
 * The guard now lives in `_helpers.js`; the reasoning is there.
 */
const fixMessagesTimestamps = async () => {
  await convertColumnsToTimestamptz("messages", [
    "sent_at",
    "read_at",
    "file_expires_at",
    "file_deleted_at",
    "deleted_at",
  ]);
};

module.exports = fixMessagesTimestamps;
