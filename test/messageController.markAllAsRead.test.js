const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const messageController = require("../src/controllers/messageController");

const originalQuery = db.query;

test.afterEach(() => {
  db.query = originalQuery;
});

const createResponse = () => ({
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
});

const createReq = (emitted) => ({
  user: { id: 10 },
  app: {
    get() {
      return {
        to(room) {
          return {
            emit(event, payload) {
              emitted.push({ room, event, payload });
            },
          };
        },
      };
    },
  },
});

test("markAllAsRead clears direct and team unread messages and reports the counts", async () => {
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql, params });

    if (sql.includes("UPDATE messages") && sql.includes("SET read_at = NOW()")) {
      return { rows: [{ id: 1 }, { id: 2 }] };
    }

    if (sql.includes("INSERT INTO message_reads")) {
      return { rows: [{ message_id: 3 }, { message_id: 4 }, { message_id: 5 }] };
    }

    if (sql.includes("UPDATE notifications") && sql.includes("message_mention")) {
      return { rows: [{ id: 6 }] };
    }

    throw new Error(`Unexpected query in markAllAsRead test: ${sql}`);
  };

  const emitted = [];
  const req = createReq(emitted);
  const res = createResponse();

  await messageController.markAllAsRead(req, res);

  const directQuery = queries.find(({ sql }) => sql.includes("UPDATE messages"));
  const teamQuery = queries.find(({ sql }) =>
    sql.includes("INSERT INTO message_reads"),
  );

  // Direct clears only the user's own unread received DMs.
  assert.match(directQuery.sql, /receiver_id = \$1/);
  assert.match(directQuery.sql, /read_at IS NULL/);
  assert.match(directQuery.sql, /team_id IS NULL/);
  assert.deepEqual(directQuery.params, [10]);

  // Team read receipts skip the user's own messages and existing reads.
  assert.match(teamQuery.sql, /m\.sender_id != \$1/);
  assert.match(teamQuery.sql, /NOT EXISTS/);
  assert.deepEqual(teamQuery.params, [10]);

  const mentionQuery = queries.find(
    ({ sql }) =>
      sql.includes("UPDATE notifications") && sql.includes("message_mention"),
  );
  assert.match(mentionQuery.sql, /read_at IS NULL/);
  assert.deepEqual(mentionQuery.params, [10]);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.markedDirect, 2);
  assert.equal(res.body.data.markedTeam, 3);
  assert.equal(res.body.data.markedMentions, 1);
});

test("markAllAsRead emits messages:read-all to the user's own room", async () => {
  db.query = async (sql) => {
    if (sql.includes("UPDATE messages")) return { rows: [] };
    if (sql.includes("INSERT INTO message_reads")) return { rows: [] };
    if (sql.includes("UPDATE notifications")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };

  const emitted = [];
  const req = createReq(emitted);
  const res = createResponse();

  await messageController.markAllAsRead(req, res);

  // With nothing to clear, only the messages:read-all signal is emitted (no
  // mention refresh).
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].room, "user:10");
  assert.equal(emitted[0].event, "messages:read-all");
  assert.equal(emitted[0].payload.userId, 10);
  assert.equal(res.statusCode, 200);
  // Nothing to clear still succeeds with zero counts.
  assert.equal(res.body.data.markedDirect, 0);
  assert.equal(res.body.data.markedTeam, 0);
  assert.equal(res.body.data.markedMentions, 0);
});
