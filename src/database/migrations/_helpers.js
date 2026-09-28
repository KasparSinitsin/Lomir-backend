const db = require("../../config/database");

// Not a migration step — a helper the steps share. The leading underscore keeps
// it distinguishable from the files in this folder that index.js runs.

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Convert naive `timestamp` columns to `TIMESTAMPTZ`, reading the stored
 * wall-clock values as `assumeZone`.
 *
 * ⚠️ **Why this cannot be a plain `ALTER COLUMN … TYPE`.** `x AT TIME ZONE 'UTC'`
 * means two different things depending on what `x` already is. On a naive
 * `timestamp` it *attaches* UTC and yields `timestamptz` — what a conversion
 * wants. On a value that is **already** `timestamptz` it does the opposite: it
 * strips the zone and yields a naive wall clock, which assigning back to a
 * `timestamptz` column then re-interprets using the **session** timezone. Run
 * such a statement twice and the second run silently shifts every value by the
 * session's offset.
 *
 * `fix_messages_timestamps.js` had exactly that shape for five `messages`
 * columns and runs on every `npm run migrate`. It stayed harmless only because
 * the session is GMT and Neon's default is UTC — by circumstance, not by
 * construction. Found 2026-09-28 while writing `fix_token_expiry_timestamps.js`,
 * which is where this guard came from.
 *
 * So: read the current type first, convert only the columns that are still
 * naive, and leave everything else alone. A column that does not exist is
 * skipped rather than an error, because these migrations also run against
 * databases that predate the column.
 *
 * The naive columns are converted in **one** `ALTER TABLE`, so the table is
 * rewritten once rather than once per column.
 *
 * Identifiers are interpolated, not bound — Postgres does not take parameters
 * for them. They come from constants in the migration files, never from a
 * request, and are checked against `SAFE_IDENTIFIER` so a typo fails loudly here
 * instead of becoming SQL.
 */
const convertColumnsToTimestamptz = async (
  table,
  columns,
  { assumeZone = "UTC" } = {},
) => {
  for (const identifier of [table, ...columns, assumeZone]) {
    if (typeof identifier !== "string") {
      throw new Error(`Migration helper: expected a string, got ${typeof identifier}`);
    }
  }
  for (const identifier of [table, ...columns]) {
    if (!SAFE_IDENTIFIER.test(identifier)) {
      throw new Error(`Migration helper: unsafe identifier "${identifier}"`);
    }
  }

  const { rows } = await db.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = $1 AND column_name = ANY($2::text[])`,
    [table, columns],
  );

  const typeByColumn = new Map(rows.map((r) => [r.column_name, r.data_type]));
  const naive = columns.filter(
    (c) => typeByColumn.get(c) === "timestamp without time zone",
  );
  const missing = columns.filter((c) => !typeByColumn.has(c));
  const alreadyDone = columns.filter(
    (c) => typeByColumn.get(c) === "timestamp with time zone",
  );

  if (missing.length > 0) {
    console.log(
      `${table}: ${missing.join(", ")} not found — skipping (older schema)`,
    );
  }
  if (alreadyDone.length > 0) {
    console.log(
      `${table}: ${alreadyDone.join(", ")} already TIMESTAMPTZ — skipping`,
    );
  }
  if (naive.length === 0) {
    return { converted: [], alreadyDone, missing };
  }

  const clauses = naive
    .map(
      (c) =>
        `ALTER COLUMN ${c} TYPE TIMESTAMPTZ USING ${c} AT TIME ZONE '${assumeZone}'`,
    )
    .join(",\n         ");

  await db.query(`ALTER TABLE ${table}\n         ${clauses}`);
  console.log(
    `${table}: ${naive.join(", ")} converted to TIMESTAMPTZ (read as ${assumeZone})`,
  );

  return { converted: naive, alreadyDone, missing };
};

module.exports = { convertColumnsToTimestamptz };
