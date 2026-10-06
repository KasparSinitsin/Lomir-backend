// The prose id backfill rewrites STORED MESSAGE TEXT, so its statements are
// pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order they would hurt:
//
//   1. The statements must insert after a FIXED LITERAL and never match the
//      person's name. A name-matching rewrite could mangle a name, reach into
//      the quoted personal message, or hit the wrong slot.
//   2. The 🎉 APPLICANT slot must never be touched: its sender is the
//      APPROVER, so an id written there is a different person's id, in a
//      stored row, permanently.
//   3. `\s` in a JS template literal is just `s` — the backslash is dropped
//      for an unknown escape. The SQL must therefore carry `\\s` in the
//      source, or it would match a literal "s" instead of whitespace and
//      silently skip every row with two spaces after the emoji.
//   4. Every statement must exclude rows that already carry a token, because
//      `index.js` re-runs every migration on every `npm run migrate`.
//   5. It must own a transaction and verify itself, because `index.js` catches
//      a module's error WITHOUT rethrowing, so a half-applied run is reported
//      as a successful one.
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// `userDeletion.namePrefixes.test.js` records what requiring such a module
// once cost — a `REFRESH MATERIALIZED VIEW` on the production database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src",
    "database",
    "migrations",
    "add_id_tokens_to_prose_events.js",
  ),
  "utf8",
);

const index = fs.readFileSync(
  path.join(__dirname, "..", "src", "database", "migrations", "index.js"),
  "utf8",
);

test("every statement inserts after a literal and never captures the name", () => {
  // the three anchors, as they appear in the regexp_replace calls
  for (const anchor of [
    "'^(👋\\\\s+)'",
    "'^(🎯\\\\s+)'",
    "'(added as a team member by )'",
  ]) {
    assert.ok(
      source.includes(anchor),
      `anchor ${anchor} is gone — has a statement started matching the name?`,
    );
  }

  // a name capture would look like `(.+?)` or `(.+)` inside a replace target
  assert.equal(
    /regexp_replace\([^)]*\(\.\+/.test(source),
    false,
    "a statement captures free text — it must only anchor on a literal",
  );
});

test("the 🎉 statement cannot reach the applicant slot", () => {
  const applause = source.slice(source.indexOf("🎉 approver"));
  assert.ok(
    applause.includes("'(added as a team member by )'"),
    "the approver anchor is gone",
  );
  assert.equal(
    applause.includes("'^(🎉"),
    false,
    "the 🎉 statement anchors at the START of the sentence, which is the " +
      "APPLICANT slot — that would write the approver's id onto the applicant",
  );
});

test("whitespace classes survive the template literal", () => {
  // ⚠️ Scoped to the SQL template literals. Checking the whole file would trip
  // over this file's own prose, which necessarily writes the broken form to
  // explain it — the first version of this test did exactly that.
  const literals = [...source.matchAll(/`([\s\S]*?)`/g)]
    .map((m) => m[1])
    .filter((t) => /UPDATE messages|SELECT count/.test(t));

  assert.equal(literals.length, 4, "expected three statements and one check");

  for (const sql of literals) {
    // `\\s` in source is what produces `\s` in SQL. A single backslash is
    // dropped by JS as an unknown escape, leaving a literal "s".
    const singleBackslashS = /(^|[^\\])\\s/.test(sql.replace(/\\\\/g, ""));
    assert.equal(
      singleBackslashS,
      false,
      "a single-backslash escape survives into the SQL and will be dropped:\n" +
        sql.trim().slice(0, 120),
    );
  }

  assert.ok(
    literals.some((sql) => sql.includes("\\\\s+")),
    "no whitespace class left at all — the statements would miss any row " +
      "with two spaces after the emoji",
  );
});

test("every statement refuses rows that already carry a token", () => {
  // ⚠️ Asserted PER STATEMENT, not as a total. The first version counted
  // guards across the file with `>= 3` and a mutation that deleted one guard
  // still passed, because the self-verification query carries three of its
  // own. A threshold over a whole file is not a guard on each statement.
  const statements = [...source.matchAll(/sql: `([\s\S]*?)`/g)].map((m) => m[1]);
  assert.equal(statements.length, 3, "expected exactly three statements");

  for (const sql of statements) {
    // ⚠️ `String.raw` on purpose. The file holds TWO backslashes (so that JS
    // yields one in the SQL), and a normal regex literal here would need four
    // — the same escaping trap this migration is guarded against, one level up.
    assert.ok(
      sql.includes(String.raw`\\d+\\s*:`),
      "a statement has no 'already tokenised' guard, so a second " +
        "`npm run migrate` would prepend a second id:\n" +
        sql.trim().slice(0, 140),
    );
  }
});

test("it owns a transaction and verifies its own result", () => {
  assert.ok(source.includes('client.query("BEGIN")'), "no transaction");
  assert.ok(source.includes('client.query("COMMIT")'), "never commits");
  assert.ok(source.includes('client.query("ROLLBACK")'), "never rolls back");
  assert.ok(
    source.includes("remaining"),
    "no self-verification — the runner's success message is not evidence",
  );
  assert.match(
    source,
    /if \(rows\[0\]\.remaining !== 0\)[\s\S]*throw new Error/,
    "leftover candidates must abort the transaction, not be logged and kept",
  );
});

test("it is registered, and the swallowing runner is documented where it is", () => {
  assert.match(
    index,
    /await addIdTokensToProseEvents\(\);/,
    "the migration is written but never runs",
  );
  assert.match(
    index,
    /does NOT rethrow/,
    "the catch that hides a failed migration is undocumented again",
  );
});
