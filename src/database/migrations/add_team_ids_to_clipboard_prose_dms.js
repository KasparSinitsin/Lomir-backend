const db = require("../../config/database");

/**
 * Writes the TEAM id into the quoted team name of the legacy 📋 prose DMs
 * (December 2025 – January 2026) whose team can be identified on evidence.
 *
 * 🔴 **Why it exists (item 35).** These DMs name a team only by its quoted name,
 * so a team that still exists showed as plain text, e.g. "Deine Absage zur
 * Bewerbung von … bei „Weekend City Explorers“" (message 585). Four formats, no
 * live writer in either repo:
 *   F4  📋 Application declined: <applicant> for "<team>":\n\n"<msg>"   decliner → applicant
 *   RA  📋 Response to your application for "<team>":\n\n"<msg>"         decliner → applicant
 *   IR  📋 Response to your invitation for "<team>":\n\n"<msg>"          invitee → inviter
 *   YA  📋 Your application to "<team>" was declined by <decliner>.     decliner → applicant
 * The frontend parser reads `"<id>:<name>"` in all four since item 35.
 * ⚠️ So this must run only where that frontend is live: an older frontend
 * shows the quoted text verbatim, i.e. „81:Weekend City Explorers“.
 *
 * 🟢 **What it writes, and what it keeps.** Only `<team id>:` is inserted after
 * the first double quote, which must be the team's opening quote. Removing it
 * gives back the old content byte for byte; the stored name stays the fallback.
 *
 * THE RULE (Julia, 2026-10-09; item 33's standard). A row is rewritten only if:
 *   1  it is a DM (`team_id IS NULL`) of one of the four formats, sent before
 *      2026-01-16, and its quoted team carries no id
 *   2  EITHER (path N) exactly one team carries the stored name, it existed when
 *      the DM was written, and the DM's PEOPLE are linked to it — F4/RA/YA: the
 *      receiver's application to that team was rejected; IR: the receiver
 *      invited the sender to that team and the sender declined — and no
 *      one-team strict source names a different team
 *      OR (path S) no team carries the stored name (renamed) and the strict
 *      source names exactly one team that existed when the DM was written —
 *      F4/RA/YA: applicant = receiver, reviewed_by = sender, rejected; IR:
 *      invitee = sender, inviter = receiver, declined
 *   3  the first double quote opens the team the format pattern reads.
 *
 * ✅ **Measured on production, 2026-10-09:** `61` (F4 7, IR 8, + 6 unread),
 * `62` (the 6 are RA 4 + 2 more; the ambiguous IR rows are corroborated), `64`
 * (the 2 are YA, not the invitation template I first assumed; it has no rows).
 * `63` is this rule as a dry run, RUN on production 2026-10-09: population 21,
 * **19 eligible** (F4 7, IR 7, RA 3, YA 2; N 16, S 3), 2 left as text (748: no
 * name, no source; 463: no name, source names 2 teams); after-state 19/19 changed,
 * opening quote, round trip, parses, id is a team, re-run safe; 0 rows after the cut.
 *
 * ⚠️ `[^"]+` around the quoted name, never `.+?`: in Postgres the FIRST
 * quantifier sets the greediness of the whole RE, so a lazy group ran on to a
 * later `for "…":` inside the personal message (rounds 62, 63).
 * ⚠️ `\\s`, `\\n` and `\\d` in the JS source: in a template literal `\s` is
 * just `s`, and the SQL would match a literal letter and touch nothing.
 *
 * 🟢 **Idempotent by guard.** A rewritten row carries an id in its quotes and
 * leaves the population; the date cut is closed (`63` D).
 * 🔴 **Verified by itself.** `index.js` swallows a module's error, so this owns
 * its transaction, re-counts its plan after writing, rolls back unless nothing
 * is left, and refuses a count above the 21 📋 DMs that exist.
 */

const EXPECTED_ROWS = 19; // `deletion-audit/63` on production, 2026-10-09
const MAX_ROWS = 21; // every 📋 DM `61` found; a larger count is a bug

