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

const createRequest = (body = {}) => ({
  params: { id: "10" },
  user: { id: 7 },
  body,
  app: { get: () => null },
});

test.afterEach(() => {
  db.pool.query = originalQuery;
  db.pool.connect = originalConnect;
  process.env.NODE_ENV = originalNodeEnv;
});

// STATUS item 40b. The mock stands in for the database: two external
// applicants (one of them twice, for two roles), one invitee.
const OPEN_REQUESTS = [
  { kind: "application", user_id: 21 },
  { kind: "application", user_id: 21 },
  { kind: "application", user_id: 22 },
  { kind: "invitation", user_id: 23 },
];

function setup({ otherMembers, openRequests = OPEN_REQUESTS }) {
  const dms = [];
  const clientSql = [];

  db.pool.query = async (sql, params = []) => {
    if (sql.includes("tm.role = 'owner'") && sql.includes("FROM teams t")) {
      return { rows: [{ id: 10, name: "Road & Prose", role: "owner" }] };
    }
    if (sql.includes("COUNT(*)::int AS count") && sql.includes("user_id != $2")) {
      return { rows: [{ count: otherMembers }] };
    }
    if (sql.includes("SELECT 'application' AS kind")) {
      return { rows: openRequests };
    }
    if (sql.includes("SELECT first_name, last_name, username FROM users")) {
      return { rows: [{ first_name: "Julia", last_name: "Baur", username: "juliab" }] };
    }
    if (sql.includes("SELECT user_id FROM team_members")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO messages")) {
      const row = {
        id: 900 + dms.length,
        sender_id: params[0],
        receiver_id: params[1],
        content: params[2],
        sent_at: new Date(),
      };
      if (params.length === 3 && sql.includes("receiver_id")) dms.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  };

  db.pool.connect = async () => ({
    async query(sql) {
      clientSql.push(sql);
      if (sql.includes("teamavatar_url")) {
        return { rows: [{ teamavatar_url: null, teamavatar_file_id: null }] };
      }
      return { rows: [] };
    },
    release() {},
  });

  return { dms, clientSql };
}

test("archiving DMs each applicant once and each invitee, and closes their requests", async () => {
  process.env.NODE_ENV = "production";
  const { dms, clientSql } = setup({ otherMembers: 2 });

  const res = createResponse();
  await teamController.deleteTeam(createRequest(), res);

  assert.equal(res.statusCode, 200);

  const events = dms.filter((m) => m.content.startsWith("🗑️ REQUEST_VOID:"));
  assert.deepEqual(
    events.map((m) => [m.receiver_id, m.content]),
    [
      [21, "🗑️ REQUEST_VOID: 10:Road & Prose | 7:Julia Baur | application | archived | false"],
      [22, "🗑️ REQUEST_VOID: 10:Road & Prose | 7:Julia Baur | application | archived | false"],
      [23, "🗑️ REQUEST_VOID: 10:Road & Prose | 7:Julia Baur | invitation | archived | false"],
    ],
  );
  assert.equal(events.every((m) => m.sender_id === 7), true);
  assert.equal(dms.length, 3, "no personal message was written, so no extra DM");

  // Closed in the archiving transaction, the way a withdrawal does it.
  assert.equal(
    clientSql.some((q) => q.includes("UPDATE team_invitations") && q.includes("'canceled'")),
    true,
  );
  assert.equal(
    clientSql.some((q) => q.includes("DELETE FROM team_applications")),
    true,
  );
});

test("a personal message follows the event as its own DM and sets the flag", async () => {
  process.env.NODE_ENV = "production";
  const { dms } = setup({
    otherMembers: 2,
    openRequests: [{ kind: "invitation", user_id: 23 }],
  });

  const res = createResponse();
  await teamController.deleteTeam(
    createRequest({ message: '  Sorry - the "plan" | changed.  ' }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(dms.length, 2);
  assert.match(dms[0].content, /\| invitation \| archived \| true$/);
  assert.equal(dms[1].content, 'Sorry - the "plan" | changed.');
  assert.equal(dms[1].receiver_id, 23);
});

test("a solo team is removed at once and its requesters hear 'deleted'", async () => {
  process.env.NODE_ENV = "production";
  const { dms, clientSql } = setup({
    otherMembers: 0,
    openRequests: [{ kind: "application", user_id: 21 }],
  });

  const res = createResponse();
  await teamController.deleteTeam(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.permanentlyDeleted, true);
  assert.equal(clientSql.some((q) => q.includes("DELETE FROM teams WHERE id")), true);
  assert.equal(dms.length, 1);
  assert.match(dms[0].content, /\| application \| deleted \| false$/);
});

test("nobody waiting means no DM at all", async () => {
  process.env.NODE_ENV = "production";
  const { dms } = setup({ otherMembers: 2, openRequests: [] });

  const res = createResponse();
  await teamController.deleteTeam(createRequest({ message: "hello" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(dms.length, 0);
});

test("a message over the limit is refused before anything is written", async () => {
  process.env.NODE_ENV = "production";
  const { dms, clientSql } = setup({ otherMembers: 2 });

  const res = createResponse();
  await teamController.deleteTeam(createRequest({ message: "x".repeat(2001) }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(dms.length, 0);
  assert.equal(clientSql.length, 0);
});
