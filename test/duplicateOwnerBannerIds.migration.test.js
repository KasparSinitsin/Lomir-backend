// Read as text: importing a migration would initialise the application DB pool.
// SQL behaviour and rollback are exercised by deletion-audit/fixtures/44 on a
// disposable PostgreSQL database with synthetic rows, never production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname,
  "../src/database/migrations/add_person_ids_to_duplicate_owner_banners.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname,
  "../src/database/migrations/index.js"), "utf8");
const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));

test("duplicate owner banners link to DMs of the same sender in the five-second window", () => {
  for (const clause of [
    "d.content LIKE '👑 OWNERSHIP_TRANSFERRED:%'",
    "d.sender_id = b.sender_id AND d.team_id IS NULL",
    "d.sent_at <= b.sent_at",
    "b.sent_at - d.sent_at <= interval '5 seconds'",
  ]) assert.ok(sql.includes(clause), clause);
});

test("every candidate DM must name both people and share ONE receiver", () => {
  assert.ok(sql.includes("regexp_replace(c.ds[2]"));
  assert.ok(sql.includes("regexp_replace(c.ds[3]"));
  assert.ok(sql.includes("bool_and(names_ok) AS all_named"));
  assert.ok(sql.includes("AND a.all_named"));
  assert.ok(sql.includes("count(DISTINCT receiver_id) AS receivers"));
  assert.ok(sql.includes("a.receivers = 1 AND NOT a.any_receiver_null"));
});

test("the team slot must be stale, never another team and never 40's population", () => {
  for (const clause of [
    "AND NOT a.any_team_slot_ok",
    "AND NOT a.any_slot_names_a_team",
    "WHERE t.id = (regexp_match(c.ds[1], '^(\\\\d+)'))[1]::bigint",
    "AND NOT a.any_precedes_other_team",
    "o.team_id <> c.team_id AND o.sender_id = c.sender_id",
  ]) assert.ok(sql.includes(clause), clause);
});

test("missing, identical and name-conflicting people are left alone", () => {
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

test("both ids are inserted without changing stored labels or separators", () => {
  assert.ok(sql.includes("b.head || b.sender_id::text || ':' || b.prev_raw || ' | ' || a.new_id::text || ':' || b.new_raw AS new_content"));
  assert.ok(sql.includes("b.head || b.prev_raw || ' | ' || b.new_raw = b.content"));
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("SQL regex escapes survive JS template literals", () => {
  assert.ok(!/[^\\]\\[sd|]/.test(sql));
  assert.ok(sql.includes("\\\\s+"));
  assert.ok(sql.includes("\\\\d+"));
});

test("the migration owns its transaction, a ceiling of 4 and a remaining-row check", () => {
  for (const clause of ['"BEGIN"', '"COMMIT"', '"ROLLBACK"',
    "result.rowCount > MAX_ROWS", "rows[0].remaining !== 0", "client.release()",
    "const EXPECTED_ROWS = 4", "const MAX_ROWS = 4", "deletion-audit/44",
  ]) assert.ok(source.includes(clause), clause);
  assert.equal((source.match(/= `\$\{PLAN_CTE\}/g) || []).length, 2);
});

test("registered after the owner banner migration it complements", () => {
  assert.ok(index.includes('"./add_person_ids_to_duplicate_owner_banners"'));
  const earlier = index.indexOf("await addPersonIdsToLegacyOwnerBanners();");
  const current = index.indexOf("await addPersonIdsToDuplicateOwnerBanners();");
  assert.ok(earlier >= 0 && current > earlier);
});
