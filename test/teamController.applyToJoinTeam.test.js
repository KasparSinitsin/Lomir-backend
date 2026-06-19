const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const teamController = require("../src/controllers/teamApplicationsController");

const originalQuery = db.pool.query;
const originalConnect = db.pool.connect;

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

function createRequest(body = {}) {
  return {
    params: { id: "42" },
    user: { id: 7 },
    body,
    app: {
      get() {
        return null;
      },
    },
  };
}

function buildPoolQueryStub({ roleRows = [{ id: 9 }], pendingRows = [] } = {}) {
  const calls = [];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("FROM teams") && sql.includes("archived_at IS NULL")) {
      return {
        rows: [{ id: 42, name: "Alpha", owner_id: 2, max_members: 5 }],
      };
    }

    if (sql.includes("FROM team_vacant_roles")) {
      return { rows: roleRows };
    }

    if (sql.includes("FROM team_members WHERE team_id = $1 AND user_id = $2")) {
      return { rows: [] };
    }

    if (sql.includes("COUNT(*) as count FROM team_members")) {
      return { rows: [{ count: "2" }] };
    }

    if (sql.includes("FROM team_applications") && sql.includes("status = 'pending'")) {
      return { rows: pendingRows };
    }

    throw new Error(`Unexpected pool SQL in test stub: ${sql}`);
  };

  return { query, calls };
}

function buildClientStub() {
  const calls = [];

  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO team_applications")) {
        return { rows: [{ id: 123 }] };
      }

      throw new Error(`Unexpected client SQL in test stub: ${sql}`);
    },
    release() {},
  };

  return { client, calls };
}

test.afterEach(() => {
  db.pool.query = originalQuery;
  db.pool.connect = originalConnect;
});

test("applyToJoinTeam keeps the existing team-level flow working when roleId is omitted", async () => {
  const { query, calls: poolCalls } = buildPoolQueryStub();
  const { client, calls: clientCalls } = buildClientStub();

  db.pool.query = query;
  db.pool.connect = async () => client;

  const req = createRequest({
    message: "I'd love to help.",
    isDraft: true,
  });
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.applicationId, 123);
  assert.equal(
    poolCalls.some(({ sql }) => sql.includes("FROM team_vacant_roles")),
    false,
  );

  const insertCall = clientCalls.find(({ sql }) =>
    sql.includes("INSERT INTO team_applications"),
  );

  assert.ok(insertCall);
  assert.equal(insertCall.params[4], null);
});

test("applyToJoinTeam stores a validated vacant role link when roleId is provided", async () => {
  const { query } = buildPoolQueryStub();
  const { client, calls: clientCalls } = buildClientStub();

  db.pool.query = query;
  db.pool.connect = async () => client;

  const req = createRequest({
    message: "I'd love to help with this role.",
    isDraft: true,
    roleId: 9,
  });
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);

  const insertCall = clientCalls.find(({ sql }) =>
    sql.includes("INSERT INTO team_applications"),
  );

  assert.ok(insertCall);
  assert.equal(insertCall.params[4], 9);
});

test("applyToJoinTeam rejects roleId values that do not point to an open role on the same team", async () => {
  const { query } = buildPoolQueryStub({ roleRows: [] });
  let connectCalled = false;

  db.pool.query = query;
  db.pool.connect = async () => {
    connectCalled = true;
    throw new Error("connect should not be called");
  };

  const req = createRequest({
    message: "I'd love to help with this role.",
    roleId: 999,
  });
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Vacant role not found/i);
  assert.equal(connectCalled, false);
});

function buildPoolQueryStubAsMember({ pendingRoleRows = [] } = {}) {
  const calls = [];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("FROM teams") && sql.includes("archived_at IS NULL")) {
      return { rows: [{ id: 42, name: "Alpha", owner_id: 2, max_members: 5 }] };
    }

    if (sql.includes("FROM team_vacant_roles")) {
      return { rows: [{ id: 9 }] };
    }

    if (sql.includes("FROM team_members WHERE team_id = $1 AND user_id = $2")) {
      // User IS already a member
      return { rows: [{ id: 77 }] };
    }

    if (
      sql.includes("FROM team_applications") &&
      sql.includes("role_id = $3") &&
      sql.includes("status = 'pending'")
    ) {
      return { rows: pendingRoleRows };
    }

    if (sql.includes("FROM users WHERE id = $1")) {
      return { rows: [{ first_name: "Test", last_name: "User", username: "testuser" }] };
    }

    if (
      sql.includes("SELECT user_id FROM team_members") &&
      sql.includes("role IN ('owner', 'admin')")
    ) {
      return { rows: [{ user_id: 2 }] };
    }

    if (sql.includes("INSERT INTO notifications")) {
      return { rows: [{ id: 501 }] };
    }

    throw new Error(`Unexpected pool SQL in member stub: ${sql}`);
  };

  return { query, calls };
}

test("applyToJoinTeam allows an existing member to apply for a specific role", async () => {
  const { query } = buildPoolQueryStubAsMember();
  const { client, calls: clientCalls } = buildClientStub();

  db.pool.query = query;
  db.pool.connect = async () => client;

  const req = createRequest({
    message: "I want to take on this role.",
    isDraft: false,
    roleId: 9,
  });
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.isInternalRoleApplication, true);

  const insertCall = clientCalls.find(({ sql }) =>
    sql.includes("INSERT INTO team_applications"),
  );
  assert.ok(insertCall);
  assert.equal(insertCall.params[4], 9);
});

test("applyToJoinTeam rejects a member applying without a roleId", async () => {
  const { query } = buildPoolQueryStubAsMember();
  let connectCalled = false;

  db.pool.query = query;
  db.pool.connect = async () => {
    connectCalled = true;
    throw new Error("connect should not be called");
  };

  const req = createRequest({
    message: "I want to join again.",
  });
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /already a member/i);
  assert.equal(connectCalled, false);
});

test("applyToJoinTeam rejects duplicate internal role application for same role", async () => {
  const { query } = buildPoolQueryStubAsMember({ pendingRoleRows: [{ id: 55 }] });
  let connectCalled = false;

  db.pool.query = query;
  db.pool.connect = async () => {
    connectCalled = true;
    throw new Error("connect should not be called");
  };

  const req = createRequest({
    message: "I want this role.",
    roleId: 9,
  });
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /already have a pending application for this role/i);
  assert.equal(connectCalled, false);
});
