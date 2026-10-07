const db = require("../../config/database");

/**
 * Writes the two person ids into the 171 direct messages that eight marker
 * formats stored BEFORE they carried id tokens (4–14 January 2026).
 *
 * 🔴 **Why it exists.** A name stored without an id goes stale on the first
 * rename, and a stale slot also breaks PERSPECTIVE: `isViewerPerson` falls back
 * to comparing the stored name with the viewer's CURRENT one, so a person who
 * renamed is told about herself in the third person. The frontend already reads
 * the tokens of all eight formats (`parseIdNameToken` on each slot), so adding
 * the id fixes both without a parser change.
 *
 * 🟢 **What it writes, and what it keeps.** Only `<id>:` is put in front of the
 * two person slots. The stored name stays after the colon as the fallback, so
 * nothing already readable becomes less readable.
 *
 * ⚠️ **The premise, and how it was tested rather than assumed**
 * (`STATUS.md` habit 11 — BE #352 failed on a premise nobody ran):
 *
 *   PREMISE: in each of the eight formats the SENDER and the RECEIVER of the DM
 *   are two of the named people, and the slot is fixed per format — slot 2 is the
 *   sender and slot 3 the receiver, except INVITATION_DECLINED, where slot 2 is
 *   the receiver and slot 3 the sender.
 *
 *   - Writer code, at 9eec403 (2026-01-13, the commit before the tokens): every
 *     one of the eight inserts `[userId, <other party>, message]`.
 *     ⚠️ Rows from 4–12 January may predate that commit.
 *   - `deletion-audit/29`: of 342 person slots, 282 equal the CURRENT name of the
 *     sender or receiver, 57 match no living user (a rename), 3 match ONE OTHER
 *     living user.
 *   - `deletion-audit/30`: where a persisted second source exists
 *     (`team_applications.reviewed_by`, `team_invitations`) it agreed for every
 *     row but one. `31` shows that one is most likely a later review overwriting
 *     the record (9 days after the DM), not a wrong sender — it stays excluded.
 *   - 86 rows (ROLE_CHANGED, MEMBER_REMOVED, OWNERSHIP_TRANSFERRED,
 *     APPLICATION_CANCELLED) have NO second source. Their evidence is the writer
 *     code and the name agreement above, and nothing else.
 *
 * ✅ **Dry run: `deletion-audit/32`, against production 2026-10-07.** 171 rows,
 * **167 eligible**, dropped exactly as predicted (3 ambiguous, 1 refuted; 0 for
 * slot count, null ids or round trip). The after-state held for all 167, and 0
 * untokenised rows of these formats exist after the cutoff. 53 of the 167
 * repair a stale name.
 *
 * THE RULE. A row is rewritten only if ALL hold:
 *   1  it is a DM (`team_id IS NULL`) of one of the eight formats, untokenised,
 *      and sent before 2026-01-15
 *   2  it has the expected number of slots
 *   3  `sender_id` and `receiver_id` are both set
 *   4  each of the two person slots EITHER equals the assigned user's current
 *      name OR matches no living user. A slot that matches a DIFFERENT living
 *      user is left alone.
 *   5  no persisted second source refutes it
 *   6  `head || slots joined by ' | '` reproduces the stored content EXACTLY, so
 *      the rewrite cannot change a byte it did not mean to
 *
 * 🟢 **Rule 1's `team_id IS NULL` is the one difference from `32`.** The dry run
 * did not require it; all 171 rows are DMs (`29` section B), so it cannot change
 * the 167, and it can only narrow what a stray team-chat message that begins
 * with one of these prefixes would do.
 *
 * 🟢 **Idempotent by guard.** The population is the UNTOKENISED rows, and a
 * rewritten row is tokenised, so a second run finds nothing. The date cut is
 * closed (0 untokenised rows of these formats after 2026-01-14), so the
 * population can only shrink.
 *
 * 🔴 **Verified by itself.** `src/database/migrations/index.js` catches a
 * module's error and does NOT rethrow, so the runner's success message is not
 * evidence. This module owns its transaction, re-runs the rule after writing and
 * rolls back unless nothing is left, and refuses a count above the 171 that can
 * exist. The honest check is still to re-run `deletion-audit/32`: `eligible`
 * must then be 0.
 */

