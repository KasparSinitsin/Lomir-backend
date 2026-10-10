// scripts/run-migration.js starts ONE migration against the single (live) database, so what it
// may start is pinned here. Read as TEXT: requiring the script would run it.
// Behaviour: deletion-audit/fixtures/78-run-single-migration-verify.cjs on a throwaway postgres.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const script = read("scripts/run-migration.js");
const index = read("src/database/migrations/index.js");
const pkg = JSON.parse(read("package.json"));

const listBlock = script.slice(script.indexOf("const EARLY_SAFE = {"), script.indexOf("};", script.indexOf("const EARLY_SAFE = {")));
const allowed = [...listBlock.matchAll(/^  (\w+):/gm)].map((m) => m[1]);

test("exactly the two additive table migrations may start early", () => {
  assert.deepEqual(allowed, ["create_tag_category_tables", "create_tag_translation_tables"]);
});

test("every allowed migration exists and is registered in index.js", () => {
  for (const name of allowed) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", "src/database/migrations", `${name}.js`)), name);
    assert.ok(index.includes(`require("./${name}")`), name);
  }
});

test("a migration that rewrites or deletes rows is never on the list", () => {
  for (const held of [
    "merge_legacy_tags",
    "add_team_ids_to_clipboard_prose_dms",
    "add_team_ids_to_legacy_marker_dms",
    "scrub_real_names_from_deletion_messages",
  ]) {
    assert.ok(!allowed.includes(held), held);
  }
});

test("a plain run only shows what it would do, and a refusal opens no connection", () => {
  assert.ok(script.includes('const RUN = args.includes("--run");'));
  assert.ok(script.indexOf("if (!RUN)") < script.indexOf("await migration();"));
  assert.ok(script.indexOf("hasOwnProperty.call(EARLY_SAFE, name)") < script.indexOf('require("../src/config/database")'));
});

test("it prints the database host and never the connection string", () => {
  assert.ok(script.includes("new URL(url).hostname"));
  assert.ok(!/console\.\w+\([^)]*DATABASE_URL[^)]*\)/.test(script.replace(/process\.env\.DATABASE_URL \|\| ""/g, "")));
});

test("the npm script exists", () => {
  assert.equal(pkg.scripts["migrate:one"], "node scripts/run-migration.js");
});
