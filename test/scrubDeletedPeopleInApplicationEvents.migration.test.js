// Read as text: importing a migration would initialise the application DB pool.
// The two-run behaviour (churn ends) is exercised by deletion-audit/fixtures/54 on a
// disposable PostgreSQL database with synthetic rows, never production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "../src/database/migrations", name), "utf8");
const source = read("scrub_deleted_people_in_application_events.js");
const prose = read("add_id_tokens_to_prose_events.js");
const index = read("index.js");
const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));

test("approver: deletion is proven by the application, not by a name", () => {
  for (const clause of [
    "'^(🎉 .+ added as a team member by )(.+?)(\\\\. Say hello to them!)$'",
    "ta.team_id = m.team_id AND ta.applicant_id = m.sender_id",
    "ta.status = 'approved' AND ta.reviewed_at = m.sent_at",
    "ta.reviewed_by IS NULL",
  ]) assert.ok(sql.includes(clause), clause);
});

test("applicant: only a 4A line without sender", () => {
  assert.ok(sql.includes("[’'']s application for .+ was approved\\\\.?)$'"));
  assert.ok(sql.includes("m.team_id IS NOT NULL"));
  assert.ok(sql.includes("m.sender_id IS NULL"));
});

test("a token, the placeholder or any living user's display name or username is left alone", () => {
  assert.ok(sql.includes("NOT (c.name_raw ~ '^\\\\d+\\\\s*:')"));
  assert.ok(sql.includes("<> '${DELETED_USER_DISPLAY_NAME}'"));
  assert.ok(sql.includes("u.username) AS name"));
  assert.ok(sql.includes("AND NOT EXISTS (SELECT 1 FROM un WHERE un.name ="));
});

test("only the name becomes the placeholder; the rest round-trips", () => {
  assert.ok(sql.includes("c.head || '${DELETED_USER_DISPLAY_NAME}' || c.tail AS new_content"));
  assert.ok(sql.includes("c.head || c.name_raw || c.tail = c.content"));
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("#352 skips a placeholder approver in its statement AND in its self-check", () => {
  const guard = "AND m.content !~ 'added as a team member by Former Lomir User\\\\.'";
  assert.equal(prose.split(guard).length - 1, 2);
});

test("SQL regex escapes survive JS template literals", () => {
  assert.ok(!/[^\\]\\[sd|.]/.test(sql));
});

test("owns its transaction, a ceiling of 19 and a remaining-row check", () => {
  for (const clause of ['"BEGIN"', '"COMMIT"', '"ROLLBACK"',
    "result.rowCount > MAX_ROWS", "rows[0].remaining !== 0", "client.release()",
    "const EXPECTED_ROWS = 19", "const MAX_ROWS = 19", "deletion-audit/54",
  ]) assert.ok(source.includes(clause), clause);
  assert.equal((source.match(/= `\$\{PLAN_CTE\}/g) || []).length, 2);
});

test("registered after #352 and #353, so the first run's churn is cleaned up in the same run", () => {
  const p352 = index.indexOf("await addIdTokensToProseEvents();");
  const p353 = index.indexOf("await fixWrongApproverIdsInApplauseEvents();");
  const scrub = index.indexOf("await scrubDeletedPeopleInApplicationEvents();");
  assert.ok(p352 >= 0 && p353 > p352 && scrub > p353);
});
