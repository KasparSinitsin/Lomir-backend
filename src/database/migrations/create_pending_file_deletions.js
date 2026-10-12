const db = require("../../config/database");

/**
 * Creates `pending_file_deletions`, the list of ImageKit files that still have to
 * be deleted (STATUS item 59).
 *
 * 🔴 **Why a table.** A file is deleted from ImageKit AFTER its database row is
 * gone, so a failed call used to leave the file behind with nothing pointing at
 * it any more. The reference is now written into this table in the SAME
 * transaction that deletes the row, tried right after the commit, and retried by
 * the daily cleanup and at every server start until ImageKit confirms the file is
 * gone. Memory would not do: Render restarts the process.
 *
 * 🟢 **Only the file reference, never a person.** No user id, no team id, no
 * name: a row says which file to delete, where the request came from (`source`)
 * and how the last try went. A row is deleted as soon as its file is gone.
 * `last_error` is written from the error text WITHOUT the file name.
 *
 * 🟢 **Additive, empty, idempotent** (`IF NOT EXISTS`), so it may run before the
 * frontend release with `npm run migrate:one`. It must exist before code that
 * writes to it runs anywhere: local development uses the live database, and an
 * account or team deletion that cannot write here rolls back as a whole.
 */

const TABLE = "pending_file_deletions";

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS pending_file_deletions (
    id              BIGSERIAL PRIMARY KEY,
    file_url        TEXT,
    file_id         TEXT,
    source          TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ,
    CONSTRAINT pending_file_deletions_has_reference
      CHECK (file_url IS NOT NULL OR file_id IS NOT NULL),
    CONSTRAINT pending_file_deletions_source_format
      CHECK (source ~ '^[a-z_]+$')
  );
`;

const createPendingFileDeletions = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(CREATE_SQL);

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1`,
      [TABLE],
    );
    if (rows[0].n !== 1) {
      throw new Error(`${TABLE} does not exist after the run — rolled back.`);
    }

    await client.query("COMMIT");
    console.log(`${TABLE} exists.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Error creating ${TABLE} (rolled back):`, error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = createPendingFileDeletions;
module.exports.TABLE = TABLE;
