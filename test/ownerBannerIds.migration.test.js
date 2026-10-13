// Read as text: importing a migration would initialise the application DB pool.
// SQL behaviour and rollback are exercised by deletion-audit/fixtures/40 on a
// disposable PostgreSQL database with synthetic rows, never production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname,
  "../src/database/migrations/add_person_ids_to_legacy_owner_banners.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname,
  "../src/database/migrations/index.js"), "utf8");
const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));

test("owner banner ids require a unique sibling DM, not a name-only match", () => {
  for (const clause of [
    "d.content LIKE '👑 OWNERSHIP_TRANSFERRED:%'",
    "d.sender_id = b.sender_id AND d.team_id IS NULL",
    "d.sent_at <= b.sent_at",
    "b.sent_at - d.sent_at <= interval '5 seconds'",
    "count(*) AS n", "a.n = 1 AND a.names_ok",
    "min(receiver_id) AS new_id", "c.ds[1] ~ ('^' || b.team_id::text",
    "FROM teams t WHERE t.id = b.team_id",
  ]) assert.ok(sql.includes(clause), clause);
  // Count all candidates of the team, even if one has different labels.
  assert.ok(!sql.includes("WHERE names_ok"));
});

test("owner banner ids require both matching DM person labels", () => {
  assert.ok(sql.includes("regexp_replace(c.ds[2]"));
  assert.ok(sql.includes("regexp_replace(c.ds[3]"));
  assert.ok(sql.includes("bool_and(names_ok)"));
});

test("owner banner ids leave missing, identical and name-conflicting people alone", () => {
  for (const clause of [
    "b.sender_id IS NOT NULL",
    "EXISTS (SELECT 1 FROM un WHERE un.id = b.sender_id)",
    "EXISTS (SELECT 1 FROM un WHERE un.id = a.new_id)",
    "b.sender_id IS DISTINCT FROM a.new_id",
    "WHERE un.name = btrim(regexp_replace(b.prev_raw",
    "WHERE un.name = btrim(regexp_replace(b.new_raw",
  ]) assert.ok(sql.includes(clause), clause);
});

test("only bare team banners before the cutoff qualify", () => {
  assert.ok(sql.includes("m.content LIKE '👑 OWNERSHIP_TEAM:%'"));
  assert.ok(sql.includes("m.team_id IS NOT NULL"));
  assert.ok(sql.includes("m.sent_at < '2026-10-07'"));
  assert.equal((sql.match(/AND NOT \(regexp_replace/g) || []).length, 2);
});

test("both tokens are inserted without changing stored labels or separators", () => {
  assert.ok(sql.includes("b.head || b.sender_id::text || ':' || b.prev_raw || ' | ' || a.new_id::text || ':' || b.new_raw AS new_content"));
  assert.ok(sql.includes("b.head || b.prev_raw || ' | ' || b.new_raw = b.content"));
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("SQL regex escapes survive JS template literals", () => {
  assert.ok(!/[^\\]\\[sd|]/.test(sql));
  assert.ok(sql.includes("\\\\s+"));
  assert.ok(sql.includes("\\\\d+"));
});

test("the migration owns its transaction, ceiling and remaining-row check", () => {
  for (const clause of ['"BEGIN"', '"COMMIT"', '"ROLLBACK"',
    "result.rowCount > MAX_ROWS", "rows[0].remaining !== 0", "client.release()",
    "const EXPECTED_ROWS = 21", "const MAX_ROWS = 43", "deletion-audit/40",
  ]) assert.ok(source.includes(clause), clause);
  assert.equal((source.match(/= `\$\{PLAN_CTE\}/g) || []).length, 2);
});

test("owner banner migration is registered after the earlier backfills", () => {
  assert.ok(index.includes('"./add_person_ids_to_legacy_owner_banners"'));
  const earlier = index.indexOf("await addApplicantIdToRoleApplicationApprovedRows();");
  const current = index.indexOf("await addPersonIdsToLegacyOwnerBanners();");
  assert.ok(earlier >= 0 && current > earlier);
});
