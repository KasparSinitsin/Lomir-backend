const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const searchController = require("../src/controllers/searchController");

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

function createTeam(id, name) {
  return {
    id,
    name,
    description: `${name} description`,
    is_public: true,
    max_members: 5,
    owner_id: 500 + id,
    teamavatarUrl: null,
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-01-02T00:00:00.000Z").toISOString(),
    is_remote: false,
    current_members_count: "2",
    available_capacity: "3",
    open_role_count: "1",
    tags_json: null,
  };
}

function createUser(id, username) {
  return {
    id,
    username,
    first_name: username,
    last_name: "User",
    bio: `${username} bio`,
    postal_code: null,
    city: null,
    country: "DE",
    state: null,
    avatar_url: null,
    is_public: true,
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-01-02T00:00:00.000Z").toISOString(),
    tags: [],
    badges: [],
  };
}

function buildQueryStub() {
  const calls = [];
  const baselineTeams = [createTeam(1, "Alpha"), createTeam(2, "Beta")];
  const filteredTeams = [createTeam(2, "Beta")];
  const users = [createUser(11, "ada"), createUser(12, "bea")];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("SELECT latitude, longitude, postal_code, city FROM users")) {
      return {
        rows: [
          {
            latitude: null,
            longitude: null,
            postal_code: null,
            city: null,
          },
        ],
      };
    }

    const hasExclusion = sql.includes("tm_excluded");

    if (sql.includes("FROM teams t") && sql.includes("as total")) {
      return { rows: [{ total: hasExclusion ? "1" : "2" }] };
    }

    if (sql.includes("FROM users u") && sql.includes("as total")) {
      return { rows: [{ total: "2" }] };
    }

    if (sql.includes("FROM teams t") && sql.includes('t.teamavatar_url as "teamavatarUrl"')) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      const rows = hasExclusion ? filteredTeams : baselineTeams;
      return {
        rows:
          Number.isFinite(limit) && Number.isFinite(offset)
            ? rows.slice(offset, offset + limit)
            : rows,
      };
    }

    if (sql.includes("FROM users u") && sql.includes("u.username")) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      return {
        rows:
          Number.isFinite(limit) && Number.isFinite(offset)
            ? users.slice(offset, offset + limit)
            : users,
      };
    }

    throw new Error(`Unexpected SQL in test stub: ${sql}`);
  };

  return { query, calls };
}

function hasTeamExclusion(calls) {
  return calls.some(
    ({ sql }) =>
      sql.includes("FROM teams t") &&
      sql.includes("tm_excluded") &&
      sql.includes("tm_excluded.user_id"),
  );
}

function countTeamQueries(calls) {
  return calls.filter(({ sql }) => sql.includes("FROM teams t")).length;
}

test.afterEach(() => {
  db.pool.query = originalQuery;
});

test("getAllUsersAndTeams excludes own teams for authenticated users and preserves pagination totals", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "1", excludeOwnTeams: "true", searchType: "all" },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 1);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(res.body.pagination.totalItems, 3);
  assert.equal(res.body.pagination.totalPages, 2);
  assert.equal(res.body.pagination.hasNextPage, true);
  assert.deepEqual(
    res.body.data.teams.map((team) => team.id),
    [2],
  );
  assert.deepEqual(
    res.body.data.users.map((user) => user.id),
    [11],
  );
  assert.equal(hasTeamExclusion(calls), true);
});

test("getAllUsersAndTeams leaves team results unchanged when excludeOwnTeams is false", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "1", excludeOwnTeams: "false", searchType: "all" },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 2);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(res.body.pagination.totalItems, 4);
  assert.equal(res.body.pagination.totalPages, 2);
  assert.deepEqual(
    res.body.data.teams.map((team) => team.id),
    [1],
  );
  assert.equal(hasTeamExclusion(calls), false);
});

test("getAllUsersAndTeams ignores excludeOwnTeams for unauthenticated requests", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "1", excludeOwnTeams: "true", searchType: "all" },
    user: null,
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 2);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(hasTeamExclusion(calls), false);
});

test("getAllUsersAndTeams keeps searchType=users unchanged even if excludeOwnTeams is true", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "1", excludeOwnTeams: "true", searchType: "users" },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 0);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(res.body.pagination.totalItems, 2);
  assert.equal(res.body.pagination.totalPages, 2);
  assert.deepEqual(res.body.data.teams, []);
  assert.deepEqual(
    res.body.data.users.map((user) => user.id),
    [11],
  );
  assert.equal(countTeamQueries(calls), 0);
});

test("globalSearch excludes own teams for authenticated users and keeps user results unchanged", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "1",
      excludeOwnTeams: "true",
      searchType: "all",
    },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 1);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(res.body.pagination.totalItems, 3);
  assert.equal(res.body.pagination.totalPages, 2);
  assert.deepEqual(
    res.body.data.teams.map((team) => team.id),
    [2],
  );
  assert.deepEqual(
    res.body.data.users.map((user) => user.id),
    [11],
  );
  assert.equal(hasTeamExclusion(calls), true);
});

test("globalSearch leaves team results unchanged when excludeOwnTeams is false", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "1",
      excludeOwnTeams: "false",
      searchType: "all",
    },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 2);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(res.body.pagination.totalItems, 4);
  assert.equal(hasTeamExclusion(calls), false);
});

test("globalSearch ignores excludeOwnTeams for unauthenticated requests", async () => {
  const { query, calls } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "1",
      excludeOwnTeams: "true",
      searchType: "all",
    },
    user: null,
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 2);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(hasTeamExclusion(calls), false);
});