// [prefix, number of slots, slot that holds the SENDER]. The receiver is the
// other person slot, 5 − sender_slot. ⚠️ The prefixes are asserted against
// `nameBearingMessageFormats.js` in the test, because a glyph written without
// its variation selector looks identical and matches nothing.
const FORMATS = [
  ["🔄 ROLE_CHANGED:", 5, 2],
  ["✅ APPLICATION_APPROVED:", 4, 2],
  ["🚫 APPLICATION_DECLINED:", 4, 2],
  ["🚫 INVITATION_DECLINED:", 4, 3],
  ["🚫 INVITATION_CANCELLED:", 3, 2],
  ["🚫 MEMBER_REMOVED:", 3, 2],
  ["👑 OWNERSHIP_TRANSFERRED:", 3, 2],
  ["🚫 APPLICATION_CANCELLED:", 3, 2],
];

const EXPECTED_ROWS = 167; // `deletion-audit/32`
const MAX_ROWS = 171; // the whole population in `29`; a larger count is a bug

const FORMATS_VALUES = FORMATS.map(
  ([prefix, slots, senderSlot]) => `('${prefix}', ${slots}, ${senderSlot})`,
).join(",\n         ");

// ⚠️ `\\s` and `\\d` in the JS source: in a template literal `\s` is just `s`,
// the backslash being dropped for an unknown escape — the SQL would then match a
// literal "s". The same trap is documented in #352 and #353.
const PLAN_CTE = `
  WITH formats(prefix, n_slots, sender_slot) AS (
    VALUES ${FORMATS_VALUES}
  ),
  un AS (
    SELECT u.id,
           btrim(regexp_replace(array_to_string(array_remove(
             ARRAY[nullif(u.first_name, ''), nullif(u.last_name, '')], NULL), ' '),
             '\\s+', ' ', 'g')) AS name
    FROM users u
  ),
  raw AS (
    SELECT m.id, m.content, m.sender_id, m.receiver_id,
           f.prefix, f.n_slots, f.sender_slot,
           substring(m.content from '^[^:]*:\\s*') AS head,
           regexp_split_to_array(
             regexp_replace(m.content, '^[^:]*:\\s*', ''), '\\s+\\|\\s+') AS slots
    FROM formats f
    JOIN messages m ON m.content LIKE f.prefix || '%'
    WHERE m.team_id IS NULL
      AND m.sent_at < '2026-01-15'
      AND NOT (regexp_replace(m.content, '^[^:]*:\\s*', '') ~ '(^|\\|\\s*)\\d+\\s*:')
  ),
  picked AS (
    SELECT r.*,
           btrim(regexp_replace(
             CASE WHEN r.sender_slot = 2 THEN r.slots[2] ELSE r.slots[3] END,
             '\\s+', ' ', 'g')) AS sender_txt,
           btrim(regexp_replace(
             CASE WHEN r.sender_slot = 2 THEN r.slots[3] ELSE r.slots[2] END,
             '\\s+', ' ', 'g')) AS receiver_txt
    FROM raw r
  ),
  plan AS (
    SELECT p.id, p.content,
           p.head || (
             SELECT string_agg(
                      CASE WHEN s.ord = p.sender_slot     THEN p.sender_id::text   || ':' || s.val
                           WHEN s.ord = 5 - p.sender_slot THEN p.receiver_id::text || ':' || s.val
                           ELSE s.val END,
                      ' | ' ORDER BY s.ord)
             FROM unnest(p.slots) WITH ORDINALITY AS s(val, ord)
           ) AS new_content
    FROM picked p
    WHERE cardinality(p.slots) = p.n_slots
      AND p.sender_id IS NOT NULL
      AND p.receiver_id IS NOT NULL
      AND (p.sender_txt = (SELECT un.name FROM un WHERE un.id = p.sender_id)
           OR (SELECT count(*) FROM un WHERE un.name = p.sender_txt) = 0)
      AND (p.receiver_txt = (SELECT un.name FROM un WHERE un.id = p.receiver_id)
           OR (SELECT count(*) FROM un WHERE un.name = p.receiver_txt) = 0)
      AND NOT CASE
        WHEN p.prefix LIKE '%APPLICATION_APPROVED:' OR p.prefix LIKE '%APPLICATION_DECLINED:' THEN
          EXISTS (SELECT 1 FROM teams t
                    JOIN team_applications ta ON ta.team_id = t.id
                   WHERE btrim(regexp_replace(t.name, '\\s+', ' ', 'g'))
                         = btrim(regexp_replace(p.slots[1], '\\s+', ' ', 'g'))
                     AND ta.applicant_id = p.receiver_id
                     AND ta.status = CASE WHEN p.prefix LIKE '%APPROVED:' THEN 'approved' ELSE 'rejected' END
                     AND ta.reviewed_by IS NOT NULL AND ta.reviewed_by <> p.sender_id)
        WHEN p.prefix LIKE '%INVITATION_DECLINED:' THEN
          EXISTS (SELECT 1 FROM teams t
                    JOIN team_invitations ti ON ti.team_id = t.id
                   WHERE btrim(regexp_replace(t.name, '\\s+', ' ', 'g'))
                         = btrim(regexp_replace(p.slots[1], '\\s+', ' ', 'g'))
                     AND ti.invitee_id = p.sender_id AND ti.status = 'declined'
                     AND ti.inviter_id <> p.receiver_id)
        ELSE false
      END
      AND p.head || array_to_string(p.slots, ' | ') = p.content
  )
`;

