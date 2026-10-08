const db = require("../../config/database");

/**
 * Gives the applicant of the legacy team message
 *
 *   <name>'s application for <role> was approved
 *
 * its id, by prepending `<id>:` to the name:
 *
 *   <id>:<name>'s application for <role> was approved
 *
 * 🔴 **Why.** The slot holds a name and no id, so it goes stale on the first
 * rename (a chat search for the old spelling still finds it) and it breaks
 * PERSPECTIVE: `isViewerPerson` falls back to comparing the stored name with the
 * viewer's CURRENT one. The parser already reads the token (Pattern 4A runs
 * `parseIdNameToken` on slot 1), so no frontend change is needed.
 *
 * ⚠️ **These are the "22 unprefixed" rows** that Step 3 deferred on 2026-10-07 until
 * Step 4 offered a better source (`STATUS.md`). No backend writer for the sentence
 * exists any more, so who the sender is rests on data, and was therefore tested
 * against a persisted second source rather than assumed (habit 11):
 *
 *   - `deletion-audit/36`: 22 rows, all team messages, all without an id.
 *   - `deletion-audit/37`: for the 21 with a sender, the sender has an approved
 *     application to that team in all 21, and `reviewed_at` EQUALS `sent_at`
 *     exactly in 20 — the same shared-transaction key as the 🎉 migration.
 *   - **The sender premise alone would have been WRONG for one row**: `38` shows
 *     the application that the message announces belongs to somebody other than
 *     the sender. That is the second source earning its keep.
 *
 * 🟢 **The id comes from the application, and the sender must AGREE.** The key
 *
 *     ta.team_id = m.team_id AND ta.status = 'approved' AND ta.reviewed_at = m.sent_at
 *
 * selects the application; its `applicant_id` is the applicant. The row is rewritten
 * only if that applicant is also the row's sender.
 *
 * ✅ **Dry run: `deletion-audit/38`, against production 2026-10-07.** 22 rows, **20
 * eligible** (1 not resolved by the key, 1 where the sender differs from the
 * applicant, 0 missing, 0 name conflict), 1 repairs a stale name, and for all 20 the
 * new content differs only by the prepended id (stripping it reproduces the old
 * content exactly) and the parser's own pattern reads it back.
 *
 * THE RULE. A row is rewritten only if ALL hold:
 *   1  it is a team message of this shape whose slot 1 has no token, sent before
 *      2026-06-01 (the newest of the 22 is 2026-05-15; the writer is gone)
 *   2  exactly ONE approved application of that team has reviewed_at = sent_at
 *   3  that application's applicant is the row's sender
 *   4  the applicant still exists
 *   5  the application was NOT reviewed by its own applicant. Julia, 2026-10-07:
 *      there is no approval of one's own application, so `reviewed_by = applicant_id`
 *      means the key picked the wrong application. The sender is only a technical
 *      attribution here (the system writes these events with the APPLICANT as
 *      sender) and this format names no approver, but the rule is an invariant of
 *      the data and costs one condition.
 *   6  the stored name EITHER equals the applicant's current name OR matches no
 *      living user. A name that belongs to a DIFFERENT living user is left alone.
 *
 * 🟢 **The role slot is untouched**: no role id survives in the sentence, and
 * `parseIdNameToken` reads a bare role name as `{ id: null, name }`.
 *
 * 🔴 **The date cut exists because this migration re-runs** on every
 * `npm run migrate`. The exact key means a message TYPED by a user cannot match, but
 * the cut keeps the population closed and costs nothing.
 *
 * 🟢 **Idempotent by guard.** A rewritten row starts with `<id>:`, so a second run
 * finds nothing.
 *
 * 🔴 **Verified by itself.** `index.js` catches a module's error and does NOT
 * rethrow, so the runner's success message is not evidence. This module owns its
 * transaction, re-runs the rule after writing and rolls back unless nothing is
 * left, and refuses a count above the 22 that can exist. The honest check is still
 * to re-run `deletion-audit/38`: `eligible` must then be 0.
 */

