const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const {
  visibleAwardCondition,
  visibleBadgeCreditsSQL,
  hiddenBadgeCreditsSQL,
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

test("a self-added focus area is always shown, an award-created one waits", () => {
  const sql = visibleFocusAreaCondition({
    userAlias: "u",
    tagAlias: "t",
    linkAlias: "ut",
    viewerIsOwnerExpr: "$2::BOOLEAN",
  });

  // The user put it there. A hidden award takes its credits, never the area.
  assert.match(sql, /ut\.source <> 'award'/);
  // One created by an award needs one visible award, and nothing else will do.
  assert.match(sql, /OR EXISTS/);
  assert.match(sql, /hidden_award_ids/);
  assert.match(sql, /\$2::BOOLEAN/);

  // 🔴 The rule this replaces kept any focus area with no linked award, which
  // is exactly how a self-chosen one disappeared the moment its badge was
  // hidden — measured on user 374's `AI/ML`, 2026-09-28. Provenance decides it
  // now, not the presence of awards, so the old branch must be gone.
  assert.doesNotMatch(sql, /NOT EXISTS/);
});

test("the focus-area rule reads the user_tags row it was handed", () => {
  // Every call site passes `linkAlias`, because the alias differs per query
  // (`ut`, `ut_filter`, `ut2`) and a stale default would compile into SQL that
  // reads the wrong row — or fails to compile at all.
  const sql = visibleFocusAreaCondition({ linkAlias: "ut_filter" });

  assert.match(sql, /ut_filter\.source/);
  assert.doesNotMatch(sql, /\but\.source/);
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

test("credits count only once the award is shown, and what waits comes alongside", () => {
  const sql = visibleBadgesJsonSQL({ userAlias: "u" });

  // Shown and waiting are split in one pass over the same rows.
  assert.match(sql, /SUM\(credits\) FILTER \(WHERE shown\)/);
  assert.match(sql, /SUM\(credits\) FILTER \(WHERE NOT shown\)/);
  assert.match(sql, /'hidden_credits'/);
  assert.match(sql, /'hidden_award_count'/);
  assert.match(sql, /'category_hidden_credits'/);

  // `shown` is visibility to others, not the viewer's own permission: that is
  // what makes the owner's own total exclude an award still waiting.
  assert.match(sql, /\(FALSE\) = TRUE[\s\S]*AS shown/);
});

test("the waiting-credits total is the inverse of the visible one", () => {
  const sql = hiddenBadgeCreditsSQL({ userAlias: "u" });

  assert.match(sql, /AND NOT \(/);
  assert.match(sql, /hidden_award_ids/);
  // No viewer parameter: for a stranger the awards are gone before this is asked,
  // so it is always 0 and the payload keeps one shape.
  assert.doesNotMatch(sql, /\$\d/);
  assert.match(visibleBadgeCreditsSQL(), /hidden_award_ids/);
});

test("a stranger is never told that awards are waiting", async () => {
  const badgeRow = {
    id: 373,
    username: "benny",
    is_public: true,
    hide_badges: false,
    badges: [],
    total_badge_credits: 0,
    hidden_badge_credits: 7,
    updated_at: new Date().toISOString(),
  };

  db.pool.query = async (sql) => {
    if (String(sql).includes("FROM users u")) return { rows: [badgeRow] };
    return { rows: [] };
  };
  const { getUserById } = require("../src/controllers/userController");
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };

  await getUserById({ params: { id: "373" }, user: null }, res);

  // It would let a stranger infer that this user has hidden awards, which is the
  // inference the whole visibility rule exists to prevent.
  assert.equal(res.body.data.hidden_badge_credits, undefined);
});
