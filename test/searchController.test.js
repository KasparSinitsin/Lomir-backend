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
    postal_code: id === 1 ? "55116" : null,
    city: id === 1 ? "Mainz" : null,
    state: id === 1 ? "Rhineland-Palatinate" : null,
    country: "DE",
    latitude: id === 1 ? "49.999" : null,
    longitude: id === 1 ? "8.271" : null,
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
    postal_code: id === 11 ? "12555" : id === 12 ? "12557" : null,
    city: id === 11 ? "Berlin" : null,
    country: "DE",
    state: id === 11 ? "Berlin" : null,
    avatar_url: null,
    is_public: true,
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updated_at: new Date("2026-01-02T00:00:00.000Z").toISOString(),
    latitude: id === 11 ? "52.445" : null,
    longitude: id === 11 ? "13.581" : null,
    tags: [],
    badges: [],
  };
}

function createRole(id, roleName, overrides = {}) {
  return {
    id,
    role_name: roleName,
    bio: `${roleName} bio`,
    city: null,
    country: "DE",
    state: null,
    postal_code: null,
    latitude: null,
    longitude: null,
    max_distance_km: null,
    is_remote: false,
    is_synthetic: false,
    status: "open",
    created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    team_id: 100 + id,
    team_name: `Team ${roleName}`,
    team_avatar_url: null,
    team_city: null,
    team_country: "DE",
    team_is_synthetic: false,
    team_is_remote: false,
    ...overrides,
  };
}

function buildQueryStub({
  userLocation = {
    latitude: null,
    longitude: null,
    postal_code: null,
    city: null,
  },
  teams = null,
} = {}) {
  const calls = [];
  const baselineTeams = teams ?? [createTeam(1, "Alpha"), createTeam(2, "Beta")];
  const filteredTeams = baselineTeams.filter((team) => team.id !== 1);
  const users = [createUser(11, "ada"), createUser(12, "bea")];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("SELECT latitude, longitude, postal_code, city FROM users")) {
      return {
        rows: [userLocation],
      };
    }

    const hasExclusion = sql.includes("tm_excluded");

    if (sql.includes("FROM teams t") && sql.includes("as total")) {
      return {
        rows: [{ total: String(hasExclusion ? filteredTeams.length : baselineTeams.length) }],
      };
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

    if (
      sql.includes("SELECT COUNT(DISTINCT vr.id) AS total") &&
      sql.includes("FROM team_vacant_roles vr")
    ) {
      return { rows: [{ total: "0" }] };
    }

    if (
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("t.teamavatar_url AS team_avatar_url")
    ) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in test stub: ${sql}`);
  };

  return { query, calls };
}

function buildTeamMatchSortQueryStub() {
  const team = {
    ...createTeam(1, "Remote Team"),
    is_remote: true,
  };

  const query = async (sql, params = []) => {
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

    if (
      sql.includes("SELECT latitude, longitude, country") &&
      sql.includes("FROM users")
    ) {
      return {
        rows: [
          {
            latitude: null,
            longitude: null,
            country: "DE",
          },
        ],
      };
    }

    if (sql.includes("SELECT tag_id FROM user_tags")) {
      return { rows: [{ tag_id: 1 }, { tag_id: 2 }] };
    }

    if (sql.includes("SELECT DISTINCT badge_id FROM badge_awards")) {
      return {
        rows: Array.from({ length: 15 }, (_, index) => ({
          badge_id: index + 1,
        })),
      };
    }

    if (
      sql.includes("SELECT id, is_remote, latitude, longitude, country") &&
      sql.includes("FROM teams")
    ) {
      return {
        rows: [
          {
            id: 1,
            is_remote: true,
            latitude: null,
            longitude: null,
            country: "DE",
          },
        ],
      };
    }

    if (sql.includes("SELECT team_id, tag_id") && sql.includes("FROM team_tags")) {
      return {
        rows: [
          { team_id: 1, tag_id: 1 },
          { team_id: 1, tag_id: 2 },
          { team_id: 1, tag_id: 3 },
          { team_id: 1, tag_id: 4 },
          { team_id: 1, tag_id: 5 },
        ],
      };
    }

    if (
      sql.includes("SELECT DISTINCT tm.team_id, ba.badge_id") &&
      sql.includes("FROM team_members tm")
    ) {
      return {
        rows: Array.from({ length: 30 }, (_, index) => ({
          team_id: 1,
          badge_id: index + 1,
        })),
      };
    }

    if (sql.includes("FROM teams t") && sql.includes("as total")) {
      return { rows: [{ total: "1" }] };
    }

    if (sql.includes("FROM teams t") && sql.includes('t.teamavatar_url as "teamavatarUrl"')) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      const rows =
        Number.isFinite(limit) && Number.isFinite(offset)
          ? [team].slice(offset, offset + limit)
          : [team];
      return { rows };
    }

    throw new Error(`Unexpected SQL in team match sort test stub: ${sql}`);
  };

  return { query };
}

function buildDemoDataQueryStub() {
  const calls = [];
  const teams = [
    { ...createTeam(1, "Demo Team"), is_synthetic: true },
    { ...createTeam(2, "Real Team"), is_synthetic: false },
  ];
  const users = [
    { ...createUser(11, "demo-user"), is_synthetic: true },
    { ...createUser(12, "real-user"), is_synthetic: false },
  ];
  const roles = [
    createRole(21, "Demo Role", {
      is_synthetic: true,
      team_id: 1,
      team_name: "Demo Team",
      team_is_synthetic: true,
    }),
    createRole(22, "Real Role", {
      is_synthetic: false,
      team_id: 2,
      team_name: "Real Team",
      team_is_synthetic: false,
    }),
  ];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    const teamRows = sql.includes("t.is_synthetic IS NOT TRUE")
      ? teams.filter((team) => team.is_synthetic !== true)
      : teams;
    const userRows = sql.includes("u.is_synthetic IS NOT TRUE")
      ? users.filter((user) => user.is_synthetic !== true)
      : users;
    const roleRows = sql.includes("vr.is_synthetic IS NOT TRUE")
      ? roles.filter((role) => role.is_synthetic !== true)
      : roles;

    if (sql.includes("FROM teams t") && sql.includes("as total")) {
      return { rows: [{ total: String(teamRows.length) }] };
    }

    if (sql.includes("FROM users u") && sql.includes("as total")) {
      return { rows: [{ total: String(userRows.length) }] };
    }

    if (
      sql.includes("SELECT COUNT(DISTINCT vr.id) AS total") &&
      sql.includes("FROM team_vacant_roles vr")
    ) {
      return { rows: [{ total: String(roleRows.length) }] };
    }

    if (sql.includes("FROM teams t") && sql.includes('t.teamavatar_url as "teamavatarUrl"')) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      return {
        rows:
          Number.isFinite(limit) && Number.isFinite(offset)
            ? teamRows.slice(offset, offset + limit)
            : teamRows,
      };
    }

    if (sql.includes("FROM users u") && sql.includes("u.username")) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      return {
        rows:
          Number.isFinite(limit) && Number.isFinite(offset)
            ? userRows.slice(offset, offset + limit)
            : userRows,
      };
    }

    if (
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("t.teamavatar_url AS team_avatar_url")
    ) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      return {
        rows:
          Number.isFinite(limit) && Number.isFinite(offset)
            ? roleRows.slice(offset, offset + limit)
            : roleRows,
      };
    }

    if (sql.includes("FROM team_vacant_role_tags vrt")) {
      return { rows: [] };
    }

    if (sql.includes("FROM team_vacant_role_badges vrb")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in demo data test stub: ${sql}`);
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

