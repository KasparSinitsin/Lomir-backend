const db = require("../../config/database");

/**
 * A second route to the successor id of a legacy deletion-form OWNERSHIP_TEAM
 * banner, `👑 OWNERSHIP_TEAM: Former Lomir User | <successor name>` (sender NULL).
 *
 * add_successor_ids_to_deletion_owner_banners requires the notified successor
 * to be the team's owner TODAY. On 2026-10-08 that held for 5926 in dry run 46
 * and no longer held at migrate time, because ownership of the team moved in
 * between; the banner kept a renamed successor's old name and its click failed.
 *
 * A move writes its own evidence. The current transfer writer
 * (teamMembersController.js) inserts `👑 OWNERSHIP_TEAM: <prev id>:<name> | ...`
 * with sender = the previous owner. If the NEXT owner banner of the team after
 * the deletion-form banner is sent by the notified user AND names that user's id
 * as previous owner, that user owned the team right after the deletion: a second
 * persisted source next to the notification, independent of today's owner.
 * Measured by deletion-audit/47; dry run deletion-audit/48.
 *
 *   👑 OWNERSHIP_TEAM: Former Lomir User | <successor name>
 *     ->  👑 OWNERSHIP_TEAM: Former Lomir User | <successor id>:<successor name>
 *
 * The rule, all of which must hold:
 *   - a team banner without sender, sent before 2026-10-07, whose previous-
 *     owner slot is exactly the placeholder and whose successor slot is bare;
 *   - exactly one distinct, non-null notification user of type
 *     ownership_transferred for the team within 5 s of the banner;
 *   - the next owner banner of the team is sent by that user and its previous-
 *     owner slot carries that user's id token;
 *   - the user exists, and the stored name either equals the user's current
 *     name or matches no living user;
 *   - the content round-trips exactly.
 *
 * Only the id is inserted; the stored name stays as the fallback. Runs on
 * every migrate: the token guard makes it idempotent, the date cut closes the
 * population, and the transaction rolls back above the ceiling or with any
 * eligible rows left behind. Verify with deletion-audit/48: eligible must be 0.
 */
const DELETED_USER_DISPLAY_NAME = "Former Lomir User";
// deletion-audit/47 (2026-10-08): 5926 is the one banner this route reaches.
// 3653 is confirmed by its next banner too, but its previous-owner slot is not
// the exact placeholder, so the rule leaves it for the deleted-names round.
const EXPECTED_ROWS = 1;
const MAX_ROWS = 1;

// Double backslashes are required in JS template literals to preserve SQL regexes.
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
           g[1] AS head, g[2] AS prev_raw, g[3] AS succ_raw
    FROM messages m,
         LATERAL (SELECT regexp_match(m.content, '^([^:]*:\\s*)(.+?)\\s+\\|\\s+(.+)$') AS g) x
    WHERE m.content LIKE '👑 OWNERSHIP_TEAM:%'
      AND m.team_id IS NOT NULL
      AND m.sender_id IS NULL
      AND m.sent_at < '2026-10-07'
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '\\|\\s*\\d+\\s*:')
  ),
  notified AS (
    SELECT b.id AS banner_id,
           count(DISTINCT n.user_id) AS users,
           bool_or(n.user_id IS NULL) AS any_null,
           min(n.user_id) AS succ_id
    FROM base b
    JOIN notifications n
      ON n.type = 'ownership_transferred' AND n.team_id = b.team_id
     AND abs(extract(epoch FROM (n.created_at - b.sent_at))) <= 5
    GROUP BY b.id
  ),
  next_banner AS (
    SELECT DISTINCT ON (b.id) b.id AS banner_id, o.sender_id AS next_sender,
           CASE WHEN regexp_replace(o.content, '^[^:]*:\\s*', '') ~ '^\\d+\\s*:'
                THEN (regexp_match(regexp_replace(o.content, '^[^:]*:\\s*', ''), '^(\\d+)'))[1]::bigint
           END AS next_prev_id
    FROM base b
    JOIN messages o
      ON o.content LIKE '👑 OWNERSHIP_TEAM:%' AND o.team_id = b.team_id
     AND (o.sent_at > b.sent_at OR (o.sent_at = b.sent_at AND o.id > b.id))
    ORDER BY b.id, o.sent_at, o.id
  ),
  plan AS (
    SELECT b.id, b.content,
           b.head || b.prev_raw || ' | ' || s.succ_id::text || ':' || b.succ_raw AS new_content
    FROM base b
    JOIN notified s ON s.banner_id = b.id
    JOIN next_banner x ON x.banner_id = b.id
    WHERE b.prev_raw = '${DELETED_USER_DISPLAY_NAME}'
      AND s.users = 1 AND NOT s.any_null
      AND x.next_sender = s.succ_id
      AND x.next_prev_id = s.succ_id
      AND EXISTS (SELECT 1 FROM un WHERE un.id = s.succ_id)
      AND (btrim(regexp_replace(b.succ_raw, '\\s+', ' ', 'g'))
             = (SELECT un.name FROM un WHERE un.id = s.succ_id)
           OR NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(b.succ_raw, '\\s+', ' ', 'g'))))
      AND b.head || b.prev_raw || ' | ' || b.succ_raw = b.content
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

const addSuccessorIdsConfirmedByNextBanner = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(UPDATE_SQL);
    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `next-banner successor id migration would rewrite ${result.rowCount} rows, ` +
          `above the ceiling of ${MAX_ROWS} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `next-banner successor id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }
    await client.query("COMMIT");
    console.log(
      `next-banner successor id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "next-banner successor id migration: count differs from the dry run — " +
          "re-run deletion-audit/48 and read why before trusting it.",
      );
    }
    console.log(
      "next-banner successor id migration: VERIFY with deletion-audit/48 — " +
        "eligible must now be 0. The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding next-banner successor ids (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addSuccessorIdsConfirmedByNextBanner;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
