const db = require("../../config/database");

/**
 * Writes the TEAM id into slot 1 of the legacy marker DMs whose team is still
 * there and can be identified on evidence (4–15 January 2026).
 *
 * 🔴 **Why it exists.** The frontend makes a team name a link only when its
 * token carries an id (`TeamMentionById`). The live writers store
 * `teamId:teamName` since 49f6753 (2026-01-15), and BE #355 gave these legacy
 * DMs their PERSON ids only, so a team that still exists showed as plain text,
 * e.g. "Du hast die Einladung von … zu „<team>“ abgelehnt" (item 33). All eight
 * formats already read slot 1 with `parseIdNameToken`, so no parser change.
 *
 * 🟢 **What it writes, and what it keeps.** Only `<team id>:` is put in front of
 * the stored team name. Nothing else changes, so removing it gives back the old
 * content byte for byte. The stored name stays as the fallback.
 *
 * ⚠️ **Why not look the team up by name at display time.** `teams.name` has no
 * UNIQUE rule (`deletion-audit/56` A), so a name reused by a later team would
 * link the wrong one. Every id written here is corroborated beyond the name.
 *
 * THE RULE. A row is rewritten only if ALL hold:
 *   1  it is a DM (`team_id IS NULL`) of one of the eight formats, sent before
 *      2026-01-16, and its slot 1 carries no id
 *   2  EITHER (path N) exactly one team carries the stored name, it existed when
 *      the DM was written, it is linked to the DM's sender or receiver
 *      (membership, application or invitation), and no one-team second source
 *      names a different team
 *      OR (path S) no team carries the stored name (renamed), and the second
 *      source by PEOPLE names exactly one team that existed when the DM was
 *      written. Sources: APPLICATION_APPROVED/DECLINED — applicant = receiver,
 *      reviewed_by = sender; INVITATION_DECLINED — invitee = sender, inviter =
 *      receiver; INVITATION_CANCELLED — invitee = receiver.
 *
 * ✅ **Measured and dry-run against production, 2026-10-08.** `55`: 204 such
 * rows, 110 match one team by name, 94 none, 0 several. `56`: all 110 existed
 * before their DM and are linked to its people, 0 conflicts; the 6 that differ
 * from the source are all renamed teams. `57` (this rule): **116 eligible**
 * (N 110, S 6), 88 left as text (73 formats without a source, 10 ambiguous,
 * 5 source found nothing); after-state 116/116 changed, round trip, parses,
 * id is a team, re-run safe; 0 bare rows after the cut.
 *
 * 🟢 **Idempotent by guard.** The population is rows whose slot 1 has NO id; a
 * rewritten row has one, so a second run finds nothing. The date cut is closed
 * (`57` D: 0 bare rows after it), so the population can only shrink.
 *
 * 🔴 **Verified by itself.** `index.js` catches a module's error and does NOT
 * rethrow, so the runner's success message is not evidence. This module owns
 * its transaction, re-counts its own plan after writing and rolls back unless
 * nothing is left, and refuses a count above the 204 that exist. The honest
 * check is still to re-run `deletion-audit/57`: `eligible` must be 0.
 */

const EXPECTED_ROWS = 116; // `deletion-audit/57`
const MAX_ROWS = 204; // the whole population of `55`; a larger count is a bug

const MARKERS = [
  "ROLE_CHANGED",
  "APPLICATION_APPROVED",
  "APPLICATION_DECLINED",
  "INVITATION_DECLINED",
  "INVITATION_CANCELLED",
  "MEMBER_REMOVED",
  "OWNERSHIP_TRANSFERRED",
  "APPLICATION_CANCELLED",
];

const MARKERS_SQL = MARKERS.map((marker) => `'${marker}'`).join(", ");

// ⚠️ `\\s`, `\\S` and `\\d` in the JS source: in a template literal `\s` is just
// `s`, and the SQL would then match a literal letter and touch nothing.
const NORM = (expr) => `btrim(regexp_replace(${expr}, '\\s+', ' ', 'g'))`;