function hasTeamSyntheticFilter(calls) {
  return calls.some(
    ({ sql }) =>
      sql.includes("FROM teams t") &&
      sql.includes("t.is_synthetic IS NOT TRUE"),
  );
}

function hasUserSyntheticFilter(calls) {
  return calls.some(
    ({ sql }) =>
      sql.includes("FROM users u") &&
      sql.includes("u.is_synthetic IS NOT TRUE"),
  );
}

function hasRoleSyntheticFilter(calls) {
  return calls.some(
    ({ sql }) =>
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("vr.is_synthetic IS NOT TRUE"),
  );
}

function getTeamDataQuery(calls) {
  return calls.find(
    ({ sql }) =>
      sql.includes("FROM teams t") &&
      sql.includes('t.teamavatar_url as "teamavatarUrl"'),
  )?.sql;
}

function getRoleDataQuery(calls) {
  return calls.find(
    ({ sql }) =>
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("t.teamavatar_url AS team_avatar_url"),
  )?.sql;
}

function hasTeamRemoteOnlyProximityFilter(calls) {
  return calls.some(
    ({ sql }) =>
      sql.includes("FROM teams t") &&
      (sql.includes("t.is_remote = TRUE") ||
        sql.includes("t.is_remote IS NOT TRUE")),
  );
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

test("getAllUsersAndTeams nearest proximity sort paginates remote teams after local teams", async () => {
  const remoteTeam = {
    ...createTeam(3, "Remote"),
    is_remote: true,
    postal_code: null,
    city: null,
    state: null,
    latitude: null,
    longitude: null,
  };
  const { query, calls } = buildQueryStub({
    userLocation: {
      latitude: "52.52",
      longitude: "13.405",
      postal_code: "10115",
      city: "Berlin",
    },
    teams: [createTeam(1, "Alpha"), createTeam(2, "Beta"), remoteTeam],
  });
  db.pool.query = query;

  const pageOneReq = {
    query: {
      page: "1",
      limit: "2",
      sortBy: "proximity",
      sortDir: "asc",
      searchType: "teams",
    },
    user: { id: 99 },
  };
  const pageOneRes = createResponse();

  await searchController.getAllUsersAndTeams(pageOneReq, pageOneRes);

  const teamSql = getTeamDataQuery(calls);
  assert.equal(pageOneRes.statusCode, 200);
  assert.deepEqual(
    pageOneRes.body.data.teams.map((team) => team.id),
    [1, 2],
  );
  assert.equal(pageOneRes.body.data.teams.some((team) => team.is_remote), false);
  assert.equal(hasTeamRemoteOnlyProximityFilter(calls), false);
  assert.match(
    teamSql,
    /CASE WHEN t\.is_remote IS TRUE THEN 2 WHEN t\.latitude IS NULL OR t\.longitude IS NULL THEN 1 ELSE 0 END\) ASC, distance_km ASC/,
  );
  assert.doesNotMatch(teamSql, /WHEN distance_km >= 999999/);

  const pageTwoReq = {
    ...pageOneReq,
    query: {
      ...pageOneReq.query,
      page: "2",
    },
  };
  const pageTwoRes = createResponse();

  await searchController.getAllUsersAndTeams(pageTwoReq, pageTwoRes);

  assert.equal(pageTwoRes.statusCode, 200);
  assert.deepEqual(
    pageTwoRes.body.data.teams.map((team) => team.id),
    [3],
  );
  assert.equal(pageTwoRes.body.data.teams[0].is_remote, true);
});

