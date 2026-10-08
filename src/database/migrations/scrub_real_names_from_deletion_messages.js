const db = require("../../config/database");

/**
 * Replaces the REAL name of a deleted account with the placeholder in the system
 * messages account deletion wrote between 2026-04-02 and 2026-06-15.
 *
 * From 6240daf ("Rewrite user deletion as transactional cleanup", 2026-04-02)
 * until df90a10 ("Anonymize account deletion system messages", 2026-06-15) the
 * deletion writer inserted, with sender_id NULL,
 *
 *   🚪 ${userDisplayName} has left Lomir.                 (every team of the user)
 *   👑 OWNERSHIP_TEAM: ${userDisplayName} | <successor>    (teams the user owned)
 *
 * df90a10 fixed the writer but migrated nothing, so those rows still name the
 * deleted person. The proof is the writer, not a name: in these two shapes with
 * no sender, the named person IS the account being deleted. deletion-audit/50
 * measured 10 such rows (8 leave lines, banners 3653 and 3695), four people, all
 * deleted on 2026-04-02, none of whose names a living user carries.
 *
 * As decided for departed members on 2026-10-02: the message stays, only the
 * name becomes the placeholder.
 *
 *   🚪 <name> has left Lomir.             ->  🚪 Former Lomir User has left Lomir.
 *   👑 OWNERSHIP_TEAM: <name> | <rest>    ->  👑 OWNERSHIP_TEAM: Former Lomir User | <rest>
 *
 * The rule, all of which must hold:
 *   - a team message with sender NULL, sent in the writer's window
 *     [2026-04-02, 2026-06-16);
 *   - exactly one of the two shapes above, the name slot carrying no id token and
 *     not already the placeholder;
 *   - the name matches no living user;
 *   - the content round-trips exactly (the successor part is kept byte for byte).
 *
 * Registered BEFORE the two successor-id migrations: once 3653 and 3695 carry the
 * exact placeholder, add_successor_ids_to_deletion_owner_banners (3695) and
 * add_successor_ids_confirmed_by_next_banner (3653) reach them in the same run.
 *
 * Nothing a person typed is touched. Runs on every migrate: the date window and
 * the placeholder guard make it idempotent, and the transaction rolls back above
 * the ceiling or with any eligible rows left behind. Verify with deletion-audit/51:
 * eligible must be 0.
 */
const DELETED_USER_DISPLAY_NAME = "Former Lomir User";
const EXPECTED_ROWS = 10;
const MAX_ROWS = 10;

// Double backslashes are required in JS template literals to preserve SQL regexes.
const PLAN_CTE = `
  WITH un AS (
    SELECT btrim(regexp_replace(array_to_string(array_remove(
             ARRAY[nullif(u.first_name, ''), nullif(u.last_name, '')], NULL), ' '),
             '\\s+', ' ', 'g')) AS name
    FROM users u
  ),
  window_rows AS (
    SELECT m.id, m.content
    FROM messages m
    WHERE m.team_id IS NOT NULL
      AND m.sender_id IS NULL
      AND m.sent_at >= '2026-04-02' AND m.sent_at < '2026-06-16'
  ),
  shaped AS (
    SELECT w.id, w.content, 'leave' AS shape,
           NULL::text AS head, l[1] AS name_raw, NULL::text AS rest_raw
    FROM window_rows w,
         LATERAL (SELECT regexp_match(w.content, '^🚪 (.+) has left Lomir\\.$') AS l) x
    WHERE l IS NOT NULL
    UNION ALL
    SELECT w.id, w.content, 'banner',
           g[1], g[2], g[3]
    FROM window_rows w,
         LATERAL (SELECT regexp_match(w.content, '^(👑 OWNERSHIP_TEAM:\\s*)(.+?)\\s+\\|\\s+(.+)$') AS g) x
    WHERE g IS NOT NULL
  ),
  plan AS (
    SELECT s.id, s.content,
           CASE s.shape
             WHEN 'leave' THEN '🚪 ${DELETED_USER_DISPLAY_NAME} has left Lomir.'
             ELSE s.head || '${DELETED_USER_DISPLAY_NAME}' || ' | ' || s.rest_raw
           END AS new_content
    FROM shaped s
    WHERE NOT (s.name_raw ~ '^\\d+\\s*:')
      AND btrim(regexp_replace(s.name_raw, '\\s+', ' ', 'g')) <> '${DELETED_USER_DISPLAY_NAME}'
      AND NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(s.name_raw, '\\s+', ' ', 'g')))
      AND CASE s.shape
            WHEN 'leave' THEN '🚪 ' || s.name_raw || ' has left Lomir.' = s.content
            ELSE s.head || s.name_raw || ' | ' || s.rest_raw = s.content
          END
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

const scrubRealNamesFromDeletionMessages = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(UPDATE_SQL);
    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `deletion-message name scrub would rewrite ${result.rowCount} rows, ` +
          `above the ceiling of ${MAX_ROWS} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `deletion-message name scrub left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }
    await client.query("COMMIT");
    console.log(
      `deletion-message name scrub: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "deletion-message name scrub: count differs from the dry run — " +
          "re-run deletion-audit/51 and read why before trusting it.",
      );
    }
    console.log(
      "deletion-message name scrub: VERIFY with deletion-audit/51 — eligible " +
        "must now be 0. The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error scrubbing names from deletion messages (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = scrubRealNamesFromDeletionMessages;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
