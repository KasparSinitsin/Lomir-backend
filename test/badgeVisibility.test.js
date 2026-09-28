const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const {
  visibleAwardCondition,
  visibleBadgeCreditsSQL,
  visibleBadgesJsonSQL,
  visibleFocusAreaCondition,
} = require("../src/utils/badgeVisibilityUtils");
const { executeSearchQueries } = require("../src/utils/search/searchExecution");
const { buildUserFilters } = require("../src/utils/search/searchSqlBuilders");
const {
  appendUserSearchClause,
} = require("../src/utils/search/searchResultProcessing");

const originalQuery = db.pool.query;

// The queries are asserted as text rather than run: the suite has no database.
// What the badge visibility rule needs guarded is that no read path drops the
// condition again, and that is visible in the SQL a path generates.
function captureUserQuery(params, extra = {}) {
  const queries = [];
  db.pool.query = async (text) => {
    queries.push(text);
    return { rows: [{ total: "0" }] };
  };
  try {
    return executeSearchQueries({
      params: {
        badgeIds: [],
        capacityMode: null,
        direction: "desc",
        excludeOwnTeams: false,
        excludeTeamId: null,
        hasValidExcludeTeamId: false,
        hasValidMaxDistance: false,
        includeDemoData: true,
        includeTeams: false,
        includeUsers: true,
        isMatchSort: false,
        limit: 20,
        matchRoleId: null,
        maxDistance: null,
        offset: 0,
        openRolesOnly: false,
        sort: "newest",
        tagIds: [],
        userId: null,
        ...params,
      },
      ...extra,
    }).then(() => queries.join("\n;;\n"));
  } finally {
    db.pool.query = originalQuery;
  }
}

test("the visibility condition covers both switches, not just the per-award one", () => {
  const sql = visibleAwardCondition({
    awardAlias: "ba",
    userAlias: "u",
    viewerIsOwnerExpr: "$2::BOOLEAN",
  });

  assert.match(sql, /hide_badges/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(sql, /\$2::BOOLEAN/);
});

test("an unknown viewer is a stranger, never the owner", () => {
  // `(<expr>) = TRUE` is what makes a NULL viewer id fail closed: NULL = TRUE
  // is NULL, so the row only survives on the visibility branch.
  const sql = visibleAwardCondition({
    viewerIsOwnerExpr: "ba.awarded_to_user_id = $2",
  });

  assert.match(sql, /\(ba\.awarded_to_user_id = \$2\) = TRUE/);
  assert.match(visibleAwardCondition(), /\(FALSE\) = TRUE/);
});

test("the badge list is aggregated from awards, not from the badge views", () => {
  const sql = visibleBadgesJsonSQL({ userAlias: "u" });

  // The views aggregate awards into per-badge totals before any visibility rule
  // can apply, so a hidden award would still raise the totals it feeds.
  assert.doesNotMatch(sql, /v_user_badges_with/);
  assert.match(sql, /FROM badge_awards ba_vis/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(visibleBadgeCreditsSQL(), /hidden_award_ids/);
});

test("a focus area survives on its own or on a shown award, and goes with a hidden one", () => {
  const sql = visibleFocusAreaCondition({
    userAlias: "u",
    tagAlias: "t",
    viewerIsOwnerExpr: "$2::BOOLEAN",
  });

  // No linked award at all: nothing is being hidden, the focus area stays.
  assert.match(sql, /NOT EXISTS/);
  // At least one award still shown: that award is evidence enough.
  assert.match(sql, /OR EXISTS/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(sql, /\$2::BOOLEAN/);
});

test("the search result list filters the badges it serves", async () => {
  const sql = await captureUserQuery({});

  // This is the leak itself: the list used to read the view with no rule at all
  // and render whatever arrived on the user's row.
  assert.doesNotMatch(sql, /v_user_badges_with_category_totals/);
  assert.match(sql, /as badges/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(sql, /hide_badges/);
});

test("the search result list drops focus areas whose every award is hidden", async () => {
  const sql = await captureUserQuery({});

  assert.match(sql, /as tags/);
  // `ut.badge_credits` is denormalized from every award, hidden ones included.
  assert.doesNotMatch(sql, /'badge_credits', COALESCE\(ut\.badge_credits, 0\)/);
  assert.match(sql, /FROM badge_awards ba_link/);
});

test("a hidden award does not make its owner findable by badge name", () => {
  const { query } = appendUserSearchClause({
    userQuery: "SELECT u.id FROM users u WHERE 1=1",
    userParams: [],
    query: "Empathetic",
    searchTerm: "%Empathetic%",
    useBoolean: false,
    startParamIndex: 1,
  });

  assert.doesNotMatch(query, /v_user_badges_with_totals/);
  assert.match(query, /FROM badge_awards ba_name/);
  assert.match(query, /hidden_award_ids/);
});

test("a hidden award does not make its owner findable by the badge filter", () => {
  const { whereFragments } = buildUserFilters(
    {
      badgeIds: [7],
      combineTagBadgeWithOr: false,
      direction: "desc",
      excludeMatchingUser: false,
      includeDemoData: true,
      tagIds: [],
      userId: null,
      userLocation: null,
    },
    1,
  );

  const sql = whereFragments.join("\n");
  assert.match(sql, /FROM badge_awards ba_filter/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(sql, /hide_badges/);
});

test("a hidden focus area does not make its owner findable by its name", () => {
  for (const useBoolean of [false, true]) {
    const { query } = appendUserSearchClause({
      userQuery: "SELECT u.id FROM users u WHERE 1=1",
      userParams: [],
      query: useBoolean ? "Cooking AND Baking" : "Cooking",
      searchTerm: "%Cooking%",
      useBoolean,
      startParamIndex: 1,
    });

    // A focus area every hidden award took with it is shown nowhere, so
    // matching its name would put it back within reach.
    assert.match(query, /FROM user_tags ut2/);
    assert.match(query, /ba_link/, `no visibility rule (useBoolean=${useBoolean})`);
    // The bare column match is what used to let it through.
    assert.doesNotMatch(query, /\bt\.name ILIKE/);
  }
});

test("a hidden focus area does not make its owner findable by the focus-area filter", () => {
  const { whereFragments } = buildUserFilters(
    {
      badgeIds: [],
      combineTagBadgeWithOr: false,
      direction: "desc",
      excludeMatchingUser: false,
      includeDemoData: true,
      tagIds: [32],
      userId: null,
      userLocation: null,
    },
    1,
  );

  const sql = whereFragments.join("\n");
  assert.match(sql, /FROM user_tags ut_filter/);
  assert.match(sql, /JOIN users u_tag_filter/);
  assert.match(sql, /hidden_award_ids/);
});