test("globalSearch remote proximity sort keeps non-remote teams in the result set", async () => {
  const { query, calls } = buildQueryStub({
    userLocation: {
      latitude: "52.52",
      longitude: "13.405",
      postal_code: "10115",
      city: "Berlin",
    },
  });
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "10",
      sortBy: "proximity",
      sortDir: "remote",
      searchType: "teams",
    },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  const teamSql = getTeamDataQuery(calls);
  assert.equal(res.statusCode, 200);
  assert.equal(hasTeamRemoteOnlyProximityFilter(calls), false);
  assert.match(
    teamSql,
    /CASE WHEN t\.is_remote IS TRUE THEN 0 ELSE 1 END\) ASC, distance_km DESC/,
  );
});

test("globalSearch proximity sort applies distance ordering to open roles in all results", async () => {
  const { query, calls } = buildQueryStub({
    userLocation: {
      latitude: "52.52",
      longitude: "13.405",
      postal_code: "10115",
      city: "Berlin",
    },
  });
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "15",
      sortBy: "proximity",
      sortDir: "asc",
      searchType: "all",
    },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  const roleSql = getRoleDataQuery(calls);
  assert.equal(res.statusCode, 200);
  assert.match(roleSql, /distance_km/);
  assert.match(roleSql, /vr\.is_remote IS TRUE/);
  assert.match(roleSql, /vr\.latitude IS NULL OR vr\.longitude IS NULL/);
  assert.match(roleSql, /ORDER BY .*distance_km ASC/s);
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

test("search team results include public location and approximate map coordinates", async () => {
  const { query } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "10",
      searchType: "teams",
    },
    user: null,
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.teams.length, 2);

  const team = res.body.data.teams[0];
  assert.equal(team.postal_code, "55116");
  assert.equal(team.city, "Mainz");
  assert.equal(team.state, "Rhineland-Palatinate");
  assert.equal(team.country, "DE");
  assert.equal(team.latitude, 50);
  assert.equal(team.longitude, 8.3);
  assert.equal(team.approximate_latitude, 50);
  assert.equal(team.approximate_longitude, 8.3);
  assert.equal(team.is_remote, false);
});

test("search user results include public location and approximate map coordinates", async () => {
  const { query } = buildQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "10",
      searchType: "users",
    },
    user: null,
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.users.length, 2);

  const user = res.body.data.users[0];
  assert.equal(user.postal_code, "12555");
  assert.equal(user.city, "Berlin");
  assert.equal(user.state, "Berlin");
  assert.equal(user.country, "DE");
  assert.equal(user.latitude, 52.4);
  assert.equal(user.longitude, 13.6);
  assert.equal(user.approximate_latitude, 52.4);
  assert.equal(user.approximate_longitude, 13.6);
  assert.equal(user.is_public, true);

  const derivedUser = res.body.data.users[1];
  assert.equal(derivedUser.postal_code, "12557");
  assert.equal(derivedUser.city, "Berlin");
  assert.equal(derivedUser.state, "Berlin");
  assert.equal(derivedUser.country, "DE");
  assert.equal(derivedUser.district, "Köpenick");
});

