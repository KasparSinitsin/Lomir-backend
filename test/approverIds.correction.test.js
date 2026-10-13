// The approver-id correction rewrites STORED MESSAGE TEXT, so its statements are
// pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. The statements must anchor on a FIXED LITERAL and never read a name.
//      This whole correction exists because a premise about the data was taken
//      on trust; a name-matching rewrite would repeat the mistake one layer
//      down.
//   2. The applicant slot must be unreachable. The anchor sits after it, and
//      writing an id there is step 4's decision, not this migration's.
//   3. The two statements must be MUTUALLY EXCLUSIVE on `reviewed_by`. If both
//      could match one row, the second would rewrite what the first wrote.
//   4. The replace statement must refuse `reviewed_by = sender_id`, or it would
//      write the wrong id back over itself and report a row as corrected.
//   5. Each statement must require the slot to still carry the WRONG id, because
//      `index.js` re-runs every migration on every `npm run migrate`.
//   6. `\d` in a JS template literal is just `d`. The SQL must carry `\\d`, or
//      the pattern would match a literal "d" and the migration would silently
//      touch nothing.
//   7. It must own a transaction and verify itself, because `index.js` catches a
//      module's error WITHOUT rethrowing — a half-applied run reports success.
//   8. It must name its DRY RUN. `STATUS.md` habit 11 was earned by a migration
//      whose premise lived in prose and was never run as a query; a test is the
//      only way that requirement outlives the session that wrote it.
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// requiring it would open a pool.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "../src/database/migrations/fix_wrong_approver_ids_in_applause_events.js",
  ),
  "utf8",
);

const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

// The two UPDATE bodies, split so an assertion can speak about one of them.
const statements = source
  .split("name: ")
  .slice(1)
  .map((chunk) => chunk.slice(0, chunk.indexOf("`,")));

test("there are exactly two statements, and they are the ones expected", () => {
  assert.equal(statements.length, 2);
  assert.ok(statements[0].includes("replace-with-real-approver"));
  assert.ok(statements[1].includes("strip-the-token"));
});

test("both statements anchor on the literal and never read a name", () => {
  for (const s of statements) {
    assert.ok(
      s.includes("(added as a team member by )"),
      "the anchor must be the fixed literal, captured for re-insertion",
    );
    // No name column may appear anywhere in a statement.
    for (const forbidden of ["first_name", "last_name", "username", "lower("]) {
      assert.ok(
        !s.includes(forbidden),
        `a statement must not read ${forbidden} — the join is structural`,
      );
    }
  }
});

test("the applicant slot is unreachable", () => {
  for (const s of statements) {
    // The pattern must not be anchored at the start of the content, which is
    // where the applicant sits.
    assert.ok(
      !s.includes("'^(🎉"),
      "a replacement anchored at the start would hit the applicant slot",
    );
    assert.ok(
      s.indexOf("regexp_replace") < s.indexOf("added as a team member by "),
      "the replacement must target the approver anchor",
    );
  }
});

test("the two statements are mutually exclusive on reviewed_by", () => {
  assert.ok(
    statements[0].includes("ta.reviewed_by IS NOT NULL"),
    "the replace statement must require a known reviewer",
  );
  assert.ok(
    statements[1].includes("ta.reviewed_by IS NULL"),
    "the strip statement must require an unknown reviewer",
  );
  assert.ok(
    !statements[1].includes("IS NOT NULL"),
    "the strip statement must not also accept a known reviewer",
  );
});

test("the replace statement refuses to write the sender's own id back", () => {
  assert.ok(
    statements[0].includes("ta.reviewed_by <> m.sender_id"),
    "without this a row whose recorded reviewer IS the applicant would be " +
      "rewritten with the same wrong id and counted as corrected",
  );
});

test("every statement refuses rows that no longer carry the wrong id", () => {
  for (const s of statements) {
    assert.ok(
      s.includes("('added as a team member by ' || m.sender_id::text || ':')"),
      "the idempotence guard must require the sender's id to still be there",
    );
  }
});

test("the join is the discriminator, and it is structural", () => {
  for (const s of statements) {
    assert.ok(s.includes("ta.applicant_id = m.sender_id"));
    assert.ok(s.includes("ta.status       = 'approved'"));
    assert.ok(
      s.includes("ta.reviewed_at  = m.sent_at"),
      "the timestamp half is what picks WHICH application, and what rejects " +
        "an approver who had also applied to the same team",
    );
  }
});

test("digit classes survive the template literal", () => {
  // `\d` would be dropped to `d` by the template literal. Both statements and
  // the self-check must carry the doubled form in the source.
  assert.ok(!/[^\\]\\d/.test(source), "found a single-escaped \\d in the source");
  assert.equal((source.match(/\\\\d\+/g) || []).length >= 3, true);
});

test("it owns a transaction and verifies its own result", () => {
  assert.ok(source.includes('client.query("BEGIN")'));
  assert.ok(source.includes('client.query("COMMIT")'));
  assert.ok(source.includes('client.query("ROLLBACK")'));
  assert.ok(
    source.includes("REMAINING_SQL"),
    "it must re-count the candidates after writing",
  );
  assert.ok(
    source.includes("rows[0].remaining !== 0"),
    "a leftover must throw, so the transaction rolls back",
  );
  assert.ok(
    source.includes("throw error"),
    "the catch must rethrow, or the runner cannot see the failure either",
  );
});

test("the self-check covers BOTH reviewed_by branches", () => {
  const remaining = source.slice(source.indexOf("const REMAINING_SQL"));
  const body = remaining.slice(0, remaining.indexOf("`;"));
  assert.ok(
    body.includes("ta.reviewed_by IS NULL OR ta.reviewed_by <> m.sender_id"),
    "a self-check that only counted one branch would pass while the other " +
      "statement had left rows behind",
  );
});

test("it names its dry run and its measurement — habit 11", () => {
  assert.ok(
    source.includes("deletion-audit/26"),
    "the dry run must be named in the module, or the next reader cannot tell " +
      "whether the premise was ever run as a query",
  );
  assert.ok(
    source.includes("deletion-audit/24"),
    "the measurement that falsified BE #352's premise must be named",
  );
  assert.ok(
    source.includes("195") && source.includes("18"),
    "the expected counts must be the dry run's, so a mismatch at run time is " +
      "visible in the log",
  );
});

test("it is registered, after the backfill it corrects", () => {
  assert.ok(index.includes("fix_wrong_approver_ids_in_applause_events"));
  assert.ok(
    index.indexOf("await addIdTokensToProseEvents()") <
      index.indexOf("await fixWrongApproverIdsInApplauseEvents()"),
    "it recognises a row by the wrong id being present, so it must run after " +
      "the migration that writes that id",
  );
  assert.ok(
    index.includes("deletion-audit/24"),
    "the runner should say why this correction exists where it is called",
  );
});
