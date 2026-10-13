const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// schema.sql and the reference files are published with the code and loaded into strangers' databases.
// They must hold structure and product content only, never a person.

const db = (...parts) => path.join(__dirname, "..", "scripts", "demo", ...parts);
const translationsFile = path.join(__dirname, "..", "src", "database", "seeds", "tag-translations.de.json");
const schema = fs.readFileSync(db("schema.sql"), "utf8");
const taxonomy = JSON.parse(fs.readFileSync(db("reference", "taxonomy.json"), "utf8"));
const { badges } = JSON.parse(fs.readFileSync(db("reference", "badges.json"), "utf8"));
const translations = JSON.parse(fs.readFileSync(translationsFile, "utf8"));

// The header comment explains what was removed, so the checks for removed things look at code only.
// `assert.equal(regex.test(...), false)` keeps a failure short: doesNotMatch would print the whole file.
const code = schema.split("\n").filter((line) => !line.startsWith("--")).join("\n");

test("schema.sql is structure only", () => {
  assert.equal(/^(COPY |INSERT INTO )/m.test(schema), false, "a data line");
  assert.equal(/^\\/m.test(schema), false, "a psql command (\\restrict) that older psql cannot read");
  assert.equal(/@[A-Za-z0-9-]+\.[a-z]{2,}/.test(schema), false, "something that looks like an e-mail address");
  assert.equal(/ltree|transaction_timeout/.test(code), false, "removed on purpose");
});

test("schema.sql holds the tables the application reads and writes", () => {
  const tables = [...schema.matchAll(/^CREATE TABLE public\.(\w+)/gm)].map((m) => m[1]);
  for (const name of [
    "users", "teams", "team_members", "team_tags", "team_vacant_roles", "team_applications", "team_invitations",
    "tags", "tag_categories", "tag_supercategories", "tag_translations", "badges", "badge_awards", "user_tags",
    "messages", "notifications", "contact_reports", "user_blocks", "pending_file_deletions",
  ]) {
    assert.ok(tables.includes(name), `no table ${name}`);
  }
  assert.equal(tables.length, 25);
  assert.match(schema, /CREATE MATERIALIZED VIEW public\.v_user_badges_with_category_totals/);
});

test("the taxonomy is consistent", () => {
  const superIds = new Set(taxonomy.supercategories.map((s) => s.id));
  const catIds = new Set(taxonomy.categories.map((c) => c.id));
  assert.equal(superIds.size, taxonomy.supercategories.length, "duplicate supercategory id");
  assert.equal(catIds.size, taxonomy.categories.length, "duplicate category id");
  for (const c of taxonomy.categories) assert.ok(superIds.has(c.supercategory_id), `category ${c.id}`);
  const tagIds = new Set();
  for (const t of taxonomy.tags) {
    assert.ok(!tagIds.has(t.id), `duplicate tag id ${t.id}`);
    tagIds.add(t.id);
    assert.ok(catIds.has(t.category_id), `tag ${t.id} has no category`);
    assert.equal(t.name, t.name.trim());
    assert.notEqual(t.name, "");
  }
  assert.deepEqual([taxonomy.supercategories.length, taxonomy.categories.length, taxonomy.tags.length], [13, 67, 776]);
});

test("the German names belong to exactly these ids", () => {
  const tagIds = new Set(taxonomy.tags.map((t) => t.id));
  const catIds = new Set(taxonomy.categories.map((c) => c.id));
  const superIds = new Set(taxonomy.supercategories.map((s) => s.id));
  const ids = (section) => Object.keys(translations[section] || {}).map(Number);
  assert.deepEqual(ids("tags").filter((id) => !tagIds.has(id)), []);
  assert.deepEqual(ids("categories").filter((id) => !catIds.has(id)), []);
  assert.deepEqual(ids("supercategories").filter((id) => !superIds.has(id)), []);
  assert.equal(ids("tags").length, tagIds.size, "every tag has a German name");
});

test("the badges are the 30 definitions, five categories of six, with no image URLs", () => {
  assert.equal(badges.length, 30);
  assert.equal(new Set(badges.map((b) => b.id)).size, 30);
  assert.equal(new Set(badges.map((b) => b.name)).size, 30);
  const perCategory = {};
  for (const b of badges) perCategory[b.category] = (perCategory[b.category] || 0) + 1;
  assert.deepEqual(Object.values(perCategory), [6, 6, 6, 6, 6]);
  for (const b of badges) {
    assert.deepEqual(Object.keys(b).sort(), ["category", "color", "description", "id", "name"], "unexpected field");
    assert.match(b.color, /^#[0-9A-Fa-f]{6}$/);
  }
});
