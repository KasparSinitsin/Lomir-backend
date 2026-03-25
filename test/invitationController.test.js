const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const invitationController = require("../src/controllers/invitationController");

const originalPoolQuery = db.pool.query;
const originalDbQuery = db.query;
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

function createRequest({
  teamId = "42",
  invitationId = "77",
  userId = 7,
  body = {},
  io = null,
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
        return io;
      },
    },
  };
}

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

function buildRespondInvitationPoolQueryStub({ roleId = 9 } = {}) {
  const calls = [];

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (
      sql.includes("FROM team_invitations ti") &&
      sql.includes("AND ti.status = 'pending'")
    ) {
      return {
        rows: [
          {
            id: 77,
            team_id: 42,
            inviter_id: 3,
            invitee_id: 7,
            role_id: roleId,
            max_members: 5,
            team_name: "Alpha",
            invitee_first_name: "Jamie",
            invitee_last_name: "Doe",
            invitee_username: "jamiedoe",
          },
        ],
      };
    }

    throw new Error(`Unexpected pool SQL in respond invitation test stub: ${sql}`);
  };

  return { query, calls };
}

function buildRespondInvitationClientStub({
  memberCount = "2",
  roleUpdateRows = [{ id: 9, role_name: "Backend Developer" }],
} = {}) {
  const calls = [];

  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }

      if (sql.includes("COUNT(*) as count FROM team_members")) {
        return { rows: [{ count: memberCount }] };
      }

      if (sql.includes("INSERT INTO team_members")) {
        return { rows: [] };
      }

      if (
        sql.includes("UPDATE team_invitations") &&
        sql.includes("status = 'accepted'")
      ) {
        return { rows: [] };
      }

      if (sql.includes("UPDATE team_vacant_roles")) {
        return { rows: roleUpdateRows };
      }

      if (sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)")) {
        return { rows: [{ id: 800 }] };
      }

      if (
        sql.includes("UPDATE team_invitations") &&
        sql.includes("status = 'declined'")
      ) {
        return { rows: [] };
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

      if (sql.includes("INSERT INTO messages (sender_id, receiver_id, content, sent_at)")) {
        return { rows: [{ id: 801 }] };
      }

      throw new Error(`Unexpected client SQL in respond invitation test stub: ${sql}`);
    },
    release() {},
  };

  return { client, calls };
}

function buildNotificationQueryStub({ teamMemberIds = [] } = {}) {
  const calls = [];
  let notificationId = 900;

  const query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("SELECT user_id FROM team_members WHERE team_id = $1 AND user_id != $2")) {
      return {
        rows: teamMemberIds.map((user_id) => ({ user_id })),
      };
    }

    if (sql.includes("INSERT INTO notifications")) {
      return {
        rows: [{ id: notificationId++ }],
      };
    }

    throw new Error(`Unexpected db SQL in notification stub: ${sql}`);
  };

  return { query, calls };
}

