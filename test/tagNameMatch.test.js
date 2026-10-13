// The SQL behind the focus-area search over translations (STATUS item 11, PR 2).
// Behaviour against a real database: deletion-audit/fixtures/80-tag-search-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");

const { tagNameMatchSQL, tagRelevanceJoinSQL } = require("../src/utils/search/tagNameMatch");
const { parseBooleanSearch } = require("../src/utils/booleanSearchParser");

test("the match uses its placeholder exactly once", () => {
  const sql = tagNameMatchSQL("t2", "$PARAM");
  assert.equal(sql.split("$PARAM").length - 1, 1);
  assert.match(sql, /tag_translations/);
});

test("the boolean parser fills the placeholder everywhere it appears", () => {
  const template = `EXISTS (SELECT 1 FROM tags t2 WHERE ${tagNameMatchSQL("t2", "$PARAM")})`;
  const { whereClause, params } = parseBooleanSearch("Wandern", ["tag.name"], 1, {
    tagColumn: "tag.name",
    existsTemplate: template,
    notExistsTemplate: `NOT ${template}`,
  });
  assert.equal(whereClause.includes("$PARAM"), false);
  assert.deepEqual(params, ["%Wandern%"]);
});

test("the relevance join ranks exact, prefix, contains over the name and the translations", () => {
  const sql = tagRelevanceJoinSQL("t", "$1");
  assert.match(sql, /tag_translations/);
  assert.match(sql, /THEN 1[\s\S]*THEN 2[\s\S]*ELSE 3/);
});
