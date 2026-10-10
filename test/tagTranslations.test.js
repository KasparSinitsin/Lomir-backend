// The rules behind GET /api/tags/translations and scripts/import-tag-translations.js (STATUS item 11).
// Behaviour against a real database: deletion-audit/fixtures/77-tag-translations-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseLanguage,
  emptyDictionary,
  buildDictionary,
  loadDictionary,
} = require("../src/utils/tagTranslations");
const { validateSeed, planImport } = require("../src/utils/tagTranslationImport");

// ---------- the dictionary ----------

test("only a real two-letter language other than English asks for translations", () => {
  assert.equal(parseLanguage("de"), "de");
  assert.equal(parseLanguage(" DE "), "de");
  assert.equal(parseLanguage("en"), null);
  for (const bad of ["", "deu", "d", "1e", "de-DE", undefined, null, 5, ["de"], {}]) {
    assert.equal(parseLanguage(bad), null, String(bad));
  }
});

test("tags are keyed by id, categories and supercategories by their English text", () => {
  const d = buildDictionary(
    "de",
    [{ tag_id: 38, name: "Wandern" }],
    [{ source_text: "Hiking & Trekking", name: "Wandern & Trekking" }],
    [{ source_text: "Outdoor & Adventure", name: "Outdoor & Abenteuer" }],
  );
  assert.deepEqual(d, {
    language: "de",
    tags: { 38: "Wandern" },
    categories: { "Hiking & Trekking": "Wandern & Trekking" },
    supercategories: { "Outdoor & Adventure": "Outdoor & Abenteuer" },
  });
});

test("two categories with one text: the first row wins, the same every time", () => {
  const rows = [
    { source_text: "Social Impact", name: "A" },
    { source_text: "Social Impact", name: "B" },
  ];
  assert.equal(buildDictionary("de", [], rows, []).categories["Social Impact"], "A");
});

test("no language, or English, asks the database nothing", async () => {
  let calls = 0;
  const db = { query: async () => { calls += 1; return { rows: [] }; } };
  assert.deepEqual(await loadDictionary(db, null), emptyDictionary());
  assert.equal(calls, 0);
});

test("a missing table gives empty maps, any other error is thrown", async () => {
  const missing = { query: async () => { const e = new Error("no table"); e.code = "42P01"; throw e; } };
  assert.deepEqual(await loadDictionary(missing, "de"), emptyDictionary("de"));
  const broken = { query: async () => { throw new Error("boom"); } };
  await assert.rejects(() => loadDictionary(broken, "de"), /boom/);
});

// ---------- the seed file ----------

const goodSeed = () => ({
  language: "de",
  tags: { 38: { en: "Hiking", name: "Wandern" } },
  categories: { 4: { en: "Hiking & Trekking", name: "Wandern & Trekking", note: "ok" } },
  supercategories: {},
});

test("a good seed file has no errors and gives the entries by section", () => {
  const { errors, entries } = validateSeed(goodSeed(), "de");
  assert.deepEqual(errors, []);
  assert.deepEqual(entries.tags, [{ id: 38, en: "Hiking", name: "Wandern" }]);
  assert.equal(entries.categories.length, 1);
});

test("a missing section is an empty one", () => {
  const seed = { language: "de" };
  assert.deepEqual(validateSeed(seed, "de").errors, []);
});

test("the seed file is checked strictly", () => {
  const cases = [
    [null, /not a JSON object/],
    [{ ...goodSeed(), language: "deu" }, /two lowercase letters/],
    [{ ...goodSeed(), language: "fr" }, /asked for "de"/],
    [{ ...goodSeed(), language: "en" }, /needs no translations/],
    [{ ...goodSeed(), extra: 1 }, /unknown top-level key/],
    [{ ...goodSeed(), tags: { abc: { en: "a", name: "b" } } }, /not an id/],
    [{ ...goodSeed(), tags: { 0: { en: "a", name: "b" } } }, /not an id/],
    [{ ...goodSeed(), tags: { 1: "x" } }, /must be an object/],
    [{ ...goodSeed(), tags: { 1: { en: "a" } } }, /"name" must be non-empty/],
    [{ ...goodSeed(), tags: { 1: { en: "a", name: " b" } } }, /"name" must be non-empty/],
    [{ ...goodSeed(), tags: { 1: { en: "", name: "b" } } }, /"en" must be non-empty/],
    [{ ...goodSeed(), tags: { 1: { en: "a", name: "b", color: "x" } } }, /unknown field color/],
    [{ ...goodSeed(), tags: [] }, /must be an object/],
  ];
  for (const [seed, pattern] of cases) {
    const { errors } = validateSeed(seed, "de");
    assert.ok(errors.some((e) => pattern.test(e)), `${pattern}: ${JSON.stringify(errors)}`);
  }
});

