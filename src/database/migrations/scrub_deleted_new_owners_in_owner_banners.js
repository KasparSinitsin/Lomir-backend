const db = require("../../config/database");

/**
 * Completes the deletion scrub for five legacy OWNERSHIP_TEAM banners whose NEW
 * owner deleted the account soon after the transfer (5897, 5906, 5914, 5920,
 * 5929). The deletion scrub finds a person by id; these rows carry two
 * names and no id, so the deleted person's real name stayed in the banner and
 * in the chat-list preview.
 *
 * Renamed and deleted cannot be told apart by a name, so the rule rests on the
 * deletion writer (userDeletionController.js): for every team the deleted user
 * OWNED it inserts `👑 OWNERSHIP_TEAM: Former Lomir User | <successor>` with
 * sender_id NULL, next to `🚪 Former Lomir User has left Lomir.`. If that is the
 * very next owner banner of the team, the owner who was deleted is the new
 * owner of the banner before it. deletion-audit/45 measured all five: deletion
 * form next (70-777 s later), leave message in between, and the stored new-
 * owner name matches no living user. A sixth, 6296, met all of this in 45 but
 * failed the living-name rule in dry run 46 the same day (a living user now
 * carries that name) and is left alone.
 *
 * The rewrite follows the rule decided 2026-10-02 for departed members:
 * the message stays, only the name is replaced by the placeholder. The previous
 * owner, who is the sender, also gets the id in front of the stored name, so a
 * later rename shows (5920: the sender is user 89, confirmed by Julia).
 *
 *   👑 OWNERSHIP_TEAM: <prev name> | <deleted name>
 *     ->  👑 OWNERSHIP_TEAM: <sender id>:<prev name> | Former Lomir User
 *
 * The rule, all of which must hold:
 *   - a bare team banner (no token in either slot), sender set, sent before
 *     2026-10-07;
 *   - the next owner banner of the same team has no sender, its previous-owner
 *     slot is exactly the placeholder, and it follows within 15 minutes;
 *   - a `🚪 ... has left Lomir.` team message lies between the two (+60 s);
 *   - the stored new-owner name matches no living user;
 *   - the sender exists and its stored name either equals the sender's current
 *     name or matches no living user;
 *   - the content round-trips exactly.
 *
 * Only system banners are rewritten; nothing a person typed is touched. Runs
 * on every migrate: the token guard makes it idempotent, the date cut closes
 * the population, and the transaction rolls back above the ceiling or with any
 * eligible rows left behind. Verify with deletion-audit/46: eligible must be 0.
 */
const DELETED_USER_DISPLAY_NAME = "Former Lomir User";
const EXPECTED_ROWS = 5;
const MAX_ROWS = 5;

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
    SELECT m.id, m.content, m.team_id, m.sender_id, m.sent_at,
           g[1] AS head, g[2] AS prev_raw, g[3] AS new_raw
    FROM messages m,
         LATERAL (SELECT regexp_match(m.content, '^([^:]*:\\s*)(.+?)\\s+\\|\\s+(.+)$') AS g) x
    WHERE m.content LIKE '👑 OWNERSHIP_TEAM:%'
      AND m.team_id IS NOT NULL
      AND m.sender_id IS NOT NULL
      AND m.sent_at < '2026-10-07'
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '^\\d+\\s*:')
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '\\|\\s*\\d+\\s*:')
  ),
  next_banner AS (
    SELECT DISTINCT ON (b.id) b.id AS banner_id, o.sender_id AS next_sender, o.sent_at AS next_sent_at,
           btrim(regexp_replace((regexp_match(o.content, '^[^:]*:\\s*(.+?)\\s+\\|\\s+(.+)$'))[1],
                                '\\s+', ' ', 'g')) AS next_prev
    FROM base b
    JOIN messages o
      ON o.content LIKE '👑 OWNERSHIP_TEAM:%' AND o.team_id = b.team_id
     AND (o.sent_at > b.sent_at OR (o.sent_at = b.sent_at AND o.id > b.id))
    ORDER BY b.id, o.sent_at, o.id
  ),
  plan AS (
    SELECT b.id, b.content,
           b.head || b.sender_id::text || ':' || b.prev_raw || ' | ' || '${DELETED_USER_DISPLAY_NAME}' AS new_content
    FROM base b JOIN next_banner n ON n.banner_id = b.id
    WHERE n.next_sender IS NULL
      AND n.next_prev = '${DELETED_USER_DISPLAY_NAME}'
      AND n.next_sent_at - b.sent_at <= interval '15 minutes'
      AND EXISTS (SELECT 1 FROM messages l
                  WHERE l.team_id = b.team_id AND l.content LIKE '🚪 %has left Lomir.%'
                    AND l.sent_at >= b.sent_at
                    AND l.sent_at <= n.next_sent_at + interval '60 seconds')
      AND NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(b.new_raw, '\\s+', ' ', 'g')))
      AND btrim(regexp_replace(b.new_raw, '\\s+', ' ', 'g')) <> '${DELETED_USER_DISPLAY_NAME}'
      AND EXISTS (SELECT 1 FROM un WHERE un.id = b.sender_id)
      AND (btrim(regexp_replace(b.prev_raw, '\\s+', ' ', 'g'))
             = (SELECT un.name FROM un WHERE un.id = b.sender_id)
           OR NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(b.prev_raw, '\\s+', ' ', 'g'))))
      AND b.head || b.prev_raw || ' | ' || b.new_raw = b.content
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

const scrubDeletedNewOwnersInOwnerBanners = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(UPDATE_SQL);
    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `deleted new-owner scrub would rewrite ${result.rowCount} rows, ` +
          `above the ceiling of ${MAX_ROWS} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `deleted new-owner scrub left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }
    await client.query("COMMIT");
    console.log(
      `deleted new-owner scrub: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "deleted new-owner scrub: count differs from the dry run — " +
          "re-run deletion-audit/46 and read why before trusting it.",
      );
    }
    console.log(
      "deleted new-owner scrub: VERIFY with deletion-audit/46 — eligible " +
        "must now be 0. The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error scrubbing deleted new owners (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = scrubDeletedNewOwnersInOwnerBanners;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
