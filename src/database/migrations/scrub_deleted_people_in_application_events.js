const db = require("../../config/database");

/**
 * Replaces the name of a DELETED person in two legacy application events with
 * the placeholder, and ends the #352/#353 churn (STATUS items 22 and 28).
 *
 * 1  🎉 approver. `deletion-audit/53` A: 18 lines whose application says the
 *    sender is the APPLICANT and `reviewed_by IS NULL`. Approval always sets
 *    `reviewed_by` (teamApplicationsController.js:771); only account deletion
 *    nulls it (userDeletionController.js:841). So the approver of these lines is
 *    a deleted account, and its name is still in the text. On every migrate
 *    add_id_tokens_to_prose_events (#352) wrote the applicant's id in front of
 *    that name and fix_wrong_approver_ids_in_applause_events (#353) stripped it
 *    again. With the placeholder in place, #352's new guard skips these lines,
 *    so the churn stops.
 *
 *      … added as a team member by <name>. Say hello to them!
 *        -> … added as a team member by Former Lomir User. Say hello to them!
 *
 * 2  Role-application line (Pattern 4A) without sender: 3632. The sender of this
 *    format is the applicant (deletion-audit/37, all 21 rows with a sender); a
 *    NULL sender means that account was deleted. `53` D: its stored name matches
 *    no living user.
 *
 *      <name>'s application for <role> was approved
 *        -> Former Lomir User's application for <role> was approved
 *
 * Both: the name slot carries no id token, is not already the placeholder, and
 * matches no living user (display name OR username - writers fall back to the
 * username, "testuser 2" in 52). The rest of the text is kept byte for byte.
 * Nothing a person typed is touched.
 *
 * Registered after #352 and #353, so on the first run they still churn once and
 * this migration then writes the placeholder into the bare slot; on every later
 * run #352 skips the line. Own transaction, ceiling, zero-remaining self-check.
 * Verify with deletion-audit/54: eligible must be 0, and #352's log must show
 * "🎉 approver: 0".
 */
const DELETED_USER_DISPLAY_NAME = "Former Lomir User";
const EXPECTED_ROWS = 19; // 18 approvers + 1 applicant (deletion-audit/54)
const MAX_ROWS = 19;

// Double backslashes are required in JS template literals to preserve SQL regexes.
const PLAN_CTE = `
  WITH un AS (
    SELECT coalesce(nullif(btrim(regexp_replace(array_to_string(array_remove(
             ARRAY[nullif(u.first_name, ''), nullif(u.last_name, '')], NULL), ' '),
             '\\s+', ' ', 'g')), ''), u.username) AS name
    FROM users u
  ),
  approver AS (
    SELECT m.id, m.content, g[1] AS head, g[2] AS name_raw, g[3] AS tail
    FROM messages m,
         LATERAL (SELECT regexp_match(m.content,
           '^(🎉 .+ added as a team member by )(.+?)(\\. Say hello to them!)$') AS g) x
    WHERE g IS NOT NULL
      AND EXISTS (SELECT 1 FROM team_applications ta
                  WHERE ta.team_id = m.team_id AND ta.applicant_id = m.sender_id
                    AND ta.status = 'approved' AND ta.reviewed_at = m.sent_at
                    AND ta.reviewed_by IS NULL)
  ),
  applicant AS (
    SELECT m.id, m.content, ''::text AS head, g[1] AS name_raw, g[2] AS tail
    FROM messages m,
         LATERAL (SELECT regexp_match(m.content,
           '^(.+?)([’'']s application for .+ was approved\\.?)$') AS g) x
    WHERE g IS NOT NULL
      AND m.team_id IS NOT NULL
      AND m.sender_id IS NULL
  ),
  candidates AS (
    SELECT * FROM approver
    UNION ALL
    SELECT * FROM applicant
  ),
  plan AS (
    SELECT c.id, c.content,
           c.head || '${DELETED_USER_DISPLAY_NAME}' || c.tail AS new_content
    FROM candidates c
    WHERE NOT (c.name_raw ~ '^\\d+\\s*:')
      AND btrim(regexp_replace(c.name_raw, '\\s+', ' ', 'g')) <> '${DELETED_USER_DISPLAY_NAME}'
      AND NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(c.name_raw, '\\s+', ' ', 'g')))
      AND c.head || c.name_raw || c.tail = c.content
  )
`;

const UPDATE_SQL = `${PLAN_CTE}
  UPDATE messages m
  SET content = plan.new_content
  FROM plan
  WHERE m.id = plan.id
    AND m.content = plan.content
`;

const REMAINING_SQL = `${PLAN_CTE}
  SELECT count(*)::int AS remaining FROM plan
`;

const scrubDeletedPeopleInApplicationEvents = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(UPDATE_SQL);
    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `application-event scrub would rewrite ${result.rowCount} rows, ` +
          `above the ceiling of ${MAX_ROWS} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `application-event scrub left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }
    await client.query("COMMIT");
    console.log(
      `application-event scrub: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "application-event scrub: count differs from the dry run — " +
          "re-run deletion-audit/54 and read why before trusting it.",
      );
    }
    console.log(
      "application-event scrub: VERIFY with deletion-audit/54 — eligible must " +
        "now be 0. The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error scrubbing deleted people in application events (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = scrubDeletedPeopleInApplicationEvents;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