test.afterEach(() => {
  db.pool.query = originalPoolQuery;
  db.query = originalDbQuery;
  db.pool.connect = originalConnect;
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

test("getUserReceivedInvitations includes optional role_id, role_name, and full role object", async () => {
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
            role_bio: "Build APIs",
            role_city: "Berlin",
            role_country: "DE",
            role_state: null,
            role_is_remote: false,
            role_latitude: 52.52,
            role_longitude: 13.405,
            role_max_distance_km: 50,
            role_status: "open",
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

    if (sql.includes("FROM team_vacant_role_tags vrt")) {
      return { rows: [{ role_id: 9, tag_id: 1, name: "Node.js", category: "Backend", supercategory: "Tech" }] };
    }

    if (sql.includes("FROM team_vacant_role_badges vrb")) {
      return { rows: [] };
    }

    if (sql.includes("SELECT latitude, longitude FROM users")) {
      return { rows: [{ latitude: 52.5, longitude: 13.4 }] };
    }

    if (sql.includes("SELECT tag_id FROM user_tags")) {
      return { rows: [{ tag_id: 1 }] };
    }

    if (sql.includes("SELECT DISTINCT badge_id FROM user_badges")) {
      return { rows: [] };
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
  assert.ok(res.body.data[0].role, "role object should be present when role_id is set");
  assert.equal(res.body.data[0].role.role_name, "Backend Developer");
  assert.equal(res.body.data[0].role.bio, "Build APIs");
  assert.ok(Array.isArray(res.body.data[0].role.tags), "role.tags should be an array");
  assert.ok(Array.isArray(res.body.data[0].role.badges), "role.badges should be an array");
  assert.ok(typeof res.body.data[0].role.match_score === "number", "role.match_score should be a number");
  assert.ok(res.body.data[0].role.match_details, "role.match_details should be present");
});

test("getTeamSentInvitations includes optional role_id, role_name, and full role object", async () => {
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
            role_bio: "Design the product",
            role_city: "Berlin",
            role_country: "DE",
            role_state: null,
            role_is_remote: true,
            role_latitude: null,
            role_longitude: null,
            role_max_distance_km: null,
            role_status: "open",
            invitee_id: 99,
            username: "invitee99",
            first_name: "Jamie",
            last_name: "Doe",
            avatar_url: "https://example.com/jamie.png",
            bio: "Design systems",
            postal_code: "10115",
            invitee_latitude: null,
            invitee_longitude: null,
            inviter_id: 7,
            inviter_username: "aliceadmin",
            inviter_first_name: "Alice",
            inviter_last_name: "Admin",
            inviter_avatar_url: "https://example.com/alice.png",
          },
        ],
      };
    }

    if (sql.includes("FROM team_vacant_role_tags vrt")) {
      return { rows: [] };
    }

    if (sql.includes("FROM team_vacant_role_badges vrb")) {
      return { rows: [] };
    }

    if (sql.includes("SELECT user_id, tag_id FROM user_tags")) {
      return { rows: [] };
    }

    if (sql.includes("SELECT DISTINCT ub.user_id, ub.badge_id")) {
      return { rows: [] };
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
  assert.ok(res.body.data[0].role, "role object should be present when role_id is set");
  assert.equal(res.body.data[0].role.role_name, "Product Designer");
  assert.equal(res.body.data[0].role.bio, "Design the product");
  assert.ok(Array.isArray(res.body.data[0].role.tags), "role.tags should be an array");
  assert.ok(Array.isArray(res.body.data[0].role.badges), "role.badges should be an array");
  assert.ok(typeof res.body.data[0].role.match_score === "number", "role.match_score should be a number");
  assert.ok(res.body.data[0].role.match_details, "role.match_details should be present");
});

test("respondToInvitation fills the linked vacant role when accepting with fill_role enabled", async () => {
  const { query: poolQuery } = buildRespondInvitationPoolQueryStub({ roleId: 9 });
  const { client, calls: clientCalls } = buildRespondInvitationClientStub({
    roleUpdateRows: [{ id: 9, role_name: "Backend Developer" }],
  });
  const { query: notificationQuery, calls: notificationCalls } =
    buildNotificationQueryStub();
  const { io, emits } = createIoRecorder();

  db.pool.query = poolQuery;
  db.pool.connect = async () => client;
  db.query = notificationQuery;

  const req = createRequest({
    invitationId: "77",
    userId: 7,
    body: {
      action: "accept",
      fill_role: true,
    },
    io,
  });
  const res = createResponse();

  await invitationController.respondToInvitation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.roleFilled, true);
  assert.equal(res.body.data.filledRoleName, "Backend Developer");

  const roleUpdateCall = clientCalls.find(({ sql }) =>
    sql.includes("UPDATE team_vacant_roles"),
  );
  assert.ok(roleUpdateCall);
  assert.deepEqual(roleUpdateCall.params, [7, 9, 42]);

  const teamMessageCall = clientCalls.find(({ sql }) =>
    sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)"),
  );
  assert.ok(teamMessageCall);
  assert.equal(
    teamMessageCall.params[2],
    "👋 Jamie Doe joined the team as Backend Developer!",
  );

  const inviterNotificationCall = notificationCalls.find(
    ({ sql, params }) =>
      sql.includes("INSERT INTO notifications") &&
      params[0] === 3 &&
      params[1] === "invitation_accepted",
  );
  assert.ok(inviterNotificationCall);
  assert.match(inviterNotificationCall.params[2], /Backend Developer/);

  const inviterSocketEvent = emits.find(
    ({ room, event, payload }) =>
      room === "user:3" &&
      event === "notification:new" &&
      payload.type === "invitation_accepted",
  );
  assert.ok(inviterSocketEvent);
  assert.equal(inviterSocketEvent.payload.roleFilled, true);
  assert.equal(inviterSocketEvent.payload.filledRoleName, "Backend Developer");
});

