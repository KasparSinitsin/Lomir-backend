const db = require("../../config/database");

/**
 * Corrects the id that `add_id_tokens_to_prose_events.js` (BE #352) wrote into
 * the APPROVER slot of the 🎉 application-approved event.
 *
 * 🔴 **What went wrong.** That migration inserts `messages.sender_id` after the
 * literal `added as a team member by `, on the premise stated in its own header:
 * "its sender is the APPROVER, so an id written there would be a different
 * person's". The premise was never run as a query. `deletion-audit/24` measured
 * it on 2026-10-07: it holds for **65** of 289 rows, and for **203** the sender
 * is the APPLICANT. Those banners now assert, with an id that survives every
 * rename, that an applicant approved her own application — and the real
 * approver's name, still present in the stored text, is no longer read by any
 * display path.
 *
 * ⚠️ `deletion-audit/23` did prove something against production: that statement
 * 3's anchor cannot reach the applicant slot. Correct work, and beside the
 * point. `STATUS.md` habit 11 exists because of this.
 *
 * 🟢 **This correction needs no name match.** The join IS the discriminator:
 *
 *     ta.team_id = m.team_id AND ta.applicant_id = m.sender_id
 *     AND ta.status = 'approved' AND ta.reviewed_at = m.sent_at
 *
 *   - `applicant_id = sender_id` is what makes a row damaged. On a healthy row
 *     the sender IS the approver, so the applicant is somebody else and the join
 *     does not match. **The 65 healthy rows exclude themselves.**
 *   - `reviewed_at = sent_at` picks WHICH application, and rejects the case the
 *     name route could not see: an approver who had also applied to that team at
 *     some other time.
 *
 *     `teamApplicationsController` opens a transaction (:708) and runs both the
 *     `UPDATE … reviewed_at = NOW()` (:771) and the message `INSERT … NOW()`
 *     (:813) inside it. `NOW()` is the TRANSACTION timestamp, so the two are
 *     equal by construction. ⚠️ That is today's writer; these rows are older, so
 *     `deletion-audit/25` section E measured the equality on the 193 rows whose
 *     link was already certain: **190 exact, 0 in a near-miss band** — the shape
 *     a shared transaction produces, which is what promoted it to a key.
 *
 * ✅ **Dry run: `deletion-audit/26`, against production 2026-10-07.** Its premise
 * section — the one BE #352 lacked — reported all four counters at 0: no
 * ambiguous join, `reviewed_by` never the sender, no guard leak, nothing already
 * correct. The length arithmetic and the anchor checks were 0 as well. It planned
 * **195 + 18 = 213** rows.
 *
 * ⚠️ **213, not the 203 that `24` counted, and the difference is understood:**
 * `26` joins on columns where `24` compared names, so it also reaches rows whose
 * stored name no longer matches anybody because the person was renamed — `24`
 * called 16 of those undecidable. +10 is inside that bound and in the predicted
 * direction. **The expected counts below are `26`'s, not `24`'s.**
 *
 * 🔴 **NOT in scope: the APPLICANT slot.** For these rows `sender_id` IS the
 * applicant, so writing it there is both possible and correct — and it is step 4
 * of *Finishing the name bug*, a separate decision. One migration doing two jobs
 * means a revert undoes both.
 *
 * 🟢 **Idempotent by guard**, like #352: each statement requires the slot to
 * still carry the WRONG id (`sender_id`), so a second run matches nothing. That
 * matters more than usual, because `src/database/migrations/index.js` catches a
 * module's error and does NOT rethrow — `migrate.js` prints success even after a
 * failure. **The only honest way to read the outcome is to re-run
 * `deletion-audit/26`: `total_rows_touched` must then be 0.**
 */