// ---------- the plan ----------

const stored = () => ({
  tags: [{ id: 1, name: "Hiking" }, { id: 2, name: "Camping" }, { id: 3, name: "Yoga" }],
  categories: [{ id: 10, name: "Social Impact" }, { id: 11, name: "Social Impact" }],
  supercategories: [{ id: 20, name: "Outdoor" }],
});
const noExisting = () => ({ tags: [], categories: [], supercategories: [] });
const entriesOf = (tags = [], categories = [], supercategories = []) => ({ tags, categories, supercategories });

test("new, changed and unchanged rows are told apart; the rest is counted untranslated", () => {
  const existing = { ...noExisting(), tags: [{ id: 1, name: "Wandern" }, { id: 2, name: "Zelten" }] };
  const plan = planImport(
    entriesOf([
      { id: 1, en: "Hiking", name: "Wandern" },
      { id: 2, en: "Camping", name: "Campen" },
      { id: 3, en: "Yoga", name: "Yoga" },
    ]),
    stored(),
    existing,
  );
  const t = plan.sections.tags;
  assert.deepEqual([t.insert, t.update, t.unchanged, t.untranslated], [1, 1, 1, 0]);
  assert.deepEqual(plan.writes.tags, [{ id: 2, name: "Campen" }, { id: 3, name: "Yoga" }]);
  assert.equal(plan.problems, 0);
});

test("nothing is deleted: a translation missing from the file stays", () => {
  const existing = { ...noExisting(), tags: [{ id: 2, name: "Zelten" }] };
  const plan = planImport(entriesOf(), stored(), existing);
  assert.deepEqual(plan.writes.tags, []);
  assert.equal(plan.sections.tags.untranslated, 2); // 1 and 3; id 2 keeps its row
});

test("an unknown id and a differing en are problems and are not written", () => {
  const plan = planImport(
    entriesOf([{ id: 99, en: "Ghost", name: "Geist" }, { id: 1, en: "Hikin", name: "x" }]),
    stored(),
    noExisting(),
  );
  assert.deepEqual(plan.sections.tags.unknownIds, [99]);
  assert.deepEqual(plan.sections.tags.mismatchIds, [1]);
  assert.deepEqual(plan.writes.tags, []);
  assert.equal(plan.problems, 2);
});

test("two ids with one English text and two translations is a problem", () => {
  const plan = planImport(
    entriesOf([], [{ id: 10, en: "Social Impact", name: "A" }, { id: 11, en: "Social Impact", name: "B" }]),
    stored(),
    noExisting(),
  );
  assert.equal(plan.sections.categories.textConflicts, 1);
  assert.equal(plan.problems, 1);
});

test("two ids with one English text and the SAME translation is fine", () => {
  const plan = planImport(
    entriesOf([], [{ id: 10, en: "Social Impact", name: "A" }, { id: 11, en: "Social Impact", name: "A" }]),
    stored(),
    noExisting(),
  );
  assert.equal(plan.sections.categories.textConflicts, 0);
  assert.equal(plan.problems, 0);
});

test("a name shared by several tags is reported, not a problem", () => {
  const plan = planImport(
    entriesOf([{ id: 1, en: "Hiking", name: "Sport" }, { id: 2, en: "Camping", name: "Sport" }]),
    stored(),
    noExisting(),
  );
  assert.equal(plan.sections.tags.sharedNames, 1);
  assert.equal(plan.problems, 0);
});

// ---------- the files around it ----------

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("the script is a dry run unless --apply is given, and the gate writes nothing", () => {
  const src = read("scripts/import-tag-translations.js");
  assert.ok(src.includes('const APPLY = flag("apply");'));
  assert.ok(src.indexOf("if (REQUIRE_COMPLETE)") < src.indexOf("if (!APPLY)"));
  assert.ok(src.indexOf("if (!APPLY)") < src.indexOf('client.query("BEGIN")'));
  assert.ok(!/DELETE FROM/i.test(src), "the import never deletes");
  assert.ok(src.includes("ON CONFLICT"));
});

test("the route is registered and reads the language through parseLanguage", () => {
  const src = read("src/routes/api/tags.js");
  assert.ok(src.includes("router.get('/translations'"));
  assert.ok(src.includes("parseLanguage(req.query.lang)"));
  assert.ok(src.includes("Cache-Control"));
});

test("the seed file shipped with the code is valid and German", () => {
  const seed = JSON.parse(read("src/database/seeds/tag-translations.de.json"));
  assert.deepEqual(validateSeed(seed, "de").errors, []);
});
