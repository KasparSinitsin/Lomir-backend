const db = require("../../config/database");

/**
 * Writes `<userId>:` in front of the person named by the three PROSE event
 * formats whose sender IS that person, so the chat can resolve the CURRENT
 * name at display time instead of showing the one frozen when the row was
 * written.
 *
 * 🔴 **Why these rows exist at all.** Until BE #351 (2026-10-06) the writers
 * emitted a bare name. A rename never reached the banner — a walk found a
 * `👋` row reading "Alice Jones" for somebody called "Alicja Stephanie Beurer"
 * today — and a deletion could only be handled by rewriting stored text, which
 * is why the message scrub exists. FE #664 made all four render paths resolve
 * from an id; this backfills the id into the rows that predate the writers.
 *
 * ⚠️ **Measured before it was written, not after.** `deletion-audit/22`
 * section A: **436** slots have their person's id already in the row as
 * `messages.sender_id` — `👋` 132, `🎯` 20, `🎉` approver 284.
 * `deletion-audit/23` is the dry run and derived the same 436 through different
 * conditions, with every row's `length()` delta equal to the token and every
 * rewritten row matching the FRONTEND parser's own patterns.
 *
 * 🟢 **The method is an insertion after a FIXED LITERAL, never a name match.**
 * A name-matching rewrite could mangle a name, reach into the quoted personal
 * message, or hit the wrong slot. These statements never read the name:
 *
 *     `^👋\s+`                        — the invitee is the first thing after it
 *     `^🎯\s+`                        — likewise
 *     `added as a team member by `    — the approver follows this, once
 *
 * 🔴 **The 🎉 APPLICANT slot must never be touched.** Its sender is the
 * APPROVER, so an id written there would be a different person's. The anchor
 * sits after the applicant, so statement 3 cannot reach it, and `23` section D
 * proves that against production rather than asserting it.
 *
 * 🟢 **Idempotent by guard.** Each statement excludes rows whose slot already
 * begins with `<digits>:`, so a second run touches nothing. That matters more
 * than usual here: `src/database/migrations.js` catches a module's error and
 * does NOT rethrow, so `migrate.js` prints "Migration completed successfully"
 * even after a failure. A partial run therefore looks like a clean one, and the
 * only honest way to read the outcome is to re-run `deletion-audit/22` —
 * `already_done` must be 436 and `migratable_by_sender` 0.
 *
 * 🟢 **One transaction**, so a failure half-way leaves nothing behind for the
 * swallowed error to hide.
 *
 * ⚠️ **The deletion scrub still works afterwards and was checked, not assumed.**
 * It replaces the departed person's name as a substring
 * (`userDeletionController.js`, `REPLACE(content, $2, $3)` over
 * `SCRUB_PROSE_EMOJI_PREFIXES`). The name stays in the text verbatim — only a
 * token is prepended — so the replacement still matches, and a scrubbed row
 * reads `👋 157:Former Lomir User joined the team!`, which the parser splits
 * into a deleted person either way. 🟢 After this runs the scrub is in fact
 * redundant for these rows: the id resolves the deletion at display time.
 */

// ⚠️ `\\s` in the JS source, because `\s` in a template literal is just `s` —
// the backslash is dropped for an unknown escape, and the SQL would then match
// a literal "s" instead of whitespace.
const STATEMENTS = [
  {
    name: "👋 joined",
    expected: 132,
    sql: `
      UPDATE messages m
      SET content = regexp_replace(
            m.content, '^(👋\\s+)', '\\1' || m.sender_id::text || ':')
      FROM users u
      WHERE u.id = m.sender_id
        AND m.content ~ '^👋\\s+'
        AND m.content !~ '^👋\\s+\\d+\\s*:'
    `,
  },
  {
    name: "🎯 assigned / accepted",
    expected: 20,
    sql: `
      UPDATE messages m
      SET content = regexp_replace(
            m.content, '^(🎯\\s+)', '\\1' || m.sender_id::text || ':')
      FROM users u
      WHERE u.id = m.sender_id
        AND m.content ~ '^🎯\\s+'
        AND m.content !~ '^🎯\\s+\\d+\\s*:'
    `,
  },
  {
    name: "🎉 approver",
    expected: 284,
    sql: `
      UPDATE messages m
      SET content = regexp_replace(
            m.content, '(added as a team member by )',
            '\\1' || m.sender_id::text || ':')
      FROM users u
      WHERE u.id = m.sender_id
        AND m.content ~ '^🎉 .+ added as a team member by .+\\. Say hello to them!'
        AND m.content !~ 'added as a team member by \\d+\\s*:'
    `,
  },
];

const addIdTokensToProseEvents = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    let total = 0;
    const counts = [];

    for (const statement of STATEMENTS) {
      const result = await client.query(statement.sql);
      counts.push(`${statement.name}: ${result.rowCount} (expected ~${statement.expected})`);
      total += result.rowCount;
    }

    // 🔴 The module verifies its OWN result, because the runner's success
    // message cannot be trusted. A leftover here means a guard and a statement
    // disagree, and the transaction is rolled back rather than half-applied.
    const { rows } = await client.query(`
      SELECT count(*)::int AS remaining
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE (m.content ~ '^👋\\s+'  AND m.content !~ '^👋\\s+\\d+\\s*:')
         OR (m.content ~ '^🎯\\s+'  AND m.content !~ '^🎯\\s+\\d+\\s*:')
         OR (m.content ~ '^🎉 .+ added as a team member by .+\\. Say hello to them!'
             AND m.content !~ 'added as a team member by \\d+\\s*:')
    `);

    if (rows[0].remaining !== 0) {
      throw new Error(
        `prose id backfill left ${rows[0].remaining} candidate rows behind — ` +
          "rolled back. A statement and its guard disagree.",
      );
    }

    await client.query("COMMIT");

    console.log("prose event id backfill: " + counts.join(", "));
    console.log(`prose event id backfill: ${total} rows rewritten, 0 candidates left`);
    console.log(
      "prose event id backfill: VERIFY with deletion-audit/22 — already_done " +
        "must be 436 and migratable_by_sender 0. The migration runner's " +
        "success message is not evidence; it swallows errors.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error backfilling prose event ids (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = addIdTokensToProseEvents;
