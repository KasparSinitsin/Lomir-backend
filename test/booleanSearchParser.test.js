const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenize,
  hasBooleanOperators,
  validateBooleanQuery,
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
