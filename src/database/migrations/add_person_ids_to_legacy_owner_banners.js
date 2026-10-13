const db = require("../../config/database");

/**
 * Backfills both person ids in legacy OWNERSHIP_TEAM banners from the sibling
 * OWNERSHIP_TRANSFERRED DM. The ids come from persisted sender/receiver columns,
 * not a name lookup. Audit 39 measured 21 unique pairs among 43 bare banners;
 * audit 40 confirmed matching names and byte-preserving replacements for all 21.
 *
 * This is the rule from deletion-audit/40: same sender, no DM team_id, matching
 * team slot, exactly one DM in the preceding FIVE seconds (the measured pairs
 * all fell within one), and matching normalised person labels. Both people must
 * still exist, differ, and have no conflicting living holder of a stale name.
 * Neither partially tokenised banners nor rows on/after 2026-10-07 qualify.
 *
 * Only ids are inserted. Stored names, spacing and punctuation are preserved;
 * the frontend resolves current names and perspective from the new tokens.
 * The round-trip guard excludes content the parser cannot reproduce exactly.
 *
 * Runs on every migrate: token guards make it idempotent, the date cut closes
 * the population, and its transaction rolls back on an excessive count or any
 * eligible rows left behind. Verify independently with deletion-audit/40:
 * eligible must be 0. The migration runner catches errors without rethrowing.
 */
const EXPECTED_ROWS = 21;
const MAX_ROWS = 43;

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
    SELECT b.id AS banner_id, d.receiver_id,
           regexp_split_to_array(regexp_replace(d.content, '^[^:]*:\\s*', ''), '\\s+\\|\\s+') AS ds
    FROM base b
    JOIN messages d
      ON d.content LIKE '👑 OWNERSHIP_TRANSFERRED:%'
     AND d.sender_id = b.sender_id AND d.team_id IS NULL
     AND d.sent_at <= b.sent_at AND b.sent_at - d.sent_at <= interval '5 seconds'
  ),
  matching_team AS (
    SELECT c.banner_id, c.receiver_id,
           (btrim(regexp_replace(regexp_replace(c.ds[2], '^\\d+\\s*:\\s*', ''), '\\s+', ' ', 'g'))
              = btrim(regexp_replace(b.prev_raw, '\\s+', ' ', 'g'))
            AND btrim(regexp_replace(regexp_replace(c.ds[3], '^\\d+\\s*:\\s*', ''), '\\s+', ' ', 'g'))
              = btrim(regexp_replace(b.new_raw, '\\s+', ' ', 'g'))) AS names_ok
    FROM candidates c JOIN base b ON b.id = c.banner_id
    WHERE c.ds[1] ~ ('^' || b.team_id::text || '\\s*:')
       OR btrim(regexp_replace(c.ds[1], '\\s+', ' ', 'g'))
            = (SELECT btrim(regexp_replace(t.name, '\\s+', ' ', 'g')) FROM teams t WHERE t.id = b.team_id)
  ),
  resolved AS (
    SELECT banner_id, count(*) AS n, min(receiver_id) AS new_id,
           bool_and(names_ok) AS names_ok
    FROM matching_team GROUP BY banner_id
  ),
  plan AS (
    SELECT b.id, b.content,
           b.head || b.sender_id::text || ':' || b.prev_raw || ' | ' || a.new_id::text || ':' || b.new_raw AS new_content
    FROM base b JOIN resolved a ON a.banner_id = b.id
    WHERE b.sender_id IS NOT NULL
      AND a.n = 1 AND a.names_ok
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

const addPersonIdsToLegacyOwnerBanners = async () => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(UPDATE_SQL);
    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `owner banner id migration would rewrite ${result.rowCount} rows, ` +
          `above the ceiling of ${MAX_ROWS} — rolled back.`,
      );
    }
    const { rows } = await client.query(REMAINING_SQL);
    if (rows[0].remaining !== 0) {
      throw new Error(
        `owner banner id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }
    await client.query("COMMIT");
    console.log(
      `owner banner id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "owner banner id migration: count differs from the dry run — " +
          "re-run deletion-audit/40 and read why before trusting it.",
      );
    }
    console.log(
      "owner banner id migration: VERIFY with deletion-audit/40 — eligible " +
        "must now be 0. The migration runner's success message is not evidence.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding owner banner ids (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addPersonIdsToLegacyOwnerBanners;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
