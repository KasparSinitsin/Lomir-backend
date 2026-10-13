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

// --- notification:new audience -------------------------------------------
// The stored application_received notification goes to owners/admins only
// (notifyTeamAdmins). The socket emit used to go to `team:${teamId}`, so every
// plain member got a "New Application" toast. It must reach exactly the
// people the notification was stored for.

function createIoRecorder() {
  const emits = [];
  return {
    emits,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            emits.push({ room, event, payload });
          },
        };
      },
    },
  };
}

function buildAudienceQueryStub({ isMember, adminIds = [2, 5], adminQueries = [] }) {
  return async (sql, params = []) => {
    if (sql.includes("FROM teams") && sql.includes("archived_at IS NULL")) {
      return { rows: [{ id: 42, name: "Alpha", owner_id: 2, max_members: 5 }] };
    }
    if (sql.includes("FROM team_vacant_roles")) {
      return { rows: [{ id: 9 }] };
    }
    if (sql.includes("FROM team_members WHERE team_id = $1 AND user_id = $2")) {
      return { rows: isMember ? [{ id: 77 }] : [] };
    }
    if (sql.includes("COUNT(*) as count FROM team_members")) {
      return { rows: [{ count: "3" }] };
    }
    if (sql.includes("FROM team_applications") && sql.includes("status = 'pending'")) {
      return { rows: [] };
    }
    if (sql.includes("FROM users WHERE id = $1")) {
      return { rows: [{ first_name: "Test", last_name: "User", username: "testuser" }] };
    }
    if (
      sql.includes("SELECT user_id FROM team_members") &&
      sql.includes("role IN ('owner', 'admin')")
    ) {
      // Owner 2 and admin 5 by default; plain member 8 is deliberately absent.
      // Mirrors the SQL's `user_id IS DISTINCT FROM $2`.
      adminQueries.push({ sql, params });
      return {
        rows: adminIds
          .filter((id) => params[1] == null || id !== params[1])
          .map((id) => ({ user_id: id })),
      };
    }
    if (sql.includes("INSERT INTO notifications")) {
      return { rows: [{ id: 500 + params[0], user_id: params[0] }] };
    }
    throw new Error(`Unexpected pool SQL in audience stub: ${sql}`);
  };
}

for (const { label, isMember, body } of [
  {
    label: "an application to join",
    isMember: false,
    body: { message: "I'd love to help.", isDraft: false },
  },
  {
    label: "a member's role application",
    isMember: true,
    body: { message: "I want to take on this role.", isDraft: false, roleId: 9 },
  },
]) {
  test(`applyToJoinTeam emits application_received only to owners/admins for ${label}`, async () => {
    const { client } = buildClientStub();
    const { io, emits } = createIoRecorder();

    db.pool.query = buildAudienceQueryStub({ isMember });
    db.pool.connect = async () => client;

    const req = createRequest(body);
    req.app = { get: (key) => (key === "io" ? io : null) };
    const res = createResponse();

    await teamController.applyToJoinTeam(req, res);

    assert.equal(res.statusCode, 201);

    const received = emits.filter(
      ({ event, payload }) =>
        event === "notification:new" && payload?.type === "application_received",
    );

    assert.deepEqual(
      received.map(({ room }) => room).sort(),
      ["user:2", "user:5"],
    );
    assert.equal(emits.some(({ room }) => room.startsWith("team:")), false);

    for (const { payload } of received) {
      assert.equal(payload.teamId, 42);
      assert.equal(payload.teamName, "Alpha");
      assert.equal(payload.isRoleApplication, isMember);
      assert.equal(payload.actorName, "Test User");
    }
  });
}

test("applyToJoinTeam does not notify or toast an admin about their own role application", async () => {
  const { client } = buildClientStub();
  const { io, emits } = createIoRecorder();
  const adminQueries = [];
  const insertedFor = [];

  // The applicant (req.user.id = 7) is an admin of team 42.
  const stub = buildAudienceQueryStub({ isMember: true, adminIds: [2, 7], adminQueries });
  db.pool.query = async (sql, params = []) => {
    if (sql.includes("INSERT INTO notifications")) insertedFor.push(params[0]);
    return stub(sql, params);
  };
  db.pool.connect = async () => client;

  const req = createRequest({ message: "I'll take this role.", isDraft: false, roleId: 9 });
  req.app = { get: (key) => (key === "io" ? io : null) };
  const res = createResponse();

  await teamController.applyToJoinTeam(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(adminQueries.length, 1);
  assert.equal(adminQueries[0].sql.includes("IS DISTINCT FROM $2"), true);
  assert.equal(adminQueries[0].params[1], 7);
  assert.deepEqual(insertedFor, [2]);
  assert.deepEqual(
    emits
      .filter(({ event, payload }) =>
        event === "notification:new" && payload?.type === "application_received")
      .map(({ room }) => room),
    ["user:2"],
  );
});
