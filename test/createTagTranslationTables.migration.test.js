// The translation tables hold what the taxonomy is shown as. Read as TEXT (the module imports
// the database config); behaviour: deletion-audit/fixtures/77-tag-translations-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/create_tag_translation_tables.js"),
  "utf8",
);
const index = fs.readFileSync(path.join(__dirname, "../src/database/migrations/index.js"), "utf8");

test("there are three tables, each with a real foreign key that cascades", () => {
  assert.ok(source.includes("tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE"));
  assert.ok(source.includes("category_id INTEGER NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE"));
  assert.ok(source.includes("supercategory_id INTEGER NOT NULL REFERENCES tag_supercategories(id) ON DELETE CASCADE"));
});

test("a translation is unique per owner and language, and clean", () => {
  assert.ok(source.includes("PRIMARY KEY (tag_id, language)"));
  assert.ok(source.includes("PRIMARY KEY (category_id, language)"));
  assert.ok(source.includes("PRIMARY KEY (supercategory_id, language)"));
  assert.equal((source.match(/language ~ '\^\[a-z\]\{2\}\$'/g) || []).length, 3);
  assert.equal((source.match(/name <> '' AND name = btrim\(name\)/g) || []).length, 3);
});

test("the translated name is NOT unique (two English names may share one German word)", () => {
  assert.ok(!/UNIQUE\s*\(\s*(language\s*,\s*)?name/i.test(source));
});

test("it is additive, idempotent, writes no data and owns its transaction", () => {
  assert.equal((source.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 3);
  assert.ok(!/INSERT INTO|DROP |DELETE FROM|ALTER TABLE/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.ok(source.includes('client.query("BEGIN")'));
  assert.ok(source.includes('client.query("ROLLBACK")'));
});

test("it runs after the category tables, which its keys need", () => {
  const a = index.indexOf("await createTagCategoryTables();");
  const b = index.indexOf("await createTagTranslationTables();");
  assert.ok(a > -1 && b > a);
});
