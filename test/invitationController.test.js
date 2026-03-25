const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const invitationController = require("../src/controllers/invitationController");

const originalPoolQuery = db.pool.query;
const originalDbQuery = db.query;

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

function createRequest({
  teamId = "42",
  invitationId = "77",
  userId = 7,
  body = {},
} = {}) {
  return {
    params: {
      teamId,
      invitationId,
    },
    user: { id: userId },
    body,
    app: {
      get() {
        return null;
      },
    },
  };
}

function buildSendInvitationPoolQueryStub({ roleRows = [{ id: 9, status: "open" }] } = {}) {
  const calls = [];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("FROM teams WHERE id = $1 AND archived_at IS NULL")) {
      return {
        rows: [{ id: 42, name: "Alpha", max_members: 5 }],
      };
    }

    if (
      sql.includes("FROM team_members") &&
      sql.includes("role IN ('owner', 'admin')")
    ) {
      return { rows: [{ role: "owner" }] };
    }

    if (sql.includes("FROM team_vacant_roles")) {
      return { rows: roleRows };
    }

    if (sql.includes("SELECT id, username FROM users WHERE id = $1")) {
      return { rows: [{ id: 99, username: "invitee99" }] };
    }

    if (sql.includes("SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2")) {
      return { rows: [] };
    }

    if (sql.includes("COUNT(*) as count FROM team_members")) {
      return { rows: [{ count: "2" }] };
    }

    if (sql.includes("SELECT id FROM team_invitations") && sql.includes("status = 'pending'")) {
      return { rows: [] };
    }

    if (sql.includes("DELETE FROM team_invitations")) {
      return { rows: [] };
    }

    if (sql.includes("SELECT id FROM team_applications")) {
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO team_invitations")) {
      return { rows: [{ id: 123 }] };
    }

    if (sql.includes("SELECT first_name, last_name, username FROM users WHERE id = $1")) {
      return {
        rows: [
          {
            first_name: "Alice",
            last_name: "Admin",
            username: "aliceadmin",
          },
        ],
      };
    }

    throw new Error(`Unexpected pool SQL in invitation test stub: ${sql}`);
  };

  return { query, calls };
}

test.afterEach(() => {
  db.pool.query = originalPoolQuery;
  db.query = originalDbQuery;
});

test("sendTeamInvitation keeps the existing team invite flow working when roleId is omitted", async () => {
  const { query, calls } = buildSendInvitationPoolQueryStub();

  db.pool.query = query;
  db.query = async (sql) => {
    if (sql.includes("INSERT INTO notifications")) {
      return { rows: [{ id: 500 }] };
    }

    throw new Error(`Unexpected db SQL in invitation test stub: ${sql}`);
  };

  const req = createRequest({
    body: {
      inviteeId: 99,
      message: "Welcome to the team!",
    },
  });
  const res = createResponse();

  await invitationController.sendTeamInvitation(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(
    calls.some(({ sql }) => sql.includes("FROM team_vacant_roles")),
    false,
  );

  const insertCall = calls.find(({ sql }) =>
    sql.includes("INSERT INTO team_invitations"),
  );

  assert.ok(insertCall);
  assert.equal(insertCall.params[4], null);
});

test("sendTeamInvitation stores a validated vacant role link when roleId is provided", async () => {
  const { query, calls } = buildSendInvitationPoolQueryStub();

  db.pool.query = query;
  db.query = async (sql) => {
    if (sql.includes("INSERT INTO notifications")) {
      return { rows: [{ id: 501 }] };
    }

    throw new Error(`Unexpected db SQL in invitation test stub: ${sql}`);
  };

  const req = createRequest({
    body: {
      inviteeId: 99,
      message: "We would love to invite you for this role.",
      roleId: 9,
    },
  });
  const res = createResponse();

  await invitationController.sendTeamInvitation(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.ok(
    calls.some(({ sql }) => sql.includes("FROM team_vacant_roles")),
  );

  const insertCall = calls.find(({ sql }) =>
    sql.includes("INSERT INTO team_invitations"),
  );

  assert.ok(insertCall);
  assert.equal(insertCall.params[4], 9);
});

test("sendTeamInvitation rejects roleId values that no longer point to an open role", async () => {
  const { query, calls } = buildSendInvitationPoolQueryStub({
    roleRows: [{ id: 9, status: "filled" }],
  });

  db.pool.query = query;
  db.query = async () => {
    throw new Error("db.query should not be called for invalid role invites");
  };

  const req = createRequest({
    body: {
      inviteeId: 99,
      message: "We would love to invite you for this role.",
      roleId: 9,
    },
  });
  const res = createResponse();

  await invitationController.sendTeamInvitation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Vacant role is no longer open");
  assert.equal(
    calls.some(({ sql }) => sql.includes("INSERT INTO team_invitations")),
    false,
  );
});

test("getUserReceivedInvitations includes optional role_id and role_name fields", async () => {
  db.pool.query = async (sql) => {
    if (sql.includes("FROM team_invitations ti") && sql.includes("LEFT JOIN team_vacant_roles vr")) {
      return {
        rows: [
          {
            id: 123,
            message: "Join us",
            status: "pending",
            created_at: "2026-03-24T10:00:00.000Z",
            role_id: 9,
            role_name: "Backend Developer",
            team_id: 42,
            team_name: "Alpha",
            team_description: "Builders",
            teamavatar_url: "https://example.com/team.png",
            max_members: 5,
            is_public: true,
            current_members_count: "3",
            inviter_id: 7,
            inviter_username: "aliceadmin",
            inviter_first_name: "Alice",
            inviter_last_name: "Admin",
            inviter_avatar_url: "https://example.com/alice.png",
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in received invitations test: ${sql}`);
  };

  const req = createRequest({ userId: 99 });
  const res = createResponse();

  await invitationController.getUserReceivedInvitations(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data[0].role_id, 9);
  assert.equal(res.body.data[0].role_name, "Backend Developer");
});

test("getTeamSentInvitations includes optional role_id and role_name fields", async () => {
  db.pool.query = async (sql) => {
    if (
      sql.includes("FROM team_members") &&
      sql.includes("role IN ('owner', 'admin')")
    ) {
      return { rows: [{ role: "owner" }] };
    }

    if (sql.includes("FROM team_invitations ti") && sql.includes("LEFT JOIN team_vacant_roles vr")) {
      return {
        rows: [
          {
            id: 123,
            message: "Join us",
            status: "pending",
            created_at: "2026-03-24T10:00:00.000Z",
            role_id: 11,
            role_name: "Product Designer",
            invitee_id: 99,
            username: "invitee99",
            first_name: "Jamie",
            last_name: "Doe",
            avatar_url: "https://example.com/jamie.png",
            bio: "Design systems",
            postal_code: "10115",
            inviter_id: 7,
            inviter_username: "aliceadmin",
            inviter_first_name: "Alice",
            inviter_last_name: "Admin",
            inviter_avatar_url: "https://example.com/alice.png",
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in team invitations test: ${sql}`);
  };

  const req = createRequest({ teamId: "42", userId: 7 });
  const res = createResponse();

  await invitationController.getTeamSentInvitations(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data[0].role_id, 11);
  assert.equal(res.body.data[0].role_name, "Product Designer");
});