test("respondToInvitation leaves the linked vacant role open when fill_role is false", async () => {
  const { query: poolQuery } = buildRespondInvitationPoolQueryStub({ roleId: 9 });
  const { client, calls: clientCalls } = buildRespondInvitationClientStub();
  const { query: notificationQuery, calls: notificationCalls } =
    buildNotificationQueryStub();
  const { io, emits } = createIoRecorder();

  db.pool.query = poolQuery;
  db.pool.connect = async () => client;
  db.query = notificationQuery;

  const req = createRequest({
    invitationId: "77",
    userId: 7,
    body: {
      action: "accept",
      fill_role: false,
    },
    io,
  });
  const res = createResponse();

  await invitationController.respondToInvitation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.roleFilled, false);
  assert.equal(res.body.data.filledRoleName, null);
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("UPDATE team_vacant_roles")),
    false,
  );

  const teamMessageCall = clientCalls.find(({ sql }) =>
    sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)"),
  );
  assert.ok(teamMessageCall);
  assert.equal(teamMessageCall.params[2], "👋 Jamie Doe joined the team!");

  const inviterNotificationCall = notificationCalls.find(
    ({ sql, params }) =>
      sql.includes("INSERT INTO notifications") &&
      params[1] === "invitation_accepted",
  );
  assert.equal(inviterNotificationCall, undefined);

  const inviterSocketEvent = emits.find(
    ({ room, event, payload }) =>
      room === "user:3" &&
      event === "notification:new" &&
      payload.type === "invitation_accepted",
  );
  assert.equal(inviterSocketEvent, undefined);
});

test("respondToInvitation still accepts invitations without a linked role even when fill_role is true", async () => {
  const { query: poolQuery } = buildRespondInvitationPoolQueryStub({ roleId: null });
  const { client, calls: clientCalls } = buildRespondInvitationClientStub();
  const { query: notificationQuery } = buildNotificationQueryStub();

  db.pool.query = poolQuery;
  db.pool.connect = async () => client;
  db.query = notificationQuery;

  const req = createRequest({
    invitationId: "77",
    userId: 7,
    body: {
      action: "accept",
      fill_role: true,
    },
  });
  const res = createResponse();

  await invitationController.respondToInvitation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.roleFilled, false);
  assert.equal(res.body.data.filledRoleName, null);
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("UPDATE team_vacant_roles")),
    false,
  );

  const teamMessageCall = clientCalls.find(({ sql }) =>
    sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)"),
  );
  assert.ok(teamMessageCall);
  assert.equal(teamMessageCall.params[2], "👋 Jamie Doe joined the team!");
});

test("respondToInvitation keeps the decline flow unchanged", async () => {
  const { query: poolQuery } = buildRespondInvitationPoolQueryStub({ roleId: 9 });
  const { client, calls: clientCalls } = buildRespondInvitationClientStub();
  const { query: notificationQuery, calls: notificationCalls } =
    buildNotificationQueryStub();
  const { io, emits } = createIoRecorder();

  db.pool.query = poolQuery;
  db.pool.connect = async () => client;
  db.query = notificationQuery;

  const req = createRequest({
    invitationId: "77",
    userId: 7,
    body: {
      action: "decline",
    },
    io,
  });
  const res = createResponse();

  await invitationController.respondToInvitation(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Invitation declined");
  assert.equal(res.body.data.roleFilled, false);
  assert.equal(res.body.data.filledRoleName, null);
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("UPDATE team_vacant_roles")),
    false,
  );

  const declineNotificationCall = notificationCalls.find(
    ({ sql, params }) =>
      sql.includes("INSERT INTO notifications") &&
      params[0] === 3 &&
      params[1] === "invitation_declined",
  );
  assert.ok(declineNotificationCall);

  const declineSocketEvent = emits.find(
    ({ room, event, payload }) =>
      room === "user:3" &&
      event === "notification:new" &&
      payload.type === "invitation_declined",
  );
  assert.ok(declineSocketEvent);
});
