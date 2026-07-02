const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const messageController = require("../src/controllers/messageController");

const originalQuery = db.query;

test.afterEach(() => {
  db.query = originalQuery;
});

const createResponse = () => {
  const res = {
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

  return res;
};

test("sendMessage allows current members to post in an archived team chat", async () => {
  const queries = [];

  db.query = async (sql, params) => {
    queries.push({ sql, params });

    if (sql.includes("FROM team_members tm")) {
      return { rows: [{ "?column?": 1 }] };
    }

    if (sql.includes("INSERT INTO messages")) {
      return {
        rows: [
          {
            id: 123,
            sender_id: 10,
            team_id: 20,
            content: "Still here for the farewell.",
            reply_to_id: null,
            image_url: null,
            file_url: null,
            file_name: null,
            file_size: null,
            file_expires_at: null,
            sent_at: new Date("2026-06-30T10:00:00.000Z"),
          },
        ],
      };
    }

    if (sql.includes("SELECT username, first_name, last_name FROM users")) {
      return {
        rows: [
          { username: "jane", first_name: "Jane", last_name: "Doe" },
        ],
      };
    }

    if (sql.includes("SELECT COUNT(*)::int AS recipient_count")) {
      return { rows: [{ recipient_count: 1 }] };
    }

    return { rows: [] };
  };

  const emitted = [];
  const req = {
    user: { id: 10 },
    params: { id: "20" },
    body: {
      type: "team",
      content: "Still here for the farewell.",
    },
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
  };
  const res = createResponse();

  await messageController.sendMessage(req, res);

  const accessQuery = queries.find(({ sql }) =>
    sql.includes("FROM team_members tm"),
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.doesNotMatch(accessQuery.sql, /archived_at IS NULL/);
  assert.equal(emitted[0].room, "team:20");
  assert.equal(emitted[0].event, "message:received");
});

test("sendMessage still rejects users who are no longer team members", async () => {
  db.query = async (sql) => {
    if (sql.includes("FROM team_members tm")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query for unauthorized team message: ${sql}`);
  };

  const req = {
    user: { id: 10 },
    params: { id: "20" },
    body: {
      type: "team",
      content: "I should not be able to send this.",
    },
  };
  const res = createResponse();

  await messageController.sendMessage(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test("getConversationById includes archived team metadata", async () => {
  db.query = async (sql) => {
    if (sql.includes("FROM teams t") && sql.includes("JOIN team_members tm")) {
      return {
        rows: [
          {
            id: 20,
            name: "Deleted Farewell Team",
            avatar_url: null,
            archived_at: "2026-06-30T12:00:00.000Z",
            status: "inactive",
            members: [
              {
                id: 10,
                userId: 10,
                user_id: 10,
                username: "current_member",
                firstName: "Current",
                lastName: "Member",
                avatarUrl: null,
                role: "member",
              },
            ],
          },
        ],
      };
    }

    throw new Error(`Unexpected query for team conversation details: ${sql}`);
  };

  const req = {
    user: { id: 10 },
    params: { id: "20" },
    query: { type: "team" },
  };
  const res = createResponse();

  await messageController.getConversationById(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.team.archived_at, "2026-06-30T12:00:00.000Z");
  assert.equal(res.body.data.team.archivedAt, "2026-06-30T12:00:00.000Z");
  assert.equal(res.body.data.team.status, "inactive");
  assert.equal(res.body.data.team.members.length, 1);
  assert.equal(res.body.data.team.members[0].userId, 10);
});

test("getConversationById embeds member is_synthetic so the chat skips per-member profile fetches", async () => {
  let memberQuerySql = "";

  db.query = async (sql) => {
    if (sql.includes("FROM teams t") && sql.includes("JOIN team_members tm")) {
      memberQuerySql = sql;
      return {
        rows: [
          {
            id: 20,
            name: "Farewell Team",
            avatar_url: null,
            archived_at: null,
            status: "active",
            members: [
              {
                id: 10,
                userId: 10,
                user_id: 10,
                username: "current_member",
                firstName: "Current",
                lastName: "Member",
                avatarUrl: null,
                is_synthetic: true,
                isSynthetic: true,
                role: "member",
              },
            ],
          },
        ],
      };
    }

    throw new Error(`Unexpected query for team conversation details: ${sql}`);
  };

  const req = {
    user: { id: 10 },
    params: { id: "20" },
    query: { type: "team" },
  };
  const res = createResponse();

  await messageController.getConversationById(req, res);

  // The members payload must carry the synthetic flag so MessageDisplay's gate
  // is satisfied without a per-member getUserById fallback (chat-load N+1).
  assert.match(memberQuerySql, /'is_synthetic',\s*u\.is_synthetic/);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.team.members[0].is_synthetic, true);
  assert.equal(res.body.data.team.members[0].isSynthetic, true);
});
