const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const userModel = require("../src/models/userModel");
const userController = require("../src/controllers/userController");

const originalPoolQuery = db.pool.query;
const originalIsBlocked = userModel.isBlockedBetween;
const originalNodeEnv = process.env.NODE_ENV;

const createResponse = () => ({
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
});

test.afterEach(() => {
  db.pool.query = originalPoolQuery;
  userModel.isBlockedBetween = originalIsBlocked;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

/**
 * The profile page reads GET /api/users/:id, whose SELECT lists its columns by
 * hand - it does not go through userModel's field lists. A language saved
 * successfully but missing from this query looks exactly like a failed save:
 * the form falls back through the precedence chain and shows English again.
 * That is the bug this pins.
 */
const stubProfileQuery = (row) => {
  const captured = { sql: null };

  db.pool.query = async (sql, params) => {
    captured.sql = sql;

    // ensureBadgeVisibilityColumns runs ALTER/other statements first; only the
    // profile SELECT carries the user id as its first parameter.
    if (!/FROM users u/.test(sql)) return { rows: [] };

    captured.params = params;

    // Return only what the query actually asks for. Without this the stub
    // hands back every column regardless of the SELECT, and the two
    // assertions below would pass against the unfixed controller - a test
    // that cannot fail is not a test.
    const projected = {};
    for (const [key, value] of Object.entries(row)) {
      if (new RegExp(`\\b${key}\\b`).test(sql)) projected[key] = value;
    }

    return { rows: [projected] };
  };

  return captured;
};

const profileRow = (overrides = {}) => ({
  id: 149,
  username: "languser",
  email: "lang@example.com",
  first_name: "Lang",
  last_name: "User",
  bio: null,
  postal_code: null,
  city: null,
  country: "DK",
  state: null,
  district: null,
  latitude: null,
  longitude: null,
  avatar_url: null,
  is_public: true,
  is_synthetic: false,
  preferred_language: "de",
  hide_badges: false,
  hidden_badge_ids: [],
  hidden_award_ids: [],
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

test("the profile query asks for preferred_language", async () => {
  process.env.NODE_ENV = "production";
  const captured = stubProfileQuery(profileRow());

  const req = { params: { id: "149" }, user: { id: 149 } };
  await userController.getUserById(req, createResponse());

  // Fails against the unfixed controller: the column was simply not selected.
  assert.match(captured.sql, /u\.preferred_language/);
});

test("the owner gets their stored language back", async () => {
  process.env.NODE_ENV = "production";
  stubProfileQuery(profileRow());

  const req = { params: { id: "149" }, user: { id: 149 } };
  const res = createResponse();
  await userController.getUserById(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.preferred_language, "de");
});

test("another viewer never receives it", async () => {
  process.env.NODE_ENV = "production";
  stubProfileQuery(profileRow());
  userModel.isBlockedBetween = async () => false;

  // A different logged-in user asking for the same public profile.
  const req = { params: { id: "149" }, user: { id: 999 } };
  const res = createResponse();
  await userController.getUserById(req, res);

  assert.equal(res.statusCode, 200);
  // The UI language is a personal setting, not public profile data. The
  // sanitizePublicUser allowlist is what keeps it out, and this pins that it
  // is never added to that list by accident.
  assert.equal(res.body.data.preferred_language, undefined);
  assert.equal(res.body.data.username, "languser");
});
