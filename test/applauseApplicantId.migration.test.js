// The applicant-id migration rewrites STORED MESSAGE TEXT, and it re-runs on EVERY
// `npm run migrate`, so its rule is pinned here rather than trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. The id must come from the APPLICATION, found by the exact key
//      `(team_id, status = 'approved', reviewed_at = sent_at)`. The sender is no
//      route: `deletion-audit/24` found it is the applicant in only 203 of 289
//      rows. A migration that took `sender_id` would repeat BE #352 one slot over.
//   2. The key must require EXACTLY ONE application; two at the same instant are
//      ambiguous and must be left alone.
//   3. The APPROVER slot must never be written. BE #352/#353 own it, and the three
//      migrations are independent only because their guards read different slots.
//   4. A name that belongs to a DIFFERENT living user must be left alone, and a
//      row whose applicant is its own approver must be excluded.
//   5. Only the first slot may change: the token goes in front of the stored name,
//      right after the emoji.
//   6. `\s` in a JS template literal is just `s`. The SQL must carry `\\s`, or the
//      patterns would match a literal letter and touch nothing.
//   7. It must own a transaction, verify itself and refuse an impossible count,
//      because `index.js` catches a module's error WITHOUT rethrowing.
//   8. It must name its DRY RUN (`STATUS.md` habit 11).
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// requiring it would open a pool. Behaviour against real rows was checked on a
// throwaway postgres with `deletion-audit/fixtures/35-fixture.sql`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/add_applicant_id_to_applause_events.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));

test("the id comes from the application, found by the exact key", () => {
  assert.ok(sql.includes("ta.team_id = b.team_id"));
  assert.ok(sql.includes("ta.status = 'approved'"));
  assert.ok(sql.includes("ta.reviewed_at = b.sent_at"));
  assert.ok(sql.includes("min(ta.applicant_id) AS applicant_id"));
});

test("the sender is never used as the applicant", () => {
  assert.ok(!/sender_id/.test(sql), "the plan must not read messages.sender_id at all");
});

test("exactly one application must match", () => {
  assert.ok(sql.includes("WHERE r.n = 1"));
});

test("the approver slot is never written", () => {
  assert.ok(sql.includes("regexp_replace(r.content, '^🎉 ', '🎉 ' || r.applicant_id::text || ':')"));
  // the approver id is read only to refuse a self-approval
  assert.ok(sql.includes("r.applicant_id IS DISTINCT FROM r.approver_id"));
});

test("a name of a different living user, or a missing applicant, is left alone", () => {
  assert.ok(sql.includes("EXISTS (SELECT 1 FROM un WHERE un.id = r.applicant_id)"));
  assert.ok(sql.includes("= (SELECT un.name FROM un WHERE un.id = r.applicant_id)"));
  assert.ok(sql.includes("WHERE un.name = btrim(regexp_replace(r.slot"));
});

test("the population is untokenised team rows before the cutoff", () => {
  assert.ok(sql.includes("m.team_id IS NOT NULL"));
  assert.ok(sql.includes("m.sent_at < '2026-10-06'"));
  assert.ok(sql.includes("AND NOT (m.content ~ '^🎉 [0-9]+\\\\s*:')"));
});

test("it only rewrites a row that still reads as it was planned", () => {
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("regexes are written with doubled backslashes", () => {
  assert.ok(!/[^\\]\\s/.test(sql), "a single-backslash \\s would be read as a literal s");
  assert.ok(sql.includes("\\\\s+"));
});

test("it owns a transaction, verifies itself and refuses an impossible count", () => {
  assert.ok(source.includes('"BEGIN"'));
  assert.ok(source.includes('"COMMIT"'));
  assert.ok(source.includes('"ROLLBACK"'));
  assert.ok(source.includes("REMAINING_SQL"));
  assert.ok(source.includes("result.rowCount > MAX_ROWS"));
  assert.ok(source.includes("const MAX_ROWS = 289"));
  assert.ok(source.includes("const EXPECTED_ROWS = 276"));
});

test("it names its dry run", () => {
  assert.ok(source.includes("deletion-audit/35"));
});

test("it is registered, after the leave-row migration", () => {
  const a = index.indexOf("await addPersonIdToLegacyLeaveRows();");
  const b = index.indexOf("await addApplicantIdToApplauseEvents();");
  assert.ok(a !== -1 && b !== -1, "both migrations must be called");
  assert.ok(b > a);
});
