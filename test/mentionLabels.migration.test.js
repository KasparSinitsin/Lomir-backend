// The @-mention labels of deleted accounts (STATUS item 59). Read as TEXT: the
// migration imports the database config. Behaviour on a throwaway postgres with
// the real structure: deletion-audit/fixtures/89-mention-labels-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const source = read("src/database/migrations/scrub_mention_labels_of_deleted_accounts.js");
const index = read("src/database/migrations/index.js");
const runner = read("scripts/run-migration.js");
const scrub = read("src/utils/mentionScrub.js");

test("it uses the account deletion's own function, per id without an account", () => {
  assert.ok(source.includes('require("../../utils/mentionScrub")'));
  assert.ok(source.includes("await scrubMentionLabels(client, id)"));
  assert.ok(source.includes("await deleteNotificationsMentioning(client, id)"));
  assert.ok(source.includes("WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = tokens.ref::bigint)"));
});

test("only the label of the token of that id changes, anchored by the closing parenthesis", () => {
  assert.ok(scrub.includes("const TOKEN_OF_ID = `('@\\\\[[^]]+\\\\]\\\\(' || $1 || '\\\\)')`;"));
  assert.ok(scrub.includes("regexp_replace(content, ${TOKEN_OF_ID}, '@[' || $2 || '](' || $1 || ')', 'g')"));
  assert.ok(/MENTION_PLACEHOLDER = "Former Lomir User"/.test(scrub));
});

test("it owns its transaction, has a ceiling, and refuses to leave tokens behind", () => {
  assert.ok(source.includes('client.query("BEGIN")'));
  assert.ok(source.includes('client.query("ROLLBACK")'));
  assert.ok(source.includes("messages > MAX_MESSAGES"));
  assert.ok(source.includes("rows[0].remaining !== 0"));
  assert.ok(/const EXPECTED_MESSAGES = 4;/.test(source));
});

test("it runs with the release, after the pending-files table and before item 35 (which stays last), never early", () => {
  const table = index.indexOf("await createPendingFileDeletions();");
  const self = index.indexOf("await scrubMentionLabelsOfDeletedAccounts();");
  const item35 = index.indexOf("await addTeamIdsToClipboardProseDms();");
  assert.ok(table > -1 && self > table && item35 > self);
  const list = runner.slice(runner.indexOf("const EARLY_SAFE = {"), runner.indexOf("};", runner.indexOf("const EARLY_SAFE = {")));
  assert.ok(!list.includes("scrub_mention_labels_of_deleted_accounts"));
});