test("getAllUsersAndTeams with includeDemoData=false excludes synthetic rows", async () => {
  const { query, calls } = buildDemoDataQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "10", searchType: "all", includeDemoData: "false" },
    user: null,
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 1);
  assert.equal(res.body.pagination.totalUsers, 1);
  assert.equal(res.body.pagination.totalRoles, 1);
  assert.equal(res.body.pagination.totalItems, 3);
  assert.deepEqual(
    res.body.data.teams.map((team) => team.id),
    [2],
  );
  assert.deepEqual(
    res.body.data.users.map((user) => user.id),
    [12],
  );
  assert.deepEqual(
    res.body.data.roles.map((role) => role.id),
    [22],
  );
  assert.equal(hasTeamSyntheticFilter(calls), true);
  assert.equal(hasUserSyntheticFilter(calls), true);
  assert.equal(hasRoleSyntheticFilter(calls), true);
});

test("globalSearch with includeDemoData=false excludes synthetic rows", async () => {
  const { query, calls } = buildDemoDataQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "10",
      searchType: "all",
      includeDemoData: "false",
    },
    user: null,
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 1);
  assert.equal(res.body.pagination.totalUsers, 1);
  assert.equal(res.body.pagination.totalRoles, 1);
  assert.equal(res.body.pagination.totalItems, 3);
  assert.deepEqual(
    res.body.data.teams.map((team) => team.id),
    [2],
  );
  assert.deepEqual(
    res.body.data.users.map((user) => user.id),
    [12],
  );
  assert.deepEqual(
    res.body.data.roles.map((role) => role.id),
    [22],
  );
  assert.equal(hasTeamSyntheticFilter(calls), true);
  assert.equal(hasUserSyntheticFilter(calls), true);
  assert.equal(hasRoleSyntheticFilter(calls), true);
});

test("default search behavior includes synthetic rows when includeDemoData is omitted", async () => {
  const { query, calls } = buildDemoDataQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "10", searchType: "all" },
    user: null,
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pagination.totalTeams, 2);
  assert.equal(res.body.pagination.totalUsers, 2);
  assert.equal(res.body.pagination.totalRoles, 2);
  assert.equal(res.body.pagination.totalItems, 6);
  assert.deepEqual(
    res.body.data.teams.map((team) => team.id),
    [1, 2],
  );
  assert.deepEqual(
    res.body.data.users.map((user) => user.id),
    [11, 12],
  );
  assert.deepEqual(
    res.body.data.roles.map((role) => role.id),
    [21, 22],
  );
  assert.equal(hasTeamSyntheticFilter(calls), false);
  assert.equal(hasUserSyntheticFilter(calls), false);
  assert.equal(hasRoleSyntheticFilter(calls), false);
});

test("getAllUsersAndTeams returns team match scores that stay consistent with match_details", async () => {
  const { query } = buildTeamMatchSortQueryStub();
  db.pool.query = query;

  const req = {
    query: { page: "1", limit: "10", sortBy: "match", searchType: "teams" },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.getAllUsersAndTeams(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.teams.length, 1);
  assert.deepEqual(res.body.data.users, []);
  assert.equal(res.body.data.teams[0].match_score, 0.61);
  assert.equal(res.body.data.teams[0].best_match_score, 0.61);
  assert.equal(res.body.data.teams[0].shared_tag_count, 2);
  assert.equal(res.body.data.teams[0].shared_badge_count, 15);
  assert.equal(res.body.data.teams[0].match_type, "team_profile_match");
  assert.deepEqual(res.body.data.teams[0].match_details, {
    tag_score: 0.4,
    badge_score: 0.5,
    distance_score: 1,
    shared_tag_count: 2,
    total_team_tags: 5,
    shared_badge_count: 15,
    total_team_badges: 30,
    distance_km: null,
  });
});

test("globalSearch returns team match scores that stay consistent with match_details", async () => {
  const { query } = buildTeamMatchSortQueryStub();
  db.pool.query = query;

  const req = {
    query: {
      query: "de",
      page: "1",
      limit: "10",
      sortBy: "match",
      searchType: "teams",
    },
    user: { id: 99 },
  };
  const res = createResponse();

  await searchController.globalSearch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.teams.length, 1);
  assert.deepEqual(res.body.data.users, []);
  assert.equal(res.body.data.teams[0].match_score, 0.61);
  assert.equal(res.body.data.teams[0].best_match_score, 0.61);
  assert.equal(res.body.data.teams[0].shared_tag_count, 2);
  assert.equal(res.body.data.teams[0].shared_badge_count, 15);
  assert.equal(res.body.data.teams[0].match_type, "team_profile_match");
  assert.deepEqual(res.body.data.teams[0].match_details, {
    tag_score: 0.4,
    badge_score: 0.5,
    distance_score: 1,
    shared_tag_count: 2,
    total_team_tags: 5,
    shared_badge_count: 15,
    total_team_badges: 30,
    distance_km: null,
  });
});