const PLAN_CTE = `
  WITH bare AS (
    SELECT m.id, m.content, m.sender_id, m.receiver_id, m.sent_at,
           substring(m.content from '^\\S*\\s*([A-Z_]+):') AS marker,
           substring(m.content from '^[^:]*:\\s*') AS head,
           ${NORM(`split_part(regexp_replace(m.content, '^[^:]*:\\s*', ''), ' | ', 1)`)} AS slot1
    FROM messages m
    WHERE m.team_id IS NULL
      AND m.sent_at < '2026-01-16'
      AND m.content ~ '^\\S*\\s*[A-Z][A-Z_]+:\\s'
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '^\\d+\\s*:')
  ),
  cand AS (
    SELECT b.*,
           (SELECT count(*) FROM teams t WHERE ${NORM("t.name")} = b.slot1) AS name_teams,
           (SELECT min(t.id) FROM teams t WHERE ${NORM("t.name")} = b.slot1) AS name_team_id,
           CASE
             WHEN b.marker IN ('APPLICATION_APPROVED', 'APPLICATION_DECLINED') THEN
               (SELECT array_agg(DISTINCT ta.team_id) FROM team_applications ta
                 WHERE ta.applicant_id = b.receiver_id AND ta.reviewed_by = b.sender_id
                   AND ta.status = CASE WHEN b.marker = 'APPLICATION_APPROVED'
                                        THEN 'approved' ELSE 'rejected' END)
             WHEN b.marker = 'INVITATION_DECLINED' THEN
               (SELECT array_agg(DISTINCT ti.team_id) FROM team_invitations ti
                 WHERE ti.invitee_id = b.sender_id AND ti.inviter_id = b.receiver_id
                   AND ti.status = 'declined')
             WHEN b.marker = 'INVITATION_CANCELLED' THEN
               (SELECT array_agg(DISTINCT ti.team_id) FROM team_invitations ti
                 WHERE ti.invitee_id = b.receiver_id AND ti.status = 'canceled')
           END AS src_teams
    FROM bare b
    WHERE b.marker IN (${MARKERS_SQL})
  ),
  decided AS (
    SELECT c.*,
           CASE
             WHEN c.name_teams = 1
              AND EXISTS (SELECT 1 FROM teams t
                           WHERE t.id = c.name_team_id AND t.created_at <= c.sent_at)
              AND (EXISTS (SELECT 1 FROM team_members tm
                            WHERE tm.team_id = c.name_team_id
                              AND tm.user_id IN (c.sender_id, c.receiver_id))
                OR EXISTS (SELECT 1 FROM team_applications ta
                            WHERE ta.team_id = c.name_team_id
                              AND ta.applicant_id IN (c.sender_id, c.receiver_id))
                OR EXISTS (SELECT 1 FROM team_invitations ti
                            WHERE ti.team_id = c.name_team_id
                              AND (ti.invitee_id IN (c.sender_id, c.receiver_id)
                                OR ti.inviter_id IN (c.sender_id, c.receiver_id))))
              -- coalesce: without a source src_teams is NULL, and NOT (NULL AND …)
              -- is NULL, which would silently drop the four no-source formats.
              AND NOT coalesce(cardinality(c.src_teams) = 1
                               AND c.src_teams[1] <> c.name_team_id, false)
               THEN c.name_team_id
             WHEN c.name_teams = 0
              AND cardinality(c.src_teams) = 1
              AND EXISTS (SELECT 1 FROM teams t
                           WHERE t.id = c.src_teams[1] AND t.created_at <= c.sent_at)
               THEN c.src_teams[1]
           END AS team_id
    FROM cand c
  ),
  plan AS (
    SELECT d.id, d.content,
           d.head || d.team_id::text || ':' || substring(d.content FROM length(d.head) + 1) AS new_content
    FROM decided d
    WHERE d.team_id IS NOT NULL
  )
`;

const UPDATE_SQL = `${PLAN_CTE}
  UPDATE messages m
  SET content = plan.new_content
  FROM plan
  WHERE m.id = plan.id
    AND m.content = plan.content
`;

// The same plan, counted AFTER the update: every eligible row carries an id by
// then, so a non-zero count means the statement and its own rule disagree.
const REMAINING_SQL = `${PLAN_CTE}
  SELECT count(*)::int AS remaining FROM plan
`;

const addTeamIdsToLegacyMarkerDms = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(UPDATE_SQL);

    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `legacy marker team id migration would rewrite ${result.rowCount} rows, ` +
          `but only ${MAX_ROWS} can exist — rolled back. The rule is too wide.`,
      );
    }

    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `legacy marker team id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `legacy marker team id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "legacy marker team id migration: ⚠️ the count differs from the dry run — " +
          "re-run deletion-audit/57 and read why before trusting it.",
      );
    }
    console.log(
      "legacy marker team id migration: VERIFY with deletion-audit/57 — " +
        "`eligible` must now be 0. The migration runner's success message is " +
        "not evidence; it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error adding team ids to legacy marker DMs (rolled back):",
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addTeamIdsToLegacyMarkerDms;
module.exports.MARKERS = MARKERS;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
