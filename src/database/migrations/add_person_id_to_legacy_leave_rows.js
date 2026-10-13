const db = require("../../config/database");

/**
 * Rewrites the 16 legacy `🚪 X has left the team.` team messages into
 * `🚪 MEMBER_LEFT:<id>:X`, the format the writer has emitted since 2026-01-14.
 *
 * 🔴 **Why.** The legacy line holds a name and no id, so it goes stale on the
 * first rename, and it breaks PERSPECTIVE (`isViewerPerson` falls back to
 * comparing the stored name with the viewer's CURRENT one). The parser already
 * reads the target (`messageSystemParser.js`, Pattern 5A:
 * `^(?:🚪\s*)?MEMBER_LEFT:(\d+):(.+)$`), so no frontend change is needed.
 *
 * 🟢 **The id needs no name match.** The legacy writer, checked at the commit
 * before the tokens (2026-01-13), inserted `[memberId, teamId, leaveMessage]` in
 * BOTH of its branches, so the SENDER of the row is the person it names.
 *
 * ⚠️ **The premise has no persisted second source** — a membership row is
 * deleted when somebody leaves. Its evidence is the writer, plus the data:
 * `deletion-audit/28` section C found 8 of the 16 equal the sender's CURRENT
 * name, and section E that none of the other 8 matches ANY other living user.
 * A premise stated in a header and never run as a query is what BE #352 was
 * (`STATUS.md` habit 11); `deletion-audit/33` runs it.
 *
 * ✅ **Dry run: `deletion-audit/33`, against production 2026-10-07.** 16 rows, 16
 * eligible, 0 dropped, 8 repair a stale name, and the parser's own pattern reads
 * all 16 back with the sender as the id and the stored name kept.
 *
 * THE RULE. A row is rewritten only if ALL hold:
 *   1  it is a TEAM message (`team_id IS NOT NULL`) with exactly the legacy shape
 *      and no token, sent before 2026-01-15
 *   2  `sender_id` is set
 *   3  the stored name EITHER equals the sender's current name OR matches no
 *      living user. A name that matches a DIFFERENT living user is left alone.
 *
 * 🔴 **The date cut exists because this migration re-runs.** `index.js` runs every
 * migration on every `npm run migrate`. Without `sent_at < 2026-01-15`, a user who
 * later TYPES `🚪 Zoe has left the team.` would be rewritten into a system message
 * naming Zoe, under the typist's id. The writer stopped emitting the shape on
 * 2026-01-14, so no genuine legacy row can be newer. `33` section E checks that
 * all 16 lie before the cut.
 *
 * 🟢 **Idempotent by guard.** A rewritten row no longer has the legacy shape, so a
 * second run finds nothing.
 *
 * 🔴 **Verified by itself.** `index.js` catches a module's error and does NOT
 * rethrow, so the runner's success message is not evidence. This module owns its
 * transaction, re-runs the rule after writing and rolls back unless nothing is
 * left, and refuses a count above the 16 that can exist. The honest check is still
 * to re-run `deletion-audit/33`: `eligible` must then be 0.
 */

const EXPECTED_ROWS = 16; // `deletion-audit/33`
const MAX_ROWS = 16; // the whole population in `28`; a larger count is a bug

// ⚠️ `\\s` in the JS source: in a template literal `\s` is just `s`, the
// backslash being dropped for an unknown escape — the SQL would then match a
// literal "s". The same trap is documented in #352, #353 and the marker migration.
const NAME = `substring(m.content from '^🚪 (.+) has left the team\\.$')`;
const NORMALISED = `btrim(regexp_replace(${NAME}, '\\s+', ' ', 'g'))`;

const ELIGIBLE = `
  m.team_id IS NOT NULL
  AND m.sender_id IS NOT NULL
  AND m.sent_at < '2026-01-15'
  AND m.content ~ '^🚪 .+ has left the team\\.$'
  AND (${NORMALISED} = (SELECT un.name FROM un WHERE un.id = m.sender_id)
       OR (SELECT count(*) FROM un WHERE un.name = ${NORMALISED}) = 0)
`;

const UN_CTE = `
  WITH un AS (
    SELECT u.id,
           btrim(regexp_replace(array_to_string(array_remove(
             ARRAY[nullif(u.first_name, ''), nullif(u.last_name, '')], NULL), ' '),
             '\\s+', ' ', 'g')) AS name
    FROM users u
  )
`;

const UPDATE_SQL = `${UN_CTE}
  UPDATE messages m
  SET content = '🚪 MEMBER_LEFT:' || m.sender_id::text || ':' || ${NAME}
  WHERE ${ELIGIBLE}
`;

// The same rule, counted AFTER the update: every eligible row has lost the legacy
// shape by then, so a non-zero count means the statement and its rule disagree.
const REMAINING_SQL = `${UN_CTE}
  SELECT count(*)::int AS remaining FROM messages m WHERE ${ELIGIBLE}
`;

const addPersonIdToLegacyLeaveRows = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(UPDATE_SQL);

    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `legacy leave id migration would rewrite ${result.rowCount} rows, ` +
          `but only ${MAX_ROWS} can exist — rolled back. The rule is too wide.`,
      );
    }

    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `legacy leave id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `legacy leave id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "legacy leave id migration: ⚠️ the count differs from the dry run — " +
          "re-run deletion-audit/33 and read why before trusting it.",
      );
    }
    console.log(
      "legacy leave id migration: VERIFY with deletion-audit/33 — `eligible` " +
        "must now be 0. The migration runner's success message is not " +
        "evidence; it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error adding person ids to legacy leave rows (rolled back):",
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addPersonIdToLegacyLeaveRows;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