const UPDATE_SQL = `${PLAN_CTE}
  UPDATE messages m
  SET content = plan.new_content
  FROM plan
  WHERE m.id = plan.id
    AND m.content = plan.content
`;

// The same plan, counted AFTER the update: every eligible row is tokenised by
// then, so a non-zero count means the statement and its own rule disagree.
const REMAINING_SQL = `${PLAN_CTE}
  SELECT count(*)::int AS remaining FROM plan
`;

const addPersonIdsToLegacyMarkerDms = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(UPDATE_SQL);

    if (result.rowCount > MAX_ROWS) {
      throw new Error(
        `legacy marker id migration would rewrite ${result.rowCount} rows, ` +
          `but only ${MAX_ROWS} can exist — rolled back. The rule is too wide.`,
      );
    }

    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `legacy marker id migration left ${rows[0].remaining} eligible rows ` +
          "behind — rolled back. The statement and its rule disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `legacy marker id migration: ${result.rowCount} rows rewritten ` +
        `(dry run planned ${EXPECTED_ROWS}), 0 eligible left`,
    );
    if (result.rowCount !== 0 && result.rowCount !== EXPECTED_ROWS) {
      console.log(
        "legacy marker id migration: ⚠️ the count differs from the dry run — " +
          "re-run deletion-audit/32 and read why before trusting it.",
      );
    }
    console.log(
      "legacy marker id migration: VERIFY with deletion-audit/32 — `eligible` " +
        "must now be 0. The migration runner's success message is not " +
        "evidence; it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error adding person ids to legacy marker DMs (rolled back):",
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addPersonIdsToLegacyMarkerDms;
module.exports.FORMATS = FORMATS;
module.exports.UPDATE_SQL = UPDATE_SQL;
module.exports.REMAINING_SQL = REMAINING_SQL;
module.exports.EXPECTED_ROWS = EXPECTED_ROWS;
module.exports.MAX_ROWS = MAX_ROWS;