// ⚠️ `\\s` and `\\d` in the JS source: in a template literal `\s` is just `s`,
// the backslash being dropped for an unknown escape — the SQL would then match a
// literal "s". The same trap is documented in #352.
const STATEMENTS = [
  {
    name: "replace-with-real-approver",
    expected: 195,
    sql: `
      UPDATE messages m
      SET content = regexp_replace(
            m.content,
            '(added as a team member by )\\d+:',
            '\\1' || ta.reviewed_by::text || ':')
      FROM team_applications ta
      WHERE ta.team_id      = m.team_id
        AND ta.applicant_id = m.sender_id
        AND ta.status       = 'approved'
        AND ta.reviewed_at  = m.sent_at
        AND ta.reviewed_by IS NOT NULL
        AND ta.reviewed_by <> m.sender_id
        AND m.content ~ '^🎉 .+ added as a team member by \\d+:.+\\. Say hello to them!'
        AND m.content ~ ('added as a team member by ' || m.sender_id::text || ':')
    `,
  },
  {
    // Where the approver was deleted, `userDeletionController.js:801` nulled
    // `reviewed_by` and the truth is gone. Removing the token returns the slot
    // to its pre-#352 state: a stale name, which is what every un-migrated
    // prose row still shows. That is the honest option, not a lesser one —
    // leaving a knowingly wrong id in place would be worse.
    name: "strip-the-token",
    expected: 18,
    sql: `
      UPDATE messages m
      SET content = regexp_replace(
            m.content, '(added as a team member by )\\d+:', '\\1')
      FROM team_applications ta
      WHERE ta.team_id      = m.team_id
        AND ta.applicant_id = m.sender_id
        AND ta.status       = 'approved'
        AND ta.reviewed_at  = m.sent_at
        AND ta.reviewed_by IS NULL
        AND m.content ~ '^🎉 .+ added as a team member by \\d+:.+\\. Say hello to them!'
        AND m.content ~ ('added as a team member by ' || m.sender_id::text || ':')
    `,
  },
];

// The same condition as the two statements, with neither reviewed_by branch, so
// it counts every row that still needs correcting after they have run.
const REMAINING_SQL = `
  SELECT count(*)::int AS remaining
  FROM messages m
  JOIN team_applications ta
        ON ta.team_id      = m.team_id
       AND ta.applicant_id = m.sender_id
       AND ta.status       = 'approved'
       AND ta.reviewed_at  = m.sent_at
  WHERE m.content ~ '^🎉 .+ added as a team member by \\d+:.+\\. Say hello to them!'
    AND m.content ~ ('added as a team member by ' || m.sender_id::text || ':')
    AND (ta.reviewed_by IS NULL OR ta.reviewed_by <> m.sender_id)
`;

const fixWrongApproverIdsInApplauseEvents = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    let total = 0;
    const counts = [];

    for (const statement of STATEMENTS) {
      const result = await client.query(statement.sql);
      counts.push(
        `${statement.name}: ${result.rowCount} (dry run planned ${statement.expected})`,
      );
      total += result.rowCount;
    }

    // 🔴 The module verifies its OWN result, because the runner's success
    // message cannot be trusted. A leftover means a statement and its guard
    // disagree, and the transaction is rolled back rather than half-applied.
    const { rows } = await client.query(REMAINING_SQL);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `approver id correction left ${rows[0].remaining} candidate rows behind — ` +
          "rolled back. A statement and its guard disagree.",
      );
    }

    await client.query("COMMIT");

    console.log("approver id correction: " + counts.join(", "));
    console.log(
      `approver id correction: ${total} rows rewritten, 0 candidates left`,
    );
    console.log(
      "approver id correction: VERIFY with deletion-audit/26 — " +
        "total_rows_touched must now be 0, and unreachable must be unchanged " +
        "at ~74. The migration runner's success message is not evidence; it " +
        "swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "Error correcting wrong approver ids (rolled back):",
      error,
    );
    throw error;
  } finally {
    client.release();
  }
};

module.exports = fixWrongApproverIdsInApplauseEvents;
module.exports.STATEMENTS = STATEMENTS;
module.exports.REMAINING_SQL = REMAINING_SQL;
