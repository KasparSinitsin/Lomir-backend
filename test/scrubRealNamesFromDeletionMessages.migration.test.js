// Read as text: importing a migration would initialise the application DB pool.
// SQL behaviour, the follow-on successor ids and rollback are exercised by
// deletion-audit/fixtures/51 on a disposable PostgreSQL database, never production.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname,
  "../src/database/migrations/scrub_real_names_from_deletion_messages.js"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "../src/database/migrations/index.js"), "utf8");
const sql = source.slice(source.indexOf("const PLAN_CTE"), source.indexOf("const UPDATE_SQL"));

test("only rows of the deletion writer of 2026-04-02..06-15 qualify", () => {
  for (const clause of [
    "m.team_id IS NOT NULL",
    "m.sender_id IS NULL",
    "m.sent_at >= '2026-04-02' AND m.sent_at < '2026-06-16'",
    "'^🚪 (.+) has left Lomir\\\\.$'",
    "'^(👑 OWNERSHIP_TEAM:\\\\s*)(.+?)\\\\s+\\\\|\\\\s+(.+)$'",
  ]) assert.ok(sql.includes(clause), clause);
});

test("a token, the placeholder itself or a living user's name is never replaced", () => {
  assert.ok(sql.includes("NOT (s.name_raw ~ '^\\\\d+\\\\s*:')"));
  assert.ok(sql.includes("<> '${DELETED_USER_DISPLAY_NAME}'"));
  assert.ok(sql.includes("AND NOT EXISTS (SELECT 1 FROM un WHERE un.name = btrim(regexp_replace(s.name_raw"));
  assert.ok(source.includes('const DELETED_USER_DISPLAY_NAME = "Former Lomir User"'));
});

test("only the name becomes the placeholder; the rest round-trips byte for byte", () => {
  assert.ok(sql.includes("WHEN 'leave' THEN '🚪 ${DELETED_USER_DISPLAY_NAME} has left Lomir.'"));
  assert.ok(sql.includes("ELSE s.head || '${DELETED_USER_DISPLAY_NAME}' || ' | ' || s.rest_raw"));
  assert.ok(sql.includes("WHEN 'leave' THEN '🚪 ' || s.name_raw || ' has left Lomir.' = s.content"));
  assert.ok(sql.includes("ELSE s.head || s.name_raw || ' | ' || s.rest_raw = s.content"));
  assert.ok(source.includes("AND m.content = plan.content"));
});

test("SQL regex escapes survive JS template literals", () => {
  assert.ok(!/[^\\]\\[sd|.]/.test(sql));
});

test("owns its transaction, a ceiling of 10 and a remaining-row check", () => {
  for (const clause of ['"BEGIN"', '"COMMIT"', '"ROLLBACK"',
    "result.rowCount > MAX_ROWS", "rows[0].remaining !== 0", "client.release()",
    "const EXPECTED_ROWS = 10", "const MAX_ROWS = 10", "deletion-audit/51",
  ]) assert.ok(source.includes(clause), clause);
  assert.equal((source.match(/= `\$\{PLAN_CTE\}/g) || []).length, 2);
});

test("registered BEFORE both successor migrations, so 3653/3695 follow in the same run", () => {
  const scrub = index.indexOf("await scrubRealNamesFromDeletionMessages();");
  const byOwner = index.indexOf("await addSuccessorIdsToDeletionOwnerBanners();");
  const byNext = index.indexOf("await addSuccessorIdsConfirmedByNextBanner();");
  assert.ok(scrub >= 0 && byOwner > scrub && byNext > byOwner);
  assert.ok(index.includes('"./scrub_real_names_from_deletion_messages"'));
});
