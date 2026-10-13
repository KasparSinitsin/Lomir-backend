// GET /api/users/:id/badges returns each award with the id of its focus area
// (STATUS item 11, display sites 3d-2). Behaviour against a real database:
// deletion-audit/fixtures/81-user-badges-tag-id-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const { getUserBadges } = require("../src/controllers/userTagsBadgesController");

const originalQuery = db.pool.query;

function run(awardRows) {
  const queries = [];
  db.pool.query = async (text, params) => {
    const sql = String(text);
    queries.push({ sql, params });
    if (sql.includes("FROM users") && sql.includes("is_public")) {
      return { rows: [{ id: 7, is_public: true, hide_badges: false }] };
    }
    if (sql.includes("FROM badge_awards ba")) return { rows: awardRows };
    return { rows: [] };
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { queries, res };
}

test.after(() => {
  db.pool.query = originalQuery;
});

test("the awards query selects the tag id next to the stored name", async () => {
  const { queries, res } = run([]);
  await getUserBadges({ params: { id: "7" }, user: { id: 7 } }, res);
  const awards = queries.find((q) => q.sql.includes("FROM badge_awards ba"));
  assert.ok(awards, "the awards query ran");
  assert.match(awards.sql, /ba\.tag_id/);
  assert.match(awards.sql, /tag\.name AS tag_name/);
});

test("rows reach the client as they are, tag_id included", async () => {
  const rows = [{ award_id: 5, tag_id: 38, tag_name: "Hiking" }];
  const { res } = run(rows);
  await getUserBadges({ params: { id: "7" }, user: { id: 7 } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, rows);
});
