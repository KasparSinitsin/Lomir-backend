const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const vacantRoleController = require("../src/controllers/vacantRoleController");

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

function createRequest(overrides = {}) {
  return {
    params: {
      teamId: "42",
      roleId: "123",
    },
    query: {},
    body: {},
    ...overrides,
  };
}

test.afterEach(() => {
  db.pool.query = originalQuery;
});

test("getVacantRoles returns filled_by_user for filled roles", async () => {
  const calls = [];

  db.pool.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id")
    ) {
      return {
        rows: [
          {
            id: 123,
            team_id: 42,
            created_by: 8,
            role_name: "Backend Developer",
            status: "filled",
            filled_by: 45,
            creator_first_name: "Alice",
            creator_last_name: "Admin",
            creator_username: "alice",
            filled_by_user_id: 45,
            filled_by_user_first_name: "Robert",
            filled_by_user_last_name: "Smith",
            filled_by_user_username: "rsmith",
            filled_by_user_avatar_url: "https://example.com/avatar.png",
          },
        ],
      };
    }

    if (sql.includes("FROM team_vacant_role_tags")) {
      return { rows: [] };
    }

    if (sql.includes("FROM team_vacant_role_badges")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in getVacantRoles test: ${sql}`);
  };

  const req = createRequest();
  const res = createResponse();

  await vacantRoleController.getVacantRoles(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data[0].filled_by, 45);
  assert.deepEqual(res.body.data[0].filled_by_user, {
    id: 45,
    first_name: "Robert",
    last_name: "Smith",
    username: "rsmith",
    avatar_url: "https://example.com/avatar.png",
  });
  assert.ok(
    calls.some(({ sql }) =>
      sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id"),
    ),
  );
});

test("getVacantRoleById returns filled_by_user for a single role", async () => {
  db.pool.query = async (sql) => {
    if (
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id")
    ) {
      return {
        rows: [
          {
            id: 123,
            team_id: 42,
            created_by: 8,
            role_name: "Backend Developer",
            status: "filled",
            filled_by: 45,
            creator_first_name: "Alice",
            creator_last_name: "Admin",
            creator_username: "alice",
            filled_by_user_id: 45,
            filled_by_user_first_name: "Robert",
            filled_by_user_last_name: "Smith",
            filled_by_user_username: "rsmith",
            filled_by_user_avatar_url: "https://example.com/avatar.png",
          },
        ],
      };
    }

    if (sql.includes("FROM team_vacant_role_tags")) {
      return { rows: [] };
    }

    if (sql.includes("FROM team_vacant_role_badges")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in getVacantRoleById test: ${sql}`);
  };

  const req = createRequest();
  const res = createResponse();

  await vacantRoleController.getVacantRoleById(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.filled_by, 45);
  assert.deepEqual(res.body.data.filled_by_user, {
    id: 45,
    first_name: "Robert",
    last_name: "Smith",
    username: "rsmith",
    avatar_url: "https://example.com/avatar.png",
  });
});

test("updateVacantRoleStatus persists filled_by and returns filled_by_user when filling a role", async () => {
  const calls = [];

  db.pool.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("FROM team_members tm")) {
      return { rows: [{ role: "owner" }] };
    }

    if (sql.includes("UPDATE team_vacant_roles")) {
      return {
        rows: [
          {
            id: 123,
            team_id: 42,
            status: "filled",
            filled_by: 45,
          },
        ],
      };
    }

    if (
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id")
    ) {
      return {
        rows: [
          {
            id: 123,
            team_id: 42,
            role_name: "Backend Developer",
            status: "filled",
            filled_by: 45,
            filled_by_user_id: 45,
            filled_by_user_first_name: "Robert",
            filled_by_user_last_name: "Smith",
            filled_by_user_username: "rsmith",
            filled_by_user_avatar_url: "https://example.com/avatar.png",
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in updateVacantRoleStatus test: ${sql}`);
  };

  const req = createRequest({
    user: { id: 7 },
    body: {
      status: "filled",
      filled_by: 45,
    },
  });
  const res = createResponse();

  await vacantRoleController.updateVacantRoleStatus(req, res);

  const updateCall = calls.find(({ sql }) => sql.includes("UPDATE team_vacant_roles"));

  assert.ok(updateCall);
  assert.equal(updateCall.params[0], "filled");
  assert.equal(updateCall.params[1], 45);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.filled_by, 45);
  assert.deepEqual(res.body.data.filled_by_user, {
    id: 45,
    first_name: "Robert",
    last_name: "Smith",
    username: "rsmith",
    avatar_url: "https://example.com/avatar.png",
  });
});

test("updateVacantRoleStatus clears filled_by and returns filled_by_user null when reopening a role", async () => {
  const calls = [];

  db.pool.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("FROM team_members tm")) {
      return { rows: [{ role: "admin" }] };
    }

    if (sql.includes("UPDATE team_vacant_roles")) {
      return {
        rows: [
          {
            id: 123,
            team_id: 42,
            status: "open",
            filled_by: null,
          },
        ],
      };
    }

    if (
      sql.includes("FROM team_vacant_roles vr") &&
      sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id")
    ) {
      return {
        rows: [
          {
            id: 123,
            team_id: 42,
            role_name: "Backend Developer",
            status: "open",
            filled_by: null,
            filled_by_user_id: null,
            filled_by_user_first_name: null,
            filled_by_user_last_name: null,
            filled_by_user_username: null,
            filled_by_user_avatar_url: null,
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in reopen status test: ${sql}`);
  };

  const req = createRequest({
    user: { id: 7 },
    body: {
      status: "open",
      filled_by: 45,
    },
  });
  const res = createResponse();

  await vacantRoleController.updateVacantRoleStatus(req, res);

  const updateCall = calls.find(({ sql }) => sql.includes("UPDATE team_vacant_roles"));

  assert.ok(updateCall);
  assert.equal(updateCall.params[0], "open");
  assert.equal(updateCall.params[1], null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.filled_by, null);
  assert.equal(res.body.data.filled_by_user, null);
});