const FORMAT_SQL = `
  CASE
    WHEN m.content ~ '^📋\\s+Application declined:\\s+[^"]+\\s+for\\s+"[^"]+":\\s*\\n\\n".+"$' THEN 'F4'
    WHEN m.content ~ '^📋\\s+Response to your application for "[^"]+":\\s*\\n\\n".+"$' THEN 'RA'
    WHEN m.content ~ '^📋\\s+Response to your invitation for "[^"]+":\\s*\\n\\n".+"$' THEN 'IR'
    WHEN m.content ~ '^📋\\s+Your application to "[^"]+" was declined by [^"]+\\.$' THEN 'YA'
  END`;

const NORM = (expr) => `btrim(regexp_replace(${expr}, '\\s+', ' ', 'g'))`;

const PLAN_CTE = `
  WITH base AS (
    SELECT m.id, m.content, m.sender_id, m.receiver_id, m.sent_at,
           ${FORMAT_SQL} AS fmt,
           substring(m.content from '"([^"]+)"') AS raw_team,
           strpos(m.content, '"') AS q
    FROM messages m
    WHERE m.team_id IS NULL
      AND m.sent_at < '2026-01-16'
      AND m.content LIKE '📋%'
  ),
  cand AS (
    SELECT b.*,
           (SELECT count(*) FROM teams t WHERE ${NORM("t.name")} = ${NORM("b.raw_team")}) AS name_teams,
           (SELECT min(t.id) FROM teams t WHERE ${NORM("t.name")} = ${NORM("b.raw_team")}) AS name_team_id,
           CASE
             WHEN b.fmt IN ('F4', 'RA', 'YA') THEN
               (SELECT array_agg(DISTINCT ta.team_id) FROM team_applications ta
                 WHERE ta.applicant_id = b.receiver_id AND ta.reviewed_by = b.sender_id
                   AND ta.status = 'rejected')
             WHEN b.fmt = 'IR' THEN
               (SELECT array_agg(DISTINCT ti.team_id) FROM team_invitations ti
                 WHERE ti.invitee_id = b.sender_id AND ti.inviter_id = b.receiver_id
                   AND ti.status = 'declined')
           END AS src_teams
    FROM base b
    WHERE b.fmt IS NOT NULL
      AND NOT (b.raw_team ~ '^\\d+\\s*:')
      AND substring(b.content from
            CASE b.fmt
              WHEN 'F4' THEN '^📋\\s+Application declined:\\s+[^"]+\\s+for\\s+"([^"]+)":'
              WHEN 'RA' THEN '^📋\\s+Response to your application for "([^"]+)":'
              WHEN 'IR' THEN '^📋\\s+Response to your invitation for "([^"]+)":'
              WHEN 'YA' THEN '^📋\\s+Your application to "([^"]+)" was declined by'
            END) = b.raw_team
  ),
  decided AS (
    SELECT c.*,
           CASE
             WHEN c.name_teams = 1
              AND EXISTS (SELECT 1 FROM teams t
                           WHERE t.id = c.name_team_id AND t.created_at <= c.sent_at)
              AND CASE
                    WHEN c.fmt IN ('F4', 'RA', 'YA') THEN
                      EXISTS (SELECT 1 FROM team_applications ta
                               WHERE ta.team_id = c.name_team_id
                                 AND ta.applicant_id = c.receiver_id AND ta.status = 'rejected')
                    ELSE
                      EXISTS (SELECT 1 FROM team_invitations ti
                               WHERE ti.team_id = c.name_team_id AND ti.invitee_id = c.sender_id
                                 AND ti.inviter_id = c.receiver_id AND ti.status = 'declined')
                  END
              -- coalesce: without a source src_teams is NULL, and NOT (NULL AND …)
              -- is NULL, which would silently drop every row without one.
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
           left(d.content, d.q) || d.team_id::text || ':' || substr(d.content, d.q + 1) AS new_content
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

const addTeamIdsToClipboardProseDms = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(UPDATE_SQL);

    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `📋 prose team id migration would rewrite ${result.rowCount} rows, ` +
          `but only ${MAX_ROWS} can exist — rolled back. The rule is too wide.`,
      );
    }

    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `📋 prose team id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `📋 prose team id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "📋 prose team id migration: ⚠️ the count differs from the dry run — " +
          "re-run deletion-audit/63 and read why before trusting it.",
      );
    }
    console.log(
      "📋 prose team id migration: VERIFY with deletion-audit/63 — `eligible` " +
        "must now be 0. The migration runner's success message is not evidence; " +
        "it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding team ids to 📋 prose DMs (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addTeamIdsToClipboardProseDms;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
