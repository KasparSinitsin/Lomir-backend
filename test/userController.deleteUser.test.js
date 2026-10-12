const test = require("node:test");
const assert = require("node:assert/strict");

const bcrypt = require("bcrypt");
const db = require("../src/config/database");
const userDeletionController = require("../src/controllers/userDeletionController");
const fileDeletionQueue = require("../src/utils/fileDeletionQueue");
const deletionRecord = require("../src/utils/deletionRecord");
const originalSendRecord = deletionRecord.sendDeletionRecordSoon;

// The deletion record would go out as a real mail (local .env); it is recorded.
let sentRecords = [];
test.beforeEach(() => {
  sentRecords = [];
  deletionRecord.sendDeletionRecordSoon = (record) => {
    sentRecords.push(record);
  };
});

const originalConnect = db.pool.connect;
const originalQuery = db.query;
const originalProcessSoon = fileDeletionQueue.processFileDeletionsSoon;

// What the controller hands to the ImageKit deletion after the commit. The real
// function would query the database outside the mocked client, so it is
// replaced in every test, and db.query fails loudly if anything reaches it.
let handedOver = [];
test.beforeEach(() => {
  handedOver = [];
  fileDeletionQueue.processFileDeletionsSoon = (ids) => {
    handedOver.push(ids);
  };
  db.query = async () => {
    throw new Error("real database call in a deleteUser test");
  };
});
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
function createSuccessfulDeleteClient(calls, { avatarUrl = null, avatarFileId = null } = {}) {
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
              avatar_url: avatarUrl,
              avatar_file_id: avatarFileId,
              password_hash: "stored-hash",
              created_at: new Date("2025-05-05T10:00:00.000Z"),
            },
          ],
        };
      }

      // The ImageKit deletion queue (item 59): DM attachments of user 7, the
      // solo team 10's chat attachments and avatar, and the user's avatar.
      if (sql.includes("INSERT INTO pending_file_deletions")) {
        if (sql.includes("FROM messages m") && sql.includes("m.receiver_id = $1")) {
          assert.equal(params[0], 7);
          return { rows: [{ id: 501 }] };
        }
        if (sql.includes("FROM messages m") && sql.includes("m.team_id = $1")) {
          assert.equal(params[0], 10, "only the solo team's chat is queued");
          return { rows: [{ id: 502 }] };
        }
        if (sql.includes("FROM teams t")) {
          assert.equal(params[0], 10);
          return { rows: [{ id: 503 }] };
        }
        if (sql.includes("unnest")) {
          return { rows: [{ id: 504 }] };
        }
        throw new Error(`Unexpected queue SQL: ${sql}`);
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
            { team_id: 10, team_name: "Solo Team", team_created_at: new Date("2025-06-06T08:00:00.000Z"), member_count: 1, other_member_count: 0 },
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
  db.query = originalQuery;
  fileDeletionQueue.processFileDeletionsSoon = originalProcessSoon;
  deletionRecord.sendDeletionRecordSoon = originalSendRecord;
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
    params[2] === "👑 OWNERSHIP_TEAM: Former Lomir User | 11:Sam Smith",
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

  // The in-chat ownership message names the chosen successor (Mia Ng, id 12),
  // not the default (Sam Smith, id 11). Since BE #354 the SUCCESSOR carries an id
  // token and the departed predecessor stays anonymous: there is nothing to
  // resolve for an account that no longer exists.
  assert.equal(
    calls.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO messages (sender_id, team_id, content, sent_at)") &&
        params[2] === "👑 OWNERSHIP_TEAM: Former Lomir User | 12:Mia Ng",
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

test("deleteUser queues DM attachments, the solo team's files and the avatar inside the transaction, and hands them over after the commit", async () => {
  process.env.NODE_ENV = "production";

  const calls = [];
  const client = createSuccessfulDeleteClient(calls, {
    avatarUrl: "https://ik.imagekit.io/demo123/lomir/avatars/me_1.png",
    avatarFileId: "avatar-file-1",
  });
  db.pool.connect = async () => client;
  bcrypt.compare = async () => true;

  const res = createResponse();
  await userDeletionController.deleteUser(createRequest(), res);

  assert.equal(res.statusCode, 200);
  const at = (predicate) => calls.findIndex(predicate);
  const queueDm = at(({ sql }) => sql.includes("INSERT INTO pending_file_deletions") && sql.includes("m.receiver_id = $1"));
  const deleteDm = at(({ sql }) => sql.includes("DELETE FROM messages") && sql.includes("team_id IS NULL"));
  const queueTeamChat = at(({ sql }) => sql.includes("INSERT INTO pending_file_deletions") && sql.includes("m.team_id = $1"));
  const queueTeamAvatar = at(({ sql }) => sql.includes("INSERT INTO pending_file_deletions") && sql.includes("FROM teams t"));
  const deleteTeamChat = at(({ sql, params }) => sql === "DELETE FROM messages WHERE team_id = $1" && params[0] === 10);
  const deleteTeam = at(({ sql, params }) => sql.includes("DELETE FROM teams WHERE id = $1") && params[0] === 10);
  const queueAvatar = at(({ sql }) => sql.includes("INSERT INTO pending_file_deletions") && sql.includes("unnest"));
  const deleteUserRow = at(({ sql }) => sql.includes("DELETE FROM users WHERE id = $1"));
  const commit = at(({ sql }) => sql === "COMMIT");

  assert.ok(queueDm >= 0 && queueDm < deleteDm, "DM files are queued before the DMs are deleted");
  assert.ok(queueTeamChat >= 0 && queueTeamChat < deleteTeamChat, "team chat files before the team chat");
  assert.ok(queueTeamAvatar > queueTeamChat && queueTeamAvatar < deleteTeam, "the team avatar before the team row");
  assert.ok(queueAvatar >= 0 && queueAvatar < deleteUserRow, "the avatar before the user row");
  assert.ok(commit > deleteUserRow);
  assert.deepEqual(calls[queueAvatar].params, [
    ["https://ik.imagekit.io/demo123/lomir/avatars/me_1.png"],
    ["avatar-file-1"],
    ["account_deletion"],
  ]);
  assert.equal(
    calls.filter(({ sql }) => sql.includes("INSERT INTO pending_file_deletions")).length,
    4,
    "the shared team 20 is transferred, not deleted, so its files are not queued",
  );
  assert.deepEqual(handedOver, [[501, 502, 503, 504]]);
});

test("deleteUser hands nothing over when the transaction rolls back", async () => {
  process.env.NODE_ENV = "production";

  const calls = [];
  const inner = createSuccessfulDeleteClient(calls);
  const client = {
    async query(sql, params) {
      if (sql === "ROLLBACK") {
        calls.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("DELETE FROM users WHERE id = $1")) {
        throw new Error("simulated failure before the commit");
      }
      return inner.query(sql, params);
    },
    release() {},
  };
  db.pool.connect = async () => client;
  bcrypt.compare = async () => true;
  const originalError = console.error;
  console.error = () => {};

  const res = createResponse();
  try {
    await userDeletionController.deleteUser(createRequest(), res);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.ok(calls.some(({ sql }) => sql === "ROLLBACK"));
  assert.ok(!calls.some(({ sql }) => sql === "COMMIT"));
  assert.deepEqual(handedOver, [], "a rolled-back deletion deletes no file");
  assert.deepEqual(sentRecords, [], "and sends no deletion record");
});

test("deleteUser sends one deletion record after the commit: ids, timestamps and the chosen successors only", async () => {
  process.env.NODE_ENV = "production";

  const calls = [];
  db.pool.connect = async () => createSuccessfulDeleteClient(calls);
  bcrypt.compare = async () => true;

  const res = createResponse();
  await userDeletionController.deleteUser(
    createRequest({
      body: { password: "secret123", ownership_overrides: [{ team_id: 20, successor_id: 12 }] },
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(sentRecords.length, 1);
  const record = sentRecords[0];
  assert.equal(record.v, 1);
  assert.equal(record.kind, "account");
  assert.equal(record.id, 7);
  assert.equal(record.createdAt, "2025-05-05T10:00:00.000Z");
  assert.match(record.deletedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(record.successors, [{ team: 20, user: 12 }]);
  assert.deepEqual(record.teams, [{ id: 10, createdAt: "2025-06-06T08:00:00.000Z" }]);
  assert.deepEqual(
    Object.keys(record).sort(),
    ["createdAt", "db", "deletedAt", "id", "kind", "successors", "teams", "v"],
    "nothing else, in particular no name and no e-mail address",
  );
  assert.ok(!JSON.stringify(record).includes("Jane"), "the name is not in the record");
});
