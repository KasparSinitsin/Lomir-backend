// Accent-insensitive search (STATUS item 52). The SQL is built here; what it
// does on a real PostgreSQL with `unaccent` is checked by
// deletion-audit/fixtures/92-accent-folding-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ALTERNATIVE_SPELLINGS,
  foldSql,
  accentInsensitiveLike,
} = require("../src/utils/search/accentFolding");

test("the base fold is lower case, then the accents off", () => {
  assert.equal(foldSql("u.last_name"), "unaccent(lower(u.last_name))");
});

test("a language's spellings are written out before the accents come off", () => {
  assert.equal(
    foldSql("x", [["ä", "ae"], ["ü", "ue"]]),
    "unaccent(replace(replace(lower(x), 'ä', 'ae'), 'ü', 'ue'))",
  );
});

test("the match tries the base form and every language's own form, never mixed", () => {
  const sql = accentInsensitiveLike("COALESCE(u.bio, '')", "$1");
  const forms = sql.slice(1, -1).split(" OR ");
  assert.equal(forms.length, 1 + Object.keys(ALTERNATIVE_SPELLINGS).length);
  assert.equal(
    forms[0],
    "unaccent(lower(COALESCE(u.bio, ''))) LIKE unaccent(lower($1))",
  );
  assert.ok(forms[1].includes("replace(") && forms[1].includes("'ü', 'ue'"));
  // haystack and pattern use the SAME form
  for (const form of forms) {
    const [left, right] = form.split(" LIKE ");
    assert.equal(left.replace("COALESCE(u.bio, '')", "$1"), right);
  }
});

test("the language rules are letters only (they are put into SQL as literals)", () => {
  for (const [language, rules] of Object.entries(ALTERNATIVE_SPELLINGS)) {
    assert.match(language, /^[a-z]{2}$/);
    for (const [letter, written] of rules) {
      assert.match(letter, /^\p{L}$/u);
      assert.match(written, /^\p{L}+$/u);
    }
  }
});

test("German writes ä ö ü ß out; other languages are not touched", () => {
  assert.deepEqual(Object.keys(ALTERNATIVE_SPELLINGS), ["de"]);
  assert.deepEqual(
    ALTERNATIVE_SPELLINGS.de.map(([letter]) => letter),
    ["ä", "ö", "ü", "ß"],
  );
});

const source = fs.readFileSync(
  path.join(__dirname, "../src/database/migrations/create_unaccent_extension.js"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

test("the migration only creates the extension, idempotently, in its own transaction", () => {
  assert.equal((code.match(/CREATE EXTENSION IF NOT EXISTS unaccent/g) || []).length, 1);
  assert.ok(!/CREATE TABLE|INSERT INTO|DROP |DELETE FROM|ALTER TABLE|UPDATE /i.test(code));
  assert.ok(code.includes('client.query("BEGIN")'));
  assert.ok(code.includes('client.query("ROLLBACK")'));
});

test("it is registered, and migrate:one may run it early", () => {
  const index = fs.readFileSync(path.join(__dirname, "../src/database/migrations/index.js"), "utf8");
  assert.ok(index.includes('require("./create_unaccent_extension")'));
  assert.ok(index.includes("await createUnaccentExtension();"));
  const runner = fs.readFileSync(path.join(__dirname, "../scripts/run-migration.js"), "utf8");
  assert.ok(/create_unaccent_extension:\s*\n\s*"/.test(runner));
});
