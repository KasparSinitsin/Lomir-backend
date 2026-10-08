// Read as text: importing a migration would initialise the application DB pool.
// SQL behaviour and rollback are exercised by deletion-audit/fixtures/46 on a
// disposable PostgreSQL database with synthetic rows, never production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "../src/database/migrations", name), "utf8");
const scrub = read("scrub_deleted_new_owners_in_owner_banners.js");
const successor = read("add_successor_ids_to_deletion_owner_banners.js");
const index = read("index.js");
const sqlOf = (source) => source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));
const scrubSql = sqlOf(scrub);
const successorSql = sqlOf(successor);

test("scrub: deletion is proven by the next owner banner of the team, not by a name", () => {
  for (const clause of [
    "DISTINCT ON (b.id)",
    "o.content LIKE '👑 OWNERSHIP_TEAM:%' AND o.team_id = b.team_id",
    "ORDER BY b.id, o.sent_at, o.id",
    "n.next_sender IS NULL",
    "n.next_prev = '${DELETED_USER_DISPLAY_NAME}'",
    "n.next_sent_at - b.sent_at <= interval '15 minutes'",
    "l.content LIKE '🚪 %has left Lomir.%'",
  ]) assert.ok(scrubSql.includes(clause), clause);
  assert.ok(scrub.includes('const DELETED_USER_DISPLAY_NAME = "Former Lomir User"'));
});

test("scrub: the replaced name matches no living user; the sender is checked", () => {
  for (const clause of [
    "AND NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(b.new_raw",
    "AND EXISTS (SELECT 1 FROM un WHERE un.id = b.sender_id)",
    "= (SELECT un.name FROM un WHERE un.id = b.sender_id)",
    "WHERE un.name = btrim(regexp_replace(b.prev_raw",
  ]) assert.ok(scrubSql.includes(clause), clause);
});

test("scrub: only the deleted name is replaced and the sender id is inserted", () => {
  assert.ok(scrubSql.includes("b.head || b.sender_id::text || ':' || b.prev_raw || ' | ' || '${DELETED_USER_DISPLAY_NAME}' AS new_content"));
  assert.ok(scrubSql.includes("b.head || b.prev_raw || ' | ' || b.new_raw = b.content"));
});

test("successor: two persisted sources must agree, and nothing may follow", () => {
  for (const clause of [
    "m.sender_id IS NULL",
    "n.type = 'ownership_transferred' AND n.team_id = b.team_id",
    "abs(extract(epoch FROM (n.created_at - b.sent_at))) <= 5",
    "s.users = 1 AND NOT s.any_null",
    "(SELECT t.owner_id FROM teams t WHERE t.id = b.team_id) = s.succ_id",
    "AND NOT EXISTS (SELECT 1 FROM messages o",
    "b.prev_raw = '${DELETED_USER_DISPLAY_NAME}'",
  ]) assert.ok(successorSql.includes(clause), clause);
});

test("successor: only the id is inserted; name conflicts are left alone", () => {
  assert.ok(successorSql.includes("b.head || b.prev_raw || ' | ' || s.succ_id::text || ':' || b.succ_raw AS new_content"));
  assert.ok(successorSql.includes("b.head || b.prev_raw || ' | ' || b.succ_raw = b.content"));
  assert.ok(successorSql.includes("WHERE un.name = btrim(regexp_replace(b.succ_raw"));
});

for (const [name, source, sql] of [["scrub", scrub, scrubSql], ["successor", successor, successorSql]]) {
  test(`${name}: bare legacy rows before the cutoff only, idempotent by token guard`, () => {
    assert.ok(sql.includes("m.content LIKE '👑 OWNERSHIP_TEAM:%'"));
    assert.ok(sql.includes("m.team_id IS NOT NULL"));
    assert.ok(sql.includes("m.sent_at < '2026-10-07'"));
    assert.ok(sql.includes("'\\\\|\\\\s*\\\\d+\\\\s*:'"));
    assert.ok(source.includes("AND m.content = plan.content"));
  });

  test(`${name}: SQL regex escapes survive JS template literals`, () => {
    assert.ok(!/[^\\]\\[sd|]/.test(sql));
  });

  test(`${name}: owns its transaction, a ceiling of 5 and a remaining-row check`, () => {
    for (const clause of ['"BEGIN"', '"COMMIT"', '"ROLLBACK"',
      "result.rowCount > MAX_ROWS", "rows[0].remaining !== 0", "client.release()",
      "const EXPECTED_ROWS = 5", "const MAX_ROWS = 5", "deletion-audit/46",
    ]) assert.ok(source.includes(clause), clause);
    assert.equal((source.match(/= `\$\{PLAN_CTE\}/g) || []).length, 2);
  });
}

test("both are registered after the duplicate owner banner migration", () => {
  const earlier = index.indexOf("await addPersonIdsToDuplicateOwnerBanners();");
  const first = index.indexOf("await scrubDeletedNewOwnersInOwnerBanners();");
  const second = index.indexOf("await addSuccessorIdsToDeletionOwnerBanners();");
  assert.ok(earlier >= 0 && first > earlier && second > first);
  assert.ok(index.includes('"./scrub_deleted_new_owners_in_owner_banners"'));
  assert.ok(index.includes('"./add_successor_ids_to_deletion_owner_banners"'));
});
