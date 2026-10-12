// The list of ImageKit files still to delete (STATUS item 59). Read as TEXT: the
// module imports the database config. Behaviour on a throwaway postgres with the
// real schema: deletion-audit/fixtures/85-pending-file-deletions-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/create_pending_file_deletions.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
const createBlock = code.slice(
  code.indexOf("CREATE TABLE IF NOT EXISTS pending_file_deletions"),
  code.indexOf(");", code.indexOf("CREATE TABLE IF NOT EXISTS pending_file_deletions")),
);

test("it is additive, idempotent, writes no data and owns its transaction", () => {
  assert.equal((code.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 1);
  assert.ok(!/INSERT INTO|DROP |DELETE FROM|ALTER TABLE|UPDATE /i.test(code));
  assert.ok(code.includes('client.query("BEGIN")'));
  assert.ok(code.includes('client.query("ROLLBACK")'));
});

test("a row holds a file reference and never a person or a team", () => {
  assert.ok(createBlock.includes("file_url        TEXT"));
  assert.ok(createBlock.includes("file_id         TEXT"));
  assert.ok(!/user_id|team_id|sender_id|receiver_id|owner_id|\bname\b|REFERENCES/i.test(createBlock));
});

test("a row without any reference is refused", () => {
  assert.ok(createBlock.includes("CHECK (file_url IS NOT NULL OR file_id IS NOT NULL)"));
});

test("it is registered, and runs before the held data migration of item 35", () => {
  assert.ok(index.includes('require("./create_pending_file_deletions")'));
  const created = index.indexOf("await createPendingFileDeletions();");
  const held = index.indexOf("await addTeamIdsToClipboardProseDms();");
  assert.ok(created > -1 && held > created);
});
