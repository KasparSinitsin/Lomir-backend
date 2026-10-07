const db = require("../../config/database");

/**
 * Gives the 🎉 APPLICANT slot its id, for the rows where a column says who the
 * applicant was:
 *
 *   🎉 <name> has applied successfully …   →   🎉 <id>:<name> has applied …
 *
 * 🔴 **Why.** The slot holds a name and no id, so it goes stale on the first
 * rename, and it breaks PERSPECTIVE: `isViewerPerson` falls back to comparing the
 * stored name with the viewer's CURRENT one, so the applicant, after a rename, is
 * told about herself in the third person. The parser already reads this token
 * (`messageSystemParser.js`, Pattern 3: `parseIdNameToken` on both slots), and the
 * writer has emitted it since BE #351.
 *
 * 🟢 **The id comes from a column, not from the sender and not from a name.** The
 * writer opens a transaction and runs the application UPDATE and the message
 * INSERT inside it, so `NOW()` is shared and `team_applications.reviewed_at`
 * EQUALS `messages.sent_at` for the approval a row announces. The key
 *
 *     ta.team_id = m.team_id AND ta.status = 'approved' AND ta.reviewed_at = m.sent_at
 *
 * therefore selects one application, and its `applicant_id` is the applicant.
 * The sender is NOT a route: `deletion-audit/24` found it is the applicant in only
 * 203 of 289 rows and the approver in 65.
 *
 * ⚠️ **The premise, tested rather than assumed** (`STATUS.md` habit 11):
 *   - `deletion-audit/25` E1: 190 exact, 0 near-miss on the 193 rows whose link
 *     was already certain.
 *   - `deletion-audit/34`: the key resolved **277 of 289** rows to exactly one
 *     application, 0 ambiguous, 0 near-miss; the applicant is the sender in 213
 *     (the same 213 BE #353 corrected — an independent corroboration), the
 *     approver in 0, and missing in 0.
 *
 * ✅ **Dry run: `deletion-audit/35`, against production 2026-10-07.** 289 rows,
 * **276 eligible**; dropped as predicted (12 not resolved, 1 name conflict, 0
 * missing, 0 approver, 0 out of scope); 13 repair a stale name; for all 276 the
 * new content differs only in the first slot (taking the token out reproduces the
 * old content exactly); and 0 bare rows exist after the cutoff.
 *
 * THE RULE. A row is rewritten only if ALL hold:
 *   1  it is a team 🎉 row whose applicant slot has no token, sent before
 *      2026-10-06 (the writer tokenises the slot since #351)
 *   2  exactly ONE approved application of that team has reviewed_at = sent_at
 *   3  that application's applicant still exists
 *   4  the applicant is not the approver named in the row
 *   5  the stored name EITHER equals the applicant's current name OR matches no
 *      living user. A name that belongs to a DIFFERENT living user is left alone.
 *
 * 🔴 **The APPROVER slot is never touched.** That is BE #352/#353's business, and
 * the three migrations are independent: their guards read the approver slot only.
 *
 * 🔴 **The date cut exists because this migration re-runs** on every
 * `npm run migrate`, and the key is exact, so a row typed by a user cannot match
 * — but the cut keeps the population closed and costs nothing.
 *
 * 🟢 **Idempotent by guard.** A rewritten row has a token, so a second run finds
 * nothing.
 *
 * 🔴 **Verified by itself.** `index.js` catches a module's error and does NOT
 * rethrow, so the runner's success message is not evidence. This module owns its
 * transaction, re-runs the rule after writing and rolls back unless nothing is
 * left, and refuses a count above the 289 that can exist. The honest check is
 * still to re-run `deletion-audit/35`: `eligible` must then be 0.
 */

const EXPECTED_ROWS = 276; // `deletion-audit/35`
const MAX_ROWS = 289; // the whole population in `34`; a larger count is a bug

// ⚠️ `\\s` in the JS source: in a template literal `\s` is just `s`, the
// backslash being dropped for an unknown escape — the SQL would then match a
// literal "s". The same trap is documented in #352, #353 and the other migrations.
const PLAN_CTE = `
  WITH un AS (
    SELECT u.id,
           btrim(regexp_replace(array_to_string(array_remove(
             ARRAY[nullif(u.first_name, ''), nullif(u.last_name, '')], NULL), ' '),
             '\\s+', ' ', 'g')) AS name
    FROM users u
  ),
  base AS (
    SELECT m.id, m.content, m.team_id, m.sent_at,
           substring(m.content from '^🎉 (.+?) has applied successfully to your team') AS slot,
           substring(m.content from 'added as a team member by ([0-9]+):')::bigint AS approver_id
    FROM messages m
    WHERE m.team_id IS NOT NULL
      AND m.sent_at < '2026-10-06'
      AND m.content ~ '^🎉 .+ has applied successfully to your team and has been added as a team member by .+\\. Say hello to them!'
      AND NOT (m.content ~ '^🎉 [0-9]+\\s*:')
  ),
  resolved AS (
    SELECT b.*, count(ta.id) AS n, min(ta.applicant_id) AS applicant_id
    FROM base b
    LEFT JOIN team_applications ta
           ON ta.team_id = b.team_id
          AND ta.status = 'approved'
          AND ta.reviewed_at = b.sent_at
    GROUP BY b.id, b.content, b.team_id, b.sent_at, b.slot, b.approver_id
  ),
  plan AS (
    SELECT r.id, r.content,
           regexp_replace(r.content, '^🎉 ', '🎉 ' || r.applicant_id::text || ':') AS new_content
    FROM resolved r
    WHERE r.n = 1
      AND r.applicant_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM un WHERE un.id = r.applicant_id)
      AND r.applicant_id IS DISTINCT FROM r.approver_id
      AND (btrim(regexp_replace(r.slot, '\\s+', ' ', 'g'))
             = (SELECT un.name FROM un WHERE un.id = r.applicant_id)
           OR (SELECT count(*) FROM un
                WHERE un.name = btrim(regexp_replace(r.slot, '\\s+', ' ', 'g'))) = 0)
  )
`;

const UPDATE_SQL = `${PLAN_CTE}
  UPDATE messages m
  SET content = plan.new_content
  FROM plan
  WHERE m.id = plan.id
    AND m.content = plan.content
`;

// The same plan, counted AFTER the update: every eligible row has a token by
// then and has left the population, so a non-zero count means the statement and
// its own rule disagree.
const REMAINING_SQL = `${PLAN_CTE}
  SELECT count(*)::int AS remaining FROM plan
`;

const addApplicantIdToApplauseEvents = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(UPDATE_SQL);

    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `applause applicant id migration would rewrite ${result.rowCount} rows, ` +
          `but only ${MAX_ROWS} can exist — rolled back. The rule is too wide.`,
      );
    }

    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `applause applicant id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `applause applicant id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "applause applicant id migration: ⚠️ the count differs from the dry run — " +
          "re-run deletion-audit/35 and read why before trusting it.",
      );
    }
    console.log(
      "applause applicant id migration: VERIFY with deletion-audit/35 — `eligible` " +
        "must now be 0. The migration runner's success message is not " +
        "evidence; it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error adding applicant ids to applause events (rolled back):",
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addApplicantIdToApplauseEvents;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
