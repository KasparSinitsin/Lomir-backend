const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const teamController = require("../src/controllers/teamController");

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

    throw new Error(`Unexpected pool SQL in solo delete test: ${sql}`);
  };

  // permanentlyDeleteTeam runs its own transaction through a dedicated client.
  const client = {
    async query(sql, params = []) {
      clientCalls.push({ sql, params });
      if (sql.includes("teamavatar_url")) {
        return { rows: [{ teamavatar_url: null, teamavatar_file_id: null }] };
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
