// Read as text: importing a migration would initialise the application DB pool.
// SQL behaviour and rollback are exercised by deletion-audit/fixtures/48 on a
// disposable PostgreSQL database with synthetic rows, never production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname,
  "../src/database/migrations/add_successor_ids_confirmed_by_next_banner.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "../src/database/migrations/index.js"), "utf8");
const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));

test("the notified successor must be confirmed by the NEXT owner banner, sender and token", () => {
  for (const clause of [
    "n.type = 'ownership_transferred' AND n.team_id = b.team_id",
    "abs(extract(epoch FROM (n.created_at - b.sent_at))) <= 5",
    "s.users = 1 AND NOT s.any_null",
    "DISTINCT ON (b.id)",
    "ORDER BY b.id, o.sent_at, o.id",
    "AND x.next_sender = s.succ_id",
    "AND x.next_prev_id = s.succ_id",
  ]) assert.ok(sql.includes(clause), clause);
});

test("only deletion-form banners with a bare successor before the cutoff qualify", () => {
  for (const clause of [
    "m.content LIKE '👑 OWNERSHIP_TEAM:%'", "m.team_id IS NOT NULL", "m.sender_id IS NULL",
    "m.sent_at < '2026-10-07'", "b.prev_raw = '${DELETED_USER_DISPLAY_NAME}'",
  ]) assert.ok(sql.includes(clause), clause);
  assert.ok(source.includes('const DELETED_USER_DISPLAY_NAME = "Former Lomir User"'));
});

test("only the id is inserted; name conflicts and non-round-tripping rows are left alone", () => {
  assert.ok(sql.includes("b.head || b.prev_raw || ' | ' || s.succ_id::text || ':' || b.succ_raw AS new_content"));
  assert.ok(sql.includes("b.head || b.prev_raw || ' | ' || b.succ_raw = b.content"));
  assert.ok(sql.includes("WHERE un.name = btrim(regexp_replace(b.succ_raw"));
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("SQL regex escapes survive JS template literals", () => {
  assert.ok(!/[^\\]\\[sd|]/.test(sql));
});

test("owns its transaction, a ceiling and a remaining-row check", () => {
  for (const clause of ['"BEGIN"', '"COMMIT"', '"ROLLBACK"',
    "result.rowCount > MAX_ROWS", "rows[0].remaining !== 0", "client.release()", "deletion-audit/48",
  ]) assert.ok(source.includes(clause), clause);
  assert.equal((source.match(/= `\$\{PLAN_CTE\}/g) || []).length, 2);
});

test("registered after the first successor migration", () => {
  const first = index.indexOf("await addSuccessorIdsToDeletionOwnerBanners();");
  const second = index.indexOf("await addSuccessorIdsConfirmedByNextBanner();");
  assert.ok(first >= 0 && second > first);
});
