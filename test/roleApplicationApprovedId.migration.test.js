// The role-application-approved id migration rewrites STORED MESSAGE TEXT, and it
// re-runs on EVERY `npm run migrate`, so its rule is pinned here rather than
// trusted to review.
//
// 🔴 Why each assertion exists, in the order it would hurt:
//
//   1. The id must come from the APPLICATION found by the exact key
//      `(team_id, status = 'approved', reviewed_at = sent_at)`, and the sender must
//      AGREE with it. No backend writer for this sentence exists, so "the sender is
//      the applicant" is a premise from the data, and `deletion-audit/38` found it
//      FALSE for one row. A migration that wrote `sender_id` would repeat BE #352.
//   2. The key must require EXACTLY ONE application.
//   3. Only the person slot may change: the id is PREPENDED to the whole content and
//      nothing else moves. The role slot has no id to give.
//   4. A name that belongs to a DIFFERENT living user, or an applicant that no
//      longer exists, must be left alone.
//   5. There must be a DATE CUT, because the migration re-runs.
//   6. `\s` in a JS template literal is just `s`. The SQL must carry `\\s`, or the
//      patterns would match a literal letter and touch nothing.
//   7. It must own a transaction, verify itself and refuse an impossible count,
//      because `index.js` catches a module's error WITHOUT rethrowing.
//   8. It must name its DRY RUN (`STATUS.md` habit 11).
//
// ⚠️ Read as TEXT, never required: the module imports the database config, and
// requiring it would open a pool. Behaviour against real rows was checked on a
// throwaway postgres with `deletion-audit/fixtures/38-fixture.sql`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "../src/database/migrations/add_applicant_id_to_role_application_approved_rows.js",
  ),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

const sql = source.slice(source.indexOf("const SHAPE"), source.indexOf("const UPDATE_SQL"));

test("the id comes from the application, found by the exact key", () => {
  assert.ok(sql.includes("ta.team_id = b.team_id"));
  assert.ok(sql.includes("ta.status = 'approved'"));
  assert.ok(sql.includes("ta.reviewed_at = b.sent_at"));
  assert.ok(sql.includes("min(ta.applicant_id) AS applicant_id"));
});

test("the sender must agree with the application, and be present", () => {
  assert.ok(sql.includes("r.sender_id IS NOT NULL"));
  assert.ok(sql.includes("AND r.applicant_id = r.sender_id"));
});

test("an application reviewed by its own applicant is never used", () => {
  // Julia, 2026-10-07: there is no approval of one's own application.
  assert.ok(sql.includes("bool_or(ta.reviewed_by = ta.applicant_id) AS self_reviewed"));
  assert.ok(sql.includes("AND NOT coalesce(r.self_reviewed, false)"));
});

test("exactly one application must match", () => {
  assert.ok(sql.includes("WHERE r.n = 1"));
});

test("only an id is prepended, to the whole content", () => {
  assert.ok(sql.includes("r.applicant_id::text || ':' || r.content AS new_content"));
});

test("a name of a different living user, or a missing applicant, is left alone", () => {
  assert.ok(sql.includes("EXISTS (SELECT 1 FROM un WHERE un.id = r.applicant_id)"));
  assert.ok(sql.includes("r.slot = (SELECT un.name FROM un WHERE un.id = r.applicant_id)"));
  assert.ok(sql.includes("(SELECT count(*) FROM un WHERE un.name = r.slot) = 0"));
});

test("the population is untokenised team messages before the cutoff", () => {
  assert.ok(sql.includes("m.team_id IS NOT NULL"));
  assert.ok(sql.includes("m.sent_at < '2026-06-01'"));
  assert.ok(sql.includes("AND NOT (m.content ~ $re$^\\\\d+\\\\s*:$re$)"));
});

test("both apostrophes and the optional full stop are accepted", () => {
  assert.ok(sql.includes("['’]s application for .+ was approved\\\\.?"));
});

test("it only rewrites a row that still reads as it was planned", () => {
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("regexes are written with doubled backslashes", () => {
  assert.ok(!/[^\\]\\s/.test(sql), "a single-backslash \\s would be read as a literal s");
  assert.ok(!/[^\\]\\d/.test(sql), "a single-backslash \\d would be read as a literal d");
  assert.ok(sql.includes("\\\\s+"));
});

test("it owns a transaction, verifies itself and refuses an impossible count", () => {
  assert.ok(source.includes('"BEGIN"'));
  assert.ok(source.includes('"COMMIT"'));
  assert.ok(source.includes('"ROLLBACK"'));
  assert.ok(source.includes("REMAINING_SQL"));
  assert.ok(source.includes("result.rowCount > MAX_ROWS"));
  assert.ok(source.includes("const MAX_ROWS = 22"));
  assert.ok(source.includes("const EXPECTED_ROWS = 20"));
});

test("it names its dry run", () => {
  assert.ok(source.includes("deletion-audit/38"));
});

test("it is registered, after the applause migration", () => {
  const a = index.indexOf("await addApplicantIdToApplauseEvents();");
  const b = index.indexOf("await addApplicantIdToRoleApplicationApprovedRows();");
  assert.ok(a !== -1 && b !== -1, "both migrations must be called");
  assert.ok(b > a);
});
