const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const { getTeamById } = require("../src/controllers/teamReadController");
const { TEAM_ERROR_CODES } = require("../src/config/teamErrors");

const originalQuery = db.pool.query;

test.afterEach(() => {
  db.pool.query = originalQuery;
});

// Item 34: chat events name teams by id, and a deleted team must render as
// text while a private one stays a link. Both answer 404, so the code says
// which: TEAM_NOT_FOUND = gone (hard-deleted, or archived to a non-member),
// TEAM_NOT_ACCESSIBLE = exists, private, reader not a member.
async function answer({ team, isMember = false, user = { id: 7 } }) {
  db.pool.query = async (text) => {
    const sql = String(text);
    if (sql.includes("FROM teams t")) return { rows: team ? [team] : [] };
    if (sql.includes("SELECT 1 FROM team_members")) return { rows: isMember ? [{ "?column?": 1 }] : [] };
    return { rows: [] };
  };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
  await getTeamById({ params: { id: "152" }, user: user ?? undefined }, res);
  return res;
}

test("a team that does not exist answers TEAM_NOT_FOUND", async () => {
  const res = await answer({ team: null });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, TEAM_ERROR_CODES.TEAM_NOT_FOUND);
});

test("an archived team answers TEAM_NOT_FOUND to a non-member", async () => {
  const res = await answer({ team: { id: 152, is_public: true, archived_at: "2026-09-01" } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, TEAM_ERROR_CODES.TEAM_NOT_FOUND);
});

test("a private team answers TEAM_NOT_ACCESSIBLE to a non-member and to a guest", async () => {
  const member = await answer({ team: { id: 152, is_public: false, archived_at: null } });
  assert.equal(member.statusCode, 404);
  assert.equal(member.body.code, TEAM_ERROR_CODES.TEAM_NOT_ACCESSIBLE);

  const guest = await answer({ team: { id: 152, is_public: false, archived_at: null }, user: null });
  assert.equal(guest.statusCode, 404);
  assert.equal(guest.body.code, TEAM_ERROR_CODES.TEAM_NOT_ACCESSIBLE);
});

test("a 404 never carries anything about the team but its code", async () => {
  const res = await answer({ team: { id: 152, name: "Secret Team", is_public: false, archived_at: null } });
  assert.deepEqual(Object.keys(res.body).sort(), ["code", "message", "success"]);
  assert.doesNotMatch(JSON.stringify(res.body), /Secret Team/);
});

test("members still get an archived or private team", async () => {
  const archived = await answer({ team: { id: 152, is_public: true, archived_at: "2026-09-01" }, isMember: true });
  assert.equal(archived.statusCode, 200);
  const priv = await answer({ team: { id: 152, is_public: false, archived_at: null }, isMember: true });
  assert.equal(priv.statusCode, 200);
});
