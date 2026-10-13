const db = require("../../config/database");

/**
 * Backfills both person ids in the four legacy OWNERSHIP_TEAM banners that
 * add_person_ids_to_legacy_owner_banners had to leave bare: two DOUBLE
 * transfers of 2026-01-09 (banners 1285/1287 in team 154, 1326/1328 in team
 * 155). Each transfer was written twice ~2 s apart, so the five-second window
 * of that migration found two DMs for the second banner, and the DMs carry a
 * team name no team has today (renamed since), so its team-slot check failed.
 *
 * deletion-audit/42 found no refutation: no slot names an existing team, no DM
 * precedes another team's banner, both people exist and differ, stored names
 * conflict with no other living user, and the round trip holds. deletion-
 * audit/43 measured the second source: every candidate DM of a banner has the
 * SAME non-null receiver and the candidates are byte-identical, so the new
 * owner id is the same whichever DM is taken. The previous owner is the sender,
 * identical on banner and DM by construction.
 *
 * The rule, all of which must hold:
 *   - a bare team banner (no token in either slot), sent before 2026-10-07;
 *   - at least one owner DM from the same sender, no team_id, 0..5 s before;
 *   - EVERY such DM names both stored people exactly (normalised);
 *   - NO such DM has a team slot matching the banner's team (that population
 *     belongs to add_person_ids_to_legacy_owner_banners) and NO slot names an
 *     existing team, by id token or by current name;
 *   - no such DM also precedes, within 5 s, another team's owner banner from
 *     the same sender;
 *   - all such DMs share one non-null receiver;
 *   - both people exist and differ, no stale name belongs to another living
 *     user, and the content round-trips exactly.
 *
 * Only ids are inserted; stored names, spacing and punctuation are preserved.
 * Runs on every migrate: token guards make it idempotent, the date cut closes
 * the population, and its transaction rolls back above the ceiling or with any
 * eligible rows left behind. Verify independently with deletion-audit/44:
 * eligible must be 0. The migration runner catches errors without rethrowing.
 */
const EXPECTED_ROWS = 4;
const MAX_ROWS = 4;

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
      AND m.sent_at < '2026-10-07'
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '^\\d+\\s*:')
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '\\|\\s*\\d+\\s*:')
  ),
  candidates AS (
    SELECT b.id AS banner_id, b.team_id, b.sender_id, d.receiver_id, d.sent_at AS dm_sent_at,
           regexp_split_to_array(regexp_replace(d.content, '^[^:]*:\\s*', ''), '\\s+\\|\\s+') AS ds
    FROM base b
    JOIN messages d
      ON d.content LIKE '👑 OWNERSHIP_TRANSFERRED:%'
     AND d.sender_id = b.sender_id AND d.team_id IS NULL
     AND d.sent_at <= b.sent_at AND b.sent_at - d.sent_at <= interval '5 seconds'
  ),
  checked AS (
    SELECT c.banner_id, c.receiver_id,
           (btrim(regexp_replace(regexp_replace(c.ds[2], '^\\d+\\s*:\\s*', ''), '\\s+', ' ', 'g'))
              = btrim(regexp_replace(b.prev_raw, '\\s+', ' ', 'g'))
            AND btrim(regexp_replace(regexp_replace(c.ds[3], '^\\d+\\s*:\\s*', ''), '\\s+', ' ', 'g'))
              = btrim(regexp_replace(b.new_raw, '\\s+', ' ', 'g'))) AS names_ok,
           (c.ds[1] ~ ('^' || b.team_id::text || '\\s*:')
            OR btrim(regexp_replace(c.ds[1], '\\s+', ' ', 'g'))
                 = (SELECT btrim(regexp_replace(t.name, '\\s+', ' ', 'g')) FROM teams t WHERE t.id = b.team_id)) AS team_slot_ok,
           CASE WHEN c.ds[1] ~ '^\\d+\\s*:'
                THEN EXISTS (SELECT 1 FROM teams t
                             WHERE t.id = (regexp_match(c.ds[1], '^(\\d+)'))[1]::bigint)
                ELSE EXISTS (SELECT 1 FROM teams t
                             WHERE btrim(regexp_replace(t.name, '\\s+', ' ', 'g'))
                                   = btrim(regexp_replace(c.ds[1], '\\s+', ' ', 'g')))
           END AS slot_names_a_team,
           EXISTS (SELECT 1 FROM messages o
                   WHERE o.content LIKE '👑 OWNERSHIP_TEAM:%' AND o.team_id IS NOT NULL
                     AND o.team_id <> c.team_id AND o.sender_id = c.sender_id
                     AND o.sent_at >= c.dm_sent_at
                     AND o.sent_at - c.dm_sent_at <= interval '5 seconds') AS precedes_other_team
    FROM candidates c JOIN base b ON b.id = c.banner_id
  ),
  resolved AS (
    SELECT banner_id,
           bool_and(names_ok) AS all_named,
           bool_or(team_slot_ok) AS any_team_slot_ok,
           bool_or(slot_names_a_team) AS any_slot_names_a_team,
           bool_or(precedes_other_team) AS any_precedes_other_team,
           count(DISTINCT receiver_id) AS receivers,
           bool_or(receiver_id IS NULL) AS any_receiver_null,
           min(receiver_id) AS new_id
    FROM checked GROUP BY banner_id
  ),
  plan AS (
    SELECT b.id, b.content,
           b.head || b.sender_id::text || ':' || b.prev_raw || ' | ' || a.new_id::text || ':' || b.new_raw AS new_content
    FROM base b JOIN resolved a ON a.banner_id = b.id
    WHERE b.sender_id IS NOT NULL
      AND a.all_named
      AND NOT a.any_team_slot_ok
      AND NOT a.any_slot_names_a_team
      AND NOT a.any_precedes_other_team
      AND a.receivers = 1 AND NOT a.any_receiver_null
      AND EXISTS (SELECT 1 FROM un WHERE un.id = b.sender_id)
      AND EXISTS (SELECT 1 FROM un WHERE un.id = a.new_id)
      AND b.sender_id IS DISTINCT FROM a.new_id
      AND (btrim(regexp_replace(b.prev_raw, '\\s+', ' ', 'g'))
             = (SELECT un.name FROM un WHERE un.id = b.sender_id)
           OR NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(b.prev_raw, '\\s+', ' ', 'g'))))
      AND (btrim(regexp_replace(b.new_raw, '\\s+', ' ', 'g'))
             = (SELECT un.name FROM un WHERE un.id = a.new_id)
           OR NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(b.new_raw, '\\s+', ' ', 'g'))))
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

const addPersonIdsToDuplicateOwnerBanners = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(UPDATE_SQL);
    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `duplicate owner banner id migration would rewrite ${result.rowCount} rows, ` +
          `above the ceiling of ${MAX_ROWS} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `duplicate owner banner id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }
    await client.query("COMMIT");
    console.log(
      `duplicate owner banner id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "duplicate owner banner id migration: count differs from the dry run — " +
          "re-run deletion-audit/44 and read why before trusting it.",
      );
    }
    console.log(
      "duplicate owner banner id migration: VERIFY with deletion-audit/44 — " +
        "eligible must now be 0. The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding duplicate owner banner ids (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addPersonIdsToDuplicateOwnerBanners;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
