const test = require("node:test");
const assert = require("node:assert/strict");

const bcrypt = require("bcrypt");
const db = require("../src/config/database");
const userDeletionController = require("../src/controllers/userDeletionController");

const originalConnect = db.pool.connect;
const originalCompare = bcrypt.compare;
const originalNodeEnv = process.env.NODE_ENV;

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

function createRequest({
  userId = 7,
  paramId = "7",
  body = { password: "secret123" },
  io = null,
} = {}) {
  return {
    params: { id: paramId },
    user: { id: userId },
    body,
    app: {
      get() {
        return io;
      },
    },
  };
}

// Shared pool client mock for the happy-path delete flow: one solo team (10,
// deleted), one shared team (20, transferred) with two successor candidates —
// user 11 (admin, earliest joined = the DEFAULT candidates[0]) and user 12
// (member). Records every query into `calls`.
function createSuccessfulDeleteClient(calls) {
  return {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [] };
      }

      if (sql.includes("SELECT id, first_name, last_name, username, avatar_url, avatar_file_id, password_hash")) {
        return {
          rows: [
            {
              id: 7,
              first_name: "Jane",
              last_name: "Doe",
              username: "janed",
              avatar_url: null,
              avatar_file_id: null,
              password_hash: "stored-hash",
            },
          ],
        };
      }

      if (sql.includes("FROM team_members tm") && sql.includes("JOIN teams t ON t.id = tm.team_id")) {
        return {
          rows: [
            { team_id: 10, role: "owner", joined_at: new Date("2023-01-01T00:00:00.000Z"), team_name: "Solo Team" },
            { team_id: 20, role: "owner", joined_at: new Date("2023-02-01T00:00:00.000Z"), team_name: "Shared Team" },
            { team_id: 30, role: "member", joined_at: new Date("2023-03-01T00:00:00.000Z"), team_name: "Member Team" },
          ],
        };
      }

      if (sql.includes("JOIN team_members tm_owner")) {
        return {
          rows: [
            { team_id: 10, team_name: "Solo Team", member_count: 1, other_member_count: 0 },
            { team_id: 20, team_name: "Shared Team", member_count: 3, other_member_count: 2 },
          ],
        };
      }

      if (
        sql.includes("FROM team_vacant_roles vr") &&
        sql.includes("vr.status = 'filled'")
      ) {
        return {
          rows: [
            {
              role_id: 40,
              role_name: "Backend Developer",
              team_id: 20,
              team_name: "Shared Team",
            },
          ],
        };
      }

      if (sql.includes("CASE") && sql.includes("AS partner_id")) {
        return { rows: [{ partner_id: 99 }, { partner_id: 100 }] };
      }

      if (sql.includes("SELECT DISTINCT applicant_id")) {
        return { rows: [{ applicant_id: 21 }] };
      }

      if (sql.includes("SELECT DISTINCT invitee_id")) {
        return { rows: [{ invitee_id: 22 }] };
      }

      if (
        sql.includes("FROM team_members tm") &&
        sql.includes("tm.role IN ('admin', 'member')")
      ) {
        return {
          rows: [
            {
              team_id: 20,
              user_id: 11,
              role: "admin",
              joined_at: new Date("2022-01-01T00:00:00.000Z"),
              first_name: "Sam",
              last_name: "Smith",
              username: "sams",
            },
            {
              team_id: 20,
              user_id: 12,
              role: "member",
              joined_at: new Date("2022-06-01T00:00:00.000Z"),
              first_name: "Mia",
              last_name: "Ng",
              username: "miang",
            },
          ],
        };
      }

      if (
        sql.includes("SELECT team_id, user_id") &&
        sql.includes("role IN ('owner', 'admin')")
      ) {
        return {
          rows: [
            { team_id: 20, user_id: 11 },
            { team_id: 20, user_id: 12 },
          ],
        };
      }

      if (
        sql.includes("DELETE FROM messages") ||
        sql.includes("INSERT INTO messages") ||
        sql.includes("UPDATE messages") ||
        sql.includes("UPDATE badge_awards") ||
        sql.includes("DELETE FROM team_invitations") ||
        sql.includes("DELETE FROM team_applications") ||
        sql.includes("DELETE FROM notifications") ||
        sql.includes("DELETE FROM team_vacant_role_tags") ||
        sql.includes("DELETE FROM team_vacant_role_badges") ||
        sql.includes("DELETE FROM team_vacant_roles") ||
        sql.includes("DELETE FROM team_tags") ||
        sql.includes("DELETE FROM team_members") ||
        sql.includes("DELETE FROM teams") ||
        sql.includes("UPDATE team_members") ||
        sql.includes("UPDATE teams") ||
        sql.includes("UPDATE team_vacant_roles") ||
        sql.includes("UPDATE team_applications") ||
        sql.includes("UPDATE user_badges") ||
        sql.includes("UPDATE tags") ||
        sql.includes("UPDATE notifications") ||
        sql.includes("INSERT INTO notifications") ||
        sql.includes("DELETE FROM users")
      ) {
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in successful delete test: ${sql}`);
    },
    release() {},
  };
}

test.afterEach(() => {
  db.pool.connect = originalConnect;
  bcrypt.compare = originalCompare;
  process.env.NODE_ENV = originalNodeEnv;
});

test("deleteUser rejects attempts to delete another user's account", async () => {
  let connectCalled = false;

  db.pool.connect = async () => {
    connectCalled = true;
    throw new Error("connect should not be called");
  };

  const req = createRequest({ userId: 7, paramId: "8" });
  const res = createResponse();

  await userDeletionController.deleteUser(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /delete your own account/i);
  assert.equal(connectCalled, false);
});

test("deleteUser rolls back and returns 401 when the password is incorrect", async () => {
  process.env.NODE_ENV = "production";

  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql === "BEGIN" || sql === "ROLLBACK") {
        return { rows: [] };
      }

      if (sql.includes("SELECT id, first_name, last_name, username, avatar_url, avatar_file_id, password_hash")) {
        return {
          rows: [
            {
              id: 7,
              first_name: "Jane",
              last_name: "Doe",
              username: "janed",
              avatar_url: null,
              avatar_file_id: null,
              password_hash: "stored-hash",
            },
          ],
        };
      }

      throw new Error(`Unexpected SQL in wrong-password delete test: ${sql}`);
    },
    release() {},
  };

  db.pool.connect = async () => client;
  bcrypt.compare = async (password, hash) => {
    assert.equal(password, "secret123");
    assert.equal(hash, "stored-hash");
    return false;
  };

  const req = createRequest();
  const res = createResponse();

  await userDeletionController.deleteUser(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /password is incorrect/i);
  assert.equal(calls.some(({ sql }) => sql === "ROLLBACK"), true);
  assert.equal(calls.some(({ sql }) => sql === "COMMIT"), false);
});

test("deleteUser completes the transaction flow and emits the expected socket events", async () => {
  process.env.NODE_ENV = "production";

  const calls = [];
  const { emits, io } = createIoRecorder();

  const client = createSuccessfulDeleteClient(calls);

  db.pool.connect = async () => client;
  bcrypt.compare = async (password, hash) => {
    assert.equal(password, "secret123");
    assert.equal(hash, "stored-hash");
    return true;
  };

  const req = createRequest({
    body: {
      password: "secret123",
      ownershipOverrides: [{ teamId: 20, successorId: 11 }],
    },
    io,
  });
  const res = createResponse();

  await userDeletionController.deleteUser(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    message: "Account deleted successfully",
  });

  const deleteDmIndex = calls.findIndex(({ sql }) =>
    sql.includes("DELETE FROM messages") && sql.includes("team_id IS NULL"),
  );
  const departureMessageIndex = calls.findIndex(({ sql, params }) =>
    sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)") &&
    params[2] === "🚪 Former Lomir User has left Lomir.",
  );
  const ownershipMessageIndex = calls.findIndex(({ sql, params }) =>
    sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)") &&
    params[2] === "👑 OWNERSHIP_TEAM: Former Lomir User | Sam Smith",
  );
  const transferRoleIndex = calls.findIndex(({ sql }) =>
    sql.includes("UPDATE team_members") && sql.includes("SET role = 'owner'"),
  );
  const transferOwnerIndex = calls.findIndex(({ sql }) =>
    sql.includes("UPDATE teams") && sql.includes("SET owner_id = $1"),
  );
  const reopenRoleIndex = calls.findIndex(({ sql }) =>
    sql.includes("UPDATE team_vacant_roles") && sql.includes("SET status = 'open'"),
  );
  const deleteUserIndex = calls.findIndex(({ sql }) =>
    sql.includes("DELETE FROM users WHERE id = $1"),
  );

  assert.ok(deleteDmIndex >= 0);
  assert.ok(departureMessageIndex > deleteDmIndex);
  assert.ok(ownershipMessageIndex > deleteDmIndex);
  assert.ok(transferRoleIndex >= 0);
  assert.ok(transferOwnerIndex > transferRoleIndex);
  assert.ok(reopenRoleIndex > transferOwnerIndex);
  assert.ok(deleteUserIndex > reopenRoleIndex);

  assert.equal(
    emits.some(
      ({ room, event, payload }) =>
        room === "team:10" &&
        event === "team:member_left" &&
        payload.teamId === 10 &&
        payload.userId === 7,
    ),
    true,
  );
  assert.equal(
    emits.some(
      ({ room, event, payload }) =>
        room === "team:20" &&
        event === "notification:new" &&
        payload.type === "role_reopened",
    ),
    true,
  );
  assert.equal(
    emits.some(
      ({ room, event, payload }) =>
        room === "user:99" &&
        event === "conversation:deleted" &&
        payload.partnerId === 7,
    ),
    true,
  );
  assert.equal(
    emits.some(
      ({ room, event, payload }) =>
        room === "user:11" &&
        event === "notification:new" &&
        payload.type === "ownership_transferred" &&
        payload.teamId === 20,
    ),
    true,
  );
});

// Regression test for the ownership-transfer casing bug: the frontend request
// interceptor serializes the body to snake_case, so a real request arrives as
// `ownership_overrides: [{ team_id, successor_id }]`. deleteUser must honor it.
// The chosen successor here is user 12 (member) — NOT the default candidates[0]
// (user 11, admin) — so a dropped/ignored override would transfer to 11 and
// fail this test.
test("deleteUser honors a snake_case ownership override for a non-default successor", async () => {
  process.env.NODE_ENV = "production";

  const calls = [];
  const { emits, io } = createIoRecorder();
  const client = createSuccessfulDeleteClient(calls);

  db.pool.connect = async () => client;
  bcrypt.compare = async () => true;

  const req = createRequest({
    body: {
      password: "secret123",
      ownership_overrides: [{ team_id: 20, successor_id: 12 }],
    },
    io,
  });
  const res = createResponse();

  await userDeletionController.deleteUser(req, res);

  assert.equal(res.statusCode, 200);

  const transferRoleCall = calls.find(
    ({ sql }) =>
      sql.includes("UPDATE team_members") && sql.includes("SET role = 'owner'"),
  );
  const transferOwnerCall = calls.find(
    ({ sql }) =>
      sql.includes("UPDATE teams") && sql.includes("SET owner_id = $1"),
  );

  // team_members: WHERE team_id = $1 AND user_id = $2 -> [20, 12]
  assert.deepEqual(transferRoleCall.params, [20, 12]);
  // teams: SET owner_id = $1 WHERE id = $2 -> [12, 20]
  assert.deepEqual(transferOwnerCall.params, [12, 20]);

  // The in-chat ownership message names the chosen successor (Mia Ng), not the
  // default (Sam Smith).
  assert.equal(
    calls.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)") &&
        params[2] === "👑 OWNERSHIP_TEAM: Former Lomir User | Mia Ng",
    ),
    true,
  );

  // The ownership-transferred notification goes to user 12, not user 11.
  assert.equal(
    emits.some(
      ({ room, event, payload }) =>
        room === "user:12" &&
        event === "notification:new" &&
        payload.type === "ownership_transferred" &&
        payload.teamId === 20,
    ),
    true,
  );
});
