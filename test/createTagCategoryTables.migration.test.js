// The tag-category migration creates tables, moves ONE tag and links every tag, and it re-runs on
// EVERY `npm run migrate`, so its rule is pinned here. Behaviour against real rows:
// `deletion-audit/fixtures/76-tag-category-ids-verify.cjs` on a throwaway postgres.
//
//   1. A category is (supercategory, name): unique as a pair, because round 74 found "Social
//      Impact" under two supercategories.
//   2. The TEXT columns stay; nothing is dropped or renamed (~30 queries read them).
//   3. Tag 21 moves only on its exact values, and its parent_id is not touched.
//   4. The tables are filled ONLY while empty; a later run never invents a category.
//   5. Ids must agree with the text beside them, or the run rolls back.
//   6. It owns its transaction, refuses an impossible count, names its dry run, is registered.
// ⚠️ Read as TEXT, never required: the module imports the database config.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/create_tag_category_tables.js"),
  "utf8",
);
const index = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/index.js"),
  "utf8",
);

test("a category is unique as a pair with its supercategory", () => {
  assert.ok(source.includes("UNIQUE (supercategory_id, name)"));
  assert.ok(source.includes("supercategory_id INTEGER NOT NULL REFERENCES tag_supercategories(id)"));
  assert.ok(!/name\s+TEXT NOT NULL UNIQUE,\s*\n\s*CONSTRAINT tag_categories/.test(source), "category name alone must not be unique");
});

test("the text columns stay, only ids are added", () => {
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS supercategory_id"));
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS category_id"));
  assert.ok(!/DROP COLUMN|RENAME COLUMN|DROP TABLE/i.test(source));
});

test("tag 21 moves only on its exact values and keeps its parent", () => {
  const sql = source.slice(source.indexOf("const MOVE_TAG_21_SQL"), source.indexOf("const SEED_SUPERCATEGORIES_SQL"));
  assert.ok(sql.includes("id = 21 AND name = 'Social Impact' AND category = 'Social Impact'"));
  assert.ok(sql.includes("supercategory = 'Business & Entrepreneurship'"));
  assert.ok(sql.includes("SET supercategory = 'Social, Community & Volunteering'"));
  assert.ok(!sql.includes("parent_id"));
});

test("the tables are filled only on the first run, never on a later one", () => {
  assert.ok(source.includes("const firstRun = before[0].s === 0 && before[0].c === 0;"));
  assert.ok(source.includes("if (firstRun) {"));
  assert.ok(source.indexOf("SEED_CATEGORIES_SQL)") > source.indexOf("if (firstRun) {"));
});

test("only tags without ids are linked", () => {
  const sql = source.slice(source.indexOf("const LINK_SQL"), source.indexOf("// Ids that disagree"));
  assert.ok(sql.includes("t.supercategory_id IS NULL AND t.category_id IS NULL"));
  assert.ok(sql.includes("s.name = t.supercategory AND c.name = t.category"));
});

test("ids must agree with the text, checked after every run", () => {
  assert.ok(source.includes("c.supercategory_id IS DISTINCT FROM t.supercategory_id"));
  assert.ok(source.includes("bad[0].n !== 0"));
  assert.ok(source.includes("have an id that disagrees with their text"));
});

test("it owns a transaction, refuses an impossible count and names its dry run", () => {
  assert.ok(source.includes('client.query("BEGIN")'));
  assert.ok(source.includes('client.query("COMMIT")'));
  assert.ok(source.includes('client.query("ROLLBACK")'));
  assert.ok(source.includes("seededS > MAX_SUPERCATEGORIES || seededC > MAX_CATEGORIES"));
  assert.ok(source.includes("deletion-audit/76"));
});

test("it is registered", () => {
  assert.ok(index.includes('require("./create_tag_category_tables")'));
  assert.ok(index.includes("await createTagCategoryTables();"));
});
