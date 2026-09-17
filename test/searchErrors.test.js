const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const searchController = require("../src/controllers/searchController");
const { validateBooleanQuery } = require("../src/utils/booleanSearchParser");
const { SEARCH_ERROR_CODES } = require("../src/config/searchErrors");

const originalQuery = db.pool.query;

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test.afterEach(() => {
  db.pool.query = originalQuery;
});

test("validateBooleanQuery names each failure with a code", () => {
  const cases = [
    ["", SEARCH_ERROR_CODES.QUERY_EMPTY, undefined],
    ['"react', SEARCH_ERROR_CODES.UNCLOSED_QUOTE, undefined],
    ["AND react", SEARCH_ERROR_CODES.STARTS_WITH_OPERATOR, { operator: "AND" }],
    ["react or", SEARCH_ERROR_CODES.ENDS_WITH_OPERATOR, { operator: "OR" }],
    ["react NOT AND vue", SEARCH_ERROR_CODES.NOT_WITHOUT_TERM, undefined],
    ["react OR OR vue", SEARCH_ERROR_CODES.OPERATOR_WITHOUT_TERMS, { operator: "OR" }],
  ];

  for (const [query, code, values] of cases) {
    const result = validateBooleanQuery(query);
    assert.equal(result.valid, false, query);
    assert.equal(result.code, code, query);
    assert.deepEqual(result.values, values, query);
    assert.ok(result.message, `${query} keeps its message`);
  }
});

test("validateBooleanQuery reports a typed '-' as the NOT operator", () => {
  const result = validateBooleanQuery("react -");
  assert.equal(result.code, SEARCH_ERROR_CODES.ENDS_WITH_OPERATOR);
  assert.deepEqual(result.values, { operator: "NOT" });
});

test("globalSearch answers a too-short query with QUERY_TOO_SHORT", async () => {
  const res = createResponse();

  await searchController.globalSearch({ query: { query: "a" } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, SEARCH_ERROR_CODES.QUERY_TOO_SHORT);
  assert.equal(res.body.message, "Search query must be at least 2 characters long");
});

test("globalSearch answers an invalid boolean query with its code and operator", async () => {
  db.pool.query = async () => ({ rows: [] });
  const res = createResponse();

  await searchController.globalSearch({ query: { query: "react AND" } }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    success: false,
    code: SEARCH_ERROR_CODES.ENDS_WITH_OPERATOR,
    values: { operator: "AND" },
    message: "Invalid boolean search query",
    error: 'Query cannot end with "AND".',
  });
});

test("globalSearch answers a database failure with SEARCH_FAILED", async () => {
  db.pool.query = async () => {
    throw new Error("connection lost");
  };
  const res = createResponse();

  await searchController.globalSearch(
    { query: { query: "react" }, user: { id: 7 } },
    res,
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, SEARCH_ERROR_CODES.SEARCH_FAILED);
  assert.equal(res.body.message, "Error performing search");
});

test("getAllUsersAndTeams answers a database failure with SEARCH_FAILED", async () => {
  db.pool.query = async () => {
    throw new Error("connection lost");
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(
    { query: {}, user: { id: 7 } },
    res,
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, SEARCH_ERROR_CODES.SEARCH_FAILED);
  assert.equal(res.body.message, "Error fetching data");
});
