const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const { getTeamById } = require("../src/controllers/teamReadController");

const originalQuery = db.pool.query;

// The queries are asserted as text rather than run: the suite has no database.
// What matters here is that this read path does not drop the visibility rule
// again — and that is visible in the SQL it generates. Same approach as
// `badgeVisibility.test.js`.
async function captureTagsQuery() {
  const queries = [];
  db.pool.query = async (text) => {
    queries.push(String(text));
    if (String(text).includes("FROM teams t")) {
      return { rows: [{ id: 42, name: "Test Team", is_public: true }] };
    }
    return { rows: [] };
  };

  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };

  try {
    await getTeamById({ params: { id: "42" }, user: { id: 331 } }, res);
  } finally {
    db.pool.query = originalQuery;
  }

  const tagsQuery = queries.find((q) => q.includes("FROM team_tags tt"));
  assert.ok(tagsQuery, "the team-tags query was never issued");
  return tagsQuery;
}

test("a team's focus-area credits skip an award its recipient has not made visible", async () => {
  const sql = await captureTagsQuery();

  // The join that feeds badge_credits, linked_badge_count and awardee_count.
  assert.match(sql, /LEFT JOIN badge_awards ba/);
  assert.match(sql, /FROM users recipient\b/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(sql, /hide_badges/);
});

test("the pill's colour is decided on the same visible awards as its credits", async () => {
  const sql = await captureTagsQuery();

  // `dominant_badge_category` is a separate subquery, and it drives the pill
  // colour. Filtering only the credit join would leave a hidden award colouring
  // a pill that counts nothing — the tell Julia saw was exactly a colour that
  // disagreed with the profile.
  const subquery = sql.slice(sql.indexOf("FROM badge_awards ba2"));
  assert.match(subquery, /FROM users recipient2\b/);
  assert.match(subquery, /hidden_award_ids/);
  assert.match(subquery, /hide_badges/);
});

test("no owner exception on a team surface, unlike a profile", async () => {
  const sql = await captureTagsQuery();

  // A team is shared, so the recipient does not see their own waiting award
  // counted here (BE #340). `(FALSE) = TRUE` is the condition's owner branch
  // switched off; a viewer placeholder appearing here would be the regression.
  const occurrences = sql.match(/\(FALSE\) = TRUE/g) || [];
  assert.equal(occurrences.length, 2, "both badge reads must refuse the owner exception");
  assert.doesNotMatch(sql, /awarded_to_user_id = \$2/);
});
