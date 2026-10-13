const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const teamController = require("../src/controllers/teamController");
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
const originalProcessSoon = fileDeletionQueue.processFileDeletionsSoon;

// permanentlyDeleteTeam hands the queued ImageKit files over after its commit
// (item 59). The real hand-over queries the database, so it is recorded instead.
let handedOver = [];
test.beforeEach(() => {
  handedOver = [];
  fileDeletionQueue.processFileDeletionsSoon = (ids) => {
    handedOver.push(ids);
  };
});

const originalQuery = db.pool.query;
const originalConnect = db.pool.connect;
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

function createRequest({ userId = 7, paramId = "10", io = null } = {}) {
  return {
    params: { id: paramId },
    user: { id: userId },
    app: {
      get() {
        return io;
      },
    },
  };
}

test.afterEach(() => {
  fileDeletionQueue.processFileDeletionsSoon = originalProcessSoon;
  deletionRecord.sendDeletionRecordSoon = originalSendRecord;
  db.pool.query = originalQuery;
  db.pool.connect = originalConnect;
  process.env.NODE_ENV = originalNodeEnv;
});

test("deleteTeam permanently deletes a solo team (owner is the only member) instead of archiving", async () => {
  process.env.NODE_ENV = "production";

  const poolCalls = [];
  const clientCalls = [];

  db.pool.query = async (sql, params = []) => {
    poolCalls.push({ sql, params });

    if (sql.includes("tm.role = 'owner'") && sql.includes("FROM teams t")) {
      // Owner authorization check
      return { rows: [{ id: 10, name: "Solo Team", role: "owner" }] };
    }

    if (sql.includes("COUNT(*)::int AS count") && sql.includes("user_id != $2")) {
      // No other members besides the owner
      return { rows: [{ count: 0 }] };
    }

    if ((sql.includes("UNION ALL") && sql.includes("FROM team_applications ta"))) {
      // Nobody has an open application or invitation
      return { rows: [] };
    }

    throw new Error(`Unexpected pool SQL in solo delete test: ${sql}`);
  };

  // permanentlyDeleteTeam runs its own transaction through a dedicated client.
  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (sql.includes("SELECT created_at FROM teams")) {
        return { rows: [{ created_at: new Date("2025-07-07T07:00:00.000Z") }] };
      }
      if (sql.includes("INSERT INTO pending_file_deletions")) {
        // chat attachments, then the team avatar
        return { rows: [{ id: sql.includes("FROM teams t") ? 702 : 701 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  db.pool.connect = async () => client;

  const req = createRequest({ userId: 7, paramId: "10" });
  const res = createResponse();

  await teamController.deleteTeam(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.permanentlyDeleted, true);

  // The hard-delete path ran: messages and the team row were removed...
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("DELETE FROM messages WHERE team_id")),
    true,
    "expected the team chat messages to be deleted",
  );
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("DELETE FROM teams WHERE id")),
    true,
    "expected the team row to be deleted",
  );
  assert.equal(clientCalls.some(({ sql }) => sql === "COMMIT"), true);

  // Its chat files and avatar were queued before the rows went, and handed to
  // the ImageKit deletion after the commit (item 59).
  const at = (predicate) => clientCalls.findIndex(predicate);
  const queuedChat = at(({ sql }) => sql.includes("INSERT INTO pending_file_deletions") && sql.includes("FROM messages m"));
  const queuedAvatar = at(({ sql }) => sql.includes("INSERT INTO pending_file_deletions") && sql.includes("FROM teams t"));
  assert.ok(queuedChat >= 0 && queuedChat < at(({ sql }) => sql.includes("DELETE FROM messages WHERE team_id")));
  assert.ok(queuedAvatar >= 0 && queuedAvatar < at(({ sql }) => sql.includes("DELETE FROM teams WHERE id")));
  // The route passes the id as the string from the URL, as before; Postgres casts it.
  assert.deepEqual(clientCalls[queuedChat].params, ["10", "ik.imagekit.io", "team_deletion"]);
  assert.deepEqual(handedOver, [[701, 702]]);

  // One deletion record, ids and timestamps only (item 59).
  assert.equal(sentRecords.length, 1);
  assert.equal(sentRecords[0].kind, "team");
  assert.equal(sentRecords[0].id, 10);
  assert.equal(sentRecords[0].createdAt, "2025-07-07T07:00:00.000Z");
  assert.deepEqual(Object.keys(sentRecords[0]).sort(), ["createdAt", "db", "deletedAt", "id", "kind", "v"]);

  // ...and the soft-delete/archive path was NOT taken.
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("archived_at = NOW()")),
    false,
    "a solo team must not be archived",
  );
  assert.equal(
    poolCalls.some(({ sql }) => sql.includes("INSERT INTO messages")),
    false,
    "no TEAM_DELETED system message should be posted for a solo team",
  );
});

test("deleteTeam archives (soft-deletes) a team that still has other members", async () => {
  process.env.NODE_ENV = "production";

  const poolCalls = [];
  const clientCalls = [];

  db.pool.query = async (sql, params = []) => {
    poolCalls.push({ sql, params });

    if (sql.includes("tm.role = 'owner'") && sql.includes("FROM teams t")) {
      return { rows: [{ id: 10, name: "Shared Team", role: "owner" }] };
    }

    if (sql.includes("COUNT(*)::int AS count") && sql.includes("user_id != $2")) {
      // Two other members remain
      return { rows: [{ count: 2 }] };
    }

    if (sql.includes("SELECT first_name, last_name, username FROM users")) {
      return { rows: [{ first_name: "Julia", last_name: "Baur", username: "juliab" }] };
    }

    if (sql.includes("SELECT user_id FROM team_members")) {
      return { rows: [{ user_id: 11 }, { user_id: 12 }] };
    }

    if (sql.includes("INSERT INTO messages")) {
      return { rows: [{ id: 555, sender_id: 7, team_id: 10, content: "x", sent_at: new Date() }] };
    }

    // Notification cleanup / createNotification inserts / anything else: no-op.
    return { rows: [] };
  };

  const client = {
    async query(sql) {
      clientCalls.push({ sql });
      return { rows: [] };
    },
    release() {},
  };
  db.pool.connect = async () => client;

  const emits = [];
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          emits.push({ room, event, payload });
        },
      };
    },
  };

  const req = createRequest({ userId: 7, paramId: "10", io });
  const res = createResponse();

  await teamController.deleteTeam(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /archived/i);
  assert.notEqual(res.body.permanentlyDeleted, true);

  // Archive path ran...
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("archived_at = NOW()")),
    true,
    "expected the team to be archived",
  );
  // ...and the team/chat were NOT permanently deleted.
  assert.equal(
    clientCalls.some(({ sql }) => sql.includes("DELETE FROM teams WHERE id")),
    false,
    "a team with other members must not be hard-deleted",
  );
});
