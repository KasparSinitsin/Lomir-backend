const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenize,
  hasBooleanOperators,
  validateBooleanQuery,
  parseBooleanSearch,
} = require("../src/utils/booleanSearchParser");

const types = (query) => tokenize(query).map((t) => `${t.type}:${t.value}`);

test("AND, OR and NOT in capitals are operators", () => {
  assert.deepEqual(types("react AND node"), [
    "TERM:react",
    "OPERATOR:AND",
    "TERM:node",
  ]);
  assert.deepEqual(types("react OR vue"), [
    "TERM:react",
    "OPERATOR:OR",
    "TERM:vue",
  ]);
  assert.deepEqual(types("react NOT angular"), [
    "TERM:react",
    "OPERATOR:NOT",
    "TERM:angular",
  ]);
});

test("the symbols and the minus prefix stay operators", () => {
  assert.deepEqual(types("a && b || c"), [
    "TERM:a",
    "OPERATOR:AND",
    "TERM:b",
    "OPERATOR:OR",
    "TERM:c",
  ]);
  assert.deepEqual(types("react ! angular"), [
    "TERM:react",
    "OPERATOR:NOT",
    "TERM:angular",
  ]);
  assert.deepEqual(types("react -angular"), [
    "TERM:react",
    "OPERATOR:NOT",
    "TERM:angular",
  ]);
});

test("lowercase and mixed-case and, or, not are search words", () => {
  for (const query of ["react and node", "react And node", "to be or not to be"]) {
    assert.equal(
      tokenize(query).some((t) => t.type === "OPERATOR"),
      false,
      query,
    );
    assert.equal(hasBooleanOperators(query), false, query);
  }
  assert.deepEqual(types("react and node"), [
    "TERM:react",
    "TERM:and",
    "TERM:node",
  ]);
});

test("a lowercase operator word is no longer an invalid trailing operator", () => {
  assert.equal(validateBooleanQuery("react or").valid, true);
  assert.equal(validateBooleanQuery("not").valid, true);
  assert.equal(validateBooleanQuery("react OR").valid, false);
});

test("operators of other languages are plain words here", () => {
  // The frontend rewrites them before sending; the backend knows no language.
  assert.equal(hasBooleanOperators("react UND node"), false);
  assert.equal(hasBooleanOperators("react ODER vue"), false);
  assert.equal(hasBooleanOperators("react NICHT angular"), false);
});

test("quoted AND stays inside the phrase", () => {
  assert.deepEqual(types('"rock AND roll"'), ["PHRASE:rock AND roll"]);
});

// The folding itself is checked on a real unaccent by
// deletion-audit/fixtures/92-accent-folding-verify.cjs.
test("columns match accent-insensitively, not with ILIKE (STATUS item 52)", () => {
  const { whereClause, params } = parseBooleanSearch("Künstler", ["u.last_name", "u.bio"], 1, null);
  assert.ok(!whereClause.includes("ILIKE"));
  assert.ok(whereClause.includes("unaccent(lower(COALESCE(u.last_name, ''))) LIKE unaccent(lower($1))"));
  assert.ok(whereClause.includes("unaccent(lower(COALESCE(u.bio, ''))) LIKE unaccent(lower($1))"));
  assert.deepEqual(params, ["%Künstler%"]);
});

test("a NOT term negates the whole folded match", () => {
  const { whereClause } = parseBooleanSearch("a NOT b", ["u.bio"], 1, null);
  assert.ok(whereClause.includes("NOT ("));
  assert.ok(whereClause.includes("LIKE unaccent(lower($2))"));
});

test("the tag placeholder is replaced everywhere in a template, not only the first time", () => {
  const tagConfig = {
    tagColumn: "t.name",
    existsTemplate: "EXISTS (SELECT 1 WHERE x LIKE $PARAM OR y LIKE $PARAM)",
    notExistsTemplate: "NOT EXISTS (SELECT 1 WHERE x LIKE $PARAM OR y LIKE $PARAM)",
    extraExistsTemplates: ["EXISTS (SELECT 1 WHERE z LIKE $PARAM OR w LIKE $PARAM)"],
    extraNotExistsTemplates: ["NOT EXISTS (SELECT 1 WHERE z LIKE $PARAM OR w LIKE $PARAM)"],
  };
  const { whereClause } = parseBooleanSearch("wandern NOT hiking", ["u.bio", "t.name"], 1, tagConfig);
  assert.ok(!whereClause.includes("$PARAM"));
  assert.ok(whereClause.includes("x LIKE $1 OR y LIKE $1"));
  assert.ok(whereClause.includes("z LIKE $1 OR w LIKE $1"));
  assert.ok(whereClause.includes("x LIKE $2 OR y LIKE $2"));
  assert.ok(whereClause.includes("z LIKE $2 OR w LIKE $2"));
});
