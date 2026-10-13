// The legacy-tag merge DELETES rows, and it re-runs on EVERY `npm run migrate`, so its
// rule is pinned here rather than trusted to review. Behaviour against real rows:
// `deletion-audit/fixtures/73-merge-legacy-tags-verify.cjs` on a throwaway postgres.
//
//   1. The mapping is the four measured pairs, nothing else (`deletion-audit/71`, `72`).
//   2. A pair is touched only while it is still what the dry run saw: archived legacy,
//      approved current, the same category, the legacy name = the current name + " (legacy)".
//   3. Rows that carry credits or history are never moved silently: they REFUSE the run.
//   4. A duplicate link is deleted BEFORE a link is repointed (the unique rule).
//   5. It owns its transaction, verifies itself by counting the legacy ids that are left,
//      and refuses an impossible count, because `index.js` swallows a module's error.
//   6. It is registered, and names its dry run.
// ⚠️ Read as TEXT, never required: the module imports the database config.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/merge_legacy_tags.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

test("the mapping is exactly the four measured pairs", () => {
  const block = source.slice(source.indexOf("const MAPPING"), source.indexOf("const EXPECTED"));
  const pairs = [...block.matchAll(/\[(\d+), (\d+)\]/g)].map((m) => `${m[1]}>${m[2]}`);
  assert.deepEqual(pairs, ["45>265", "202>60", "319>38", "320>39"]);
});

test("a pair is only touched while it still matches the dry run", () => {
  assert.ok(source.includes("l.status = 'archived' AND c.status = 'approved'"));
  assert.ok(source.includes("l.name = c.name || ' (legacy)'"));
  assert.ok(source.includes("l.category = c.category AND l.supercategory = c.supercategory"));
});

test("rows with credits or history refuse the run instead of moving", () => {
  for (const t of ["user_tags", "team_vacant_role_tags", "badge_awards", "tags.parent_id"]) {
    assert.ok(source.includes(`'${t}'`), t);
  }
  assert.ok(source.includes("merge refused"));
});

test("a duplicate link is deleted before a link is repointed", () => {
  assert.ok(source.indexOf("DELETE_DUPLICATE_LINKS_SQL, [") < source.indexOf("REPOINT_LINKS_SQL, ["));
  assert.ok(source.includes("SELECT 1 FROM team_tags b WHERE b.team_id = a.team_id AND b.tag_id = p.current_id"));
});

test("a tag is deleted only when nothing points at it", () => {
  const sql = source.slice(source.indexOf("const DELETE_TAGS_SQL"), source.indexOf("// Legacy ids still"));
  for (const t of ["team_tags", "user_tags", "team_vacant_role_tags", "badge_awards"]) {
    assert.ok(sql.includes(`FROM ${t} x WHERE x.tag_id = l.id`), t);
  }
  assert.ok(sql.includes("x.parent_id = l.id"));
});

test("it owns a transaction and verifies by the ids left, not the pairs that match", () => {
  assert.ok(source.includes('client.query("BEGIN")'));
  assert.ok(source.includes('client.query("COMMIT")'));
  assert.ok(source.includes('client.query("ROLLBACK")'));
  assert.ok(source.includes("FROM tags WHERE id = ANY($1::int[])"));
  assert.ok(source.includes("rows[0].remaining !== 0"));
  assert.ok(source.includes("touched > MAX_ROWS"));
});

test("it is registered and names its dry run", () => {
  assert.ok(index.includes('require("./merge_legacy_tags")'));
  assert.ok(index.includes("await mergeLegacyTags();"));
  assert.ok(source.includes("deletion-audit/71"));
  assert.ok(source.includes("`72`"));
});
