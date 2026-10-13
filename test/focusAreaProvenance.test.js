const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");

const originalConnect = db.pool.connect;
const originalQuery = db.pool.query;

// The queries are recorded rather than run: the suite has no database. What has
// to stay guarded is that these three writers keep saying which kind of focus
// area they are touching, and that is visible in the SQL they issue.
function recordQueries(responses = []) {
  const queries = [];
  const client = {
    query: async (text, params) => {
      const sql = String(text);
      queries.push({ sql, params });
      const hit = responses.find(([needle]) => sql.includes(needle));
      return { rows: hit ? hit[1] : [] };
    },
    release() {},
  };
  db.pool.connect = async () => client;
  db.pool.query = async () => ({ rows: [] });
  return queries;
}

// ⚠️ **The stub stays up for the whole file, and restoring it per test is a
// trap.** `deleteBadgeAward` kicks off `refreshBadgeViews(pool)` after COMMIT
// without awaiting it. Restoring inside a test's `finally` hands that pending
// call the real pool, and it then runs `REFRESH MATERIALIZED VIEW` against
// whatever `DATABASE_URL` points at — which is what happened on the first run
// of this file, 2026-09-29. `node --test` gives each file its own process, so
// leaving the stub in place until the end costs nothing.
//
// 🟢 The "Refreshed materialized view" lines this file prints come from the stub
// answering that refresh, not from Postgres. Verified by running the file with
// DATABASE_URL pointing nowhere: same output, same pass.
test.after(() => {
  db.pool.connect = originalConnect;
  db.pool.query = originalQuery;
});

const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(c) { this.statusCode = c; return this; },
  json(p) { this.body = p; return this; },
});

const find = (queries, needle) =>
  queries.find((q) => q.sql.includes(needle));

test("saving a profile replaces only the focus areas the user owns", async () => {
  const queries = recordQueries();
  {
    const { updateUserTags } = require("../src/controllers/userTagsBadgesController");
    await updateUserTags(
      { params: { id: "187" }, user: { id: 187 }, body: { tags: [{ tag_id: 900 }] } },
      makeRes(),
    );
  }

  const del = find(queries, "DELETE FROM user_tags");
  assert.ok(del, "no delete was issued");
  // 🔴 Without this the delete took the award-created rows with it and the
  // re-insert adopted them as the user's own — the defect `source` exists for.
  assert.match(del.sql, /source = 'user'/);

  const insert = find(queries, "INSERT INTO user_tags");
  assert.ok(insert, "no insert was issued");
  assert.match(insert.sql, /'user'/);
  // A tag the user puts in the list themselves becomes theirs, even if an award
  // created the row first.
  assert.match(insert.sql, /ON CONFLICT[\s\S]*source = 'user'/);
});

test("deleting an award drops the focus area it created, and only that kind", async () => {
  const queries = recordQueries([
    [
      "DELETE FROM badge_awards",
      [{ id: 1355, awarded_to_user_id: 187, badge_id: 5, credits: 3, tag_id: 900 }],
    ],
  ]);
  {
    const { deleteBadgeAward } = require("../src/controllers/badgeController");
    await deleteBadgeAward({ user: { id: 187 }, params: { awardId: "1355" } }, makeRes());
  }

  const drop = find(queries, "DELETE FROM user_tags");
  assert.ok(drop, "the orphaned focus area was never considered");
  assert.match(drop.sql, /source = 'award'/);
  // Nothing may go while an award still hangs on it.
  assert.match(drop.sql, /NOT EXISTS/);
  assert.deepEqual(drop.params, [187, 900]);
});

test("deleting an award takes its id out of the visibility switch", async () => {
  const queries = recordQueries([
    [
      "DELETE FROM badge_awards",
      [{ id: 1355, awarded_to_user_id: 187, badge_id: 5, credits: 3, tag_id: 900 }],
    ],
  ]);
  {
    const { deleteBadgeAward } = require("../src/controllers/badgeController");
    await deleteBadgeAward({ user: { id: 187 }, params: { awardId: "1355" } }, makeRes());
  }

  const cleanup = find(queries, "ARRAY_REMOVE");
  assert.ok(cleanup, "hidden_award_ids keeps pointing at a deleted award");
  assert.match(cleanup.sql, /hidden_award_ids/);
  assert.deepEqual(cleanup.params, [1355, 187]);
});

test("an award without a tag touches neither", async () => {
  const queries = recordQueries([
    [
      "DELETE FROM badge_awards",
      [{ id: 1400, awarded_to_user_id: 187, badge_id: 5, credits: 2, tag_id: null }],
    ],
  ]);
  {
    const { deleteBadgeAward } = require("../src/controllers/badgeController");
    await deleteBadgeAward({ user: { id: 187 }, params: { awardId: "1400" } }, makeRes());
  }

  assert.equal(find(queries, "DELETE FROM user_tags"), undefined);
  // The switch is still cleaned: an award can be hidden with no tag on it.
  assert.ok(find(queries, "ARRAY_REMOVE"));
});
