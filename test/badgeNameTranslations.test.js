const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BADGE_NAME_TRANSLATIONS,
  BADGE_NAME_TRANSLATIONS_VALUES_SQL,
} = require("../src/utils/search/badgeNameTranslations");
const {
  appendUserSearchClause,
} = require("../src/utils/search/searchResultProcessing");

const userSearch = (query, useBoolean) => {
  const userParams = [];
  const result = appendUserSearchClause({
    userQuery: "SELECT u.id FROM users u WHERE 1=1",
    userParams,
    query,
    searchTerm: `%${query}%`,
    useBoolean,
    startParamIndex: 1,
  });
  return { ...result, userParams };
};

test("the English-to-German badge list has the 30 seeded badges, each with both names", () => {
  assert.equal(BADGE_NAME_TRANSLATIONS.length, 30);
  const english = BADGE_NAME_TRANSLATIONS.map(([en]) => en);
  assert.equal(new Set(english).size, 30, "English names are unique");
  for (const [en, de] of BADGE_NAME_TRANSLATIONS) {
    assert.ok(en && de, `both names present for ${en}`);
  }
});

test("the VALUES fragment has one row per badge and no stray quote", () => {
  const rows = BADGE_NAME_TRANSLATIONS_VALUES_SQL.match(/\('[^']*', '[^']*'\)/g);
  assert.equal(rows.length, 30);
  assert.equal(
    BADGE_NAME_TRANSLATIONS_VALUES_SQL.replace(/\('[^']*', '[^']*'\)(, )?/g, ""),
    "",
  );
});

test("a plain search matches the badge name in both languages, with one parameter", () => {
  const { query, userParams, nextParamIndex } = userSearch("Empathisch", false);
  assert.match(query, /m_name\(en, de\)/);
  assert.match(query, /unnest\(ARRAY\[b_name\.name, m_name\.de\]\)/);
  assert.deepEqual(userParams, ["%Empathisch%"]);
  assert.equal(nextParamIndex, 2);
});

test("a boolean search leaves no unreplaced placeholder (the parser replaces only the first one)", () => {
  for (const q of [
    "Empathisch AND Programmierer",
    "Empathisch OR Programmierer",
    "Programmierer NOT Empathisch",
  ]) {
    const { query } = userSearch(q, true);
    assert.ok(!query.includes("$PARAM"), `no literal $PARAM for ${q}`);
    assert.match(query, /unnest\(ARRAY\[b_name\.name, m_name\.de\]\)/);
  }
});