const EXPECTED_ROWS = 20; // `deletion-audit/38`
const MAX_ROWS = 22; // the whole population in `36`; a larger count is a bug

// ⚠️ `\\s`, `\\d` and `\\.` in the JS source: in a template literal `\s` is just `s`,
// the backslash being dropped for an unknown escape — the SQL would then match a
// literal letter. The same trap is documented in #352, #353 and the other migrations.
// The patterns use SQL dollar quoting so the apostrophe needs no doubling.
const SHAPE = `$re$^.+['’]s application for .+ was approved\\.?$$re$`;
const SLOT = `$re$^(.+?)['’]s application for .+ was approved\\.?$$re$`;

const PLAN_CTE = `
  WITH un AS (
    SELECT u.id,
           btrim(regexp_replace(array_to_string(array_remove(
             ARRAY[nullif(u.first_name, ''), nullif(u.last_name, '')], NULL), ' '),
             '\\s+', ' ', 'g')) AS name
    FROM users u
  ),
  base AS (
    SELECT m.id, m.content, m.team_id, m.sender_id, m.sent_at,
           btrim(regexp_replace(substring(m.content from ${SLOT}), '\\s+', ' ', 'g')) AS slot
    FROM messages m
    WHERE m.team_id IS NOT NULL
      AND m.sent_at < '2026-06-01'
      AND m.content ~ ${SHAPE}
      AND NOT (m.content ~ $re$^\\d+\\s*:$re$)
  ),
  resolved AS (
    SELECT b.*, count(ta.id) AS n, min(ta.applicant_id) AS applicant_id,
           bool_or(ta.reviewed_by = ta.applicant_id) AS self_reviewed
    FROM base b
    LEFT JOIN team_applications ta
           ON ta.team_id = b.team_id
          AND ta.status = 'approved'
          AND ta.reviewed_at = b.sent_at
    GROUP BY b.id, b.content, b.team_id, b.sender_id, b.sent_at, b.slot
  ),
  plan AS (
    SELECT r.id, r.content,
           r.applicant_id::text || ':' || r.content AS new_content
    FROM resolved r
    WHERE r.n = 1
      AND r.sender_id IS NOT NULL
      AND r.applicant_id = r.sender_id
      AND NOT coalesce(r.self_reviewed, false)
      AND EXISTS (SELECT 1 FROM un WHERE un.id = r.applicant_id)
      AND (r.slot = (SELECT un.name FROM un WHERE un.id = r.applicant_id)
           OR (SELECT count(*) FROM un WHERE un.name = r.slot) = 0)
  )
`;

const UPDATE_SQL = `${PLAN_CTE}
  UPDATE messages m
  SET content = plan.new_content
  FROM plan
  WHERE m.id = plan.id
    AND m.content = plan.content
`;

// The same plan, counted AFTER the update: every eligible row starts with its id
// by then and has left the population, so a non-zero count means the statement and
// its own rule disagree.
const REMAINING_SQL = `${PLAN_CTE}
  SELECT count(*)::int AS remaining FROM plan
`;

const addApplicantIdToRoleApplicationApprovedRows = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(UPDATE_SQL);

    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `role-application-approved id migration would rewrite ${result.rowCount} ` +
          `rows, but only ${MAX_ROWS} can exist — rolled back. The rule is too wide.`,
      );
    }

    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `role-application-approved id migration left ${rows[0].remaining} ` +
          "eligible rows behind — rolled back. The statement and its rule disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `role-application-approved id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "role-application-approved id migration: ⚠️ the count differs from the " +
          "dry run — re-run deletion-audit/38 and read why before trusting it.",
      );
    }
    console.log(
      "role-application-approved id migration: VERIFY with deletion-audit/38 — " +
        "`eligible` must now be 0. The migration runner's success message is not " +
        "evidence; it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error adding applicant ids to role-application-approved rows (rolled back):",
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addApplicantIdToRoleApplicationApprovedRows;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
