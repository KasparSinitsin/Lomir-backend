const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const invitationController = require("../src/controllers/invitationController");
const teamApplicationsController = require("../src/controllers/teamApplicationsController");
const vacantRoleController = require("../src/controllers/vacantRoleController");
const teamController = require("../src/controllers/teamController");
const { TEAM_ERROR_CODES } = require("../src/config/teamErrors");

const originalQuery = db.pool.query;
const originalConnect = db.pool.connect;

test.afterEach(() => {
  db.pool.query = originalQuery;
  db.pool.connect = originalConnect;
});

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

// Answers each query with the rows of the first rule whose substrings all
// occur in the SQL. An unmatched query fails the test, so a guard that moves
// behind a new query is noticed rather than silently passed.
function route(rules) {
  return async (sql) => {
    const rule = rules.find(([parts]) => parts.every((part) => sql.includes(part)));
    if (!rule) throw new Error(`Unexpected SQL: ${sql}`);
    return { rows: rule[1] };
  };
}

function request({ params = {}, body = {}, userId = 3 } = {}) {
  return {
    params,
    body,
    user: { id: userId },
    app: { get: () => null },
  };
}

function assertCoded(res, status, code, values) {
  assert.equal(res.statusCode, status);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, code);
  assert.deepEqual(res.body.values, values);
  assert.equal(typeof res.body.message, "string", "message is kept");
}

test("TEAM_ERROR_CODES are spelled as their own names", () => {
  for (const [name, value] of Object.entries(TEAM_ERROR_CODES)) {
    assert.equal(value, name);
    assert.match(value, /^[A-Z_]+$/);
  }
  assert.equal(Object.keys(TEAM_ERROR_CODES).length, 15);
});

// --- sendTeamInvitation ----------------------------------------------------

const TEAM = [["FROM teams", "archived_at IS NULL"], [{ id: 42, name: "Alpha", max_members: 5 }]];
const INVITER_IS_OWNER = [["SELECT role FROM team_members"], [{ role: "owner" }]];
const INVITEE_EXISTS = [["SELECT id, username FROM users"], [{ id: 8, username: "bea" }]];

async function sendInvitation(rules, body = {}) {
  db.pool.query = route(rules);
  const res = createResponse();
  await invitationController.sendTeamInvitation(
    request({ params: { teamId: "42" }, body: { inviteeId: 8, ...body } }),
    res,
  );
  return res;
}

test("sendTeamInvitation answers an archived team with TEAM_NOT_FOUND", async () => {
  const res = await sendInvitation([[TEAM[0], []]]);
  assertCoded(res, 404, TEAM_ERROR_CODES.TEAM_NOT_FOUND);
});

test("sendTeamInvitation keeps an unreachable guard as prose without a code", async () => {
  const res = await sendInvitation([TEAM, [INVITER_IS_OWNER[0], []]]);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, undefined);
});

test("sendTeamInvitation answers a role that is no longer open with ROLE_NOT_OPEN", async () => {
  const filled = await sendInvitation(
    [TEAM, INVITER_IS_OWNER, [["FROM team_vacant_roles"], [{ id: 9, status: "filled", role_name: "Designer" }]]],
    { roleId: 9 },
  );
  assertCoded(filled, 400, TEAM_ERROR_CODES.ROLE_NOT_OPEN);

  const deleted = await sendInvitation(
    [TEAM, INVITER_IS_OWNER, [["FROM team_vacant_roles"], []]],
    { roleId: 9 },
  );
  assertCoded(deleted, 400, TEAM_ERROR_CODES.ROLE_NOT_OPEN);
});

test("sendTeamInvitation answers an invitee who joined meanwhile with INVITEE_ALREADY_MEMBER", async () => {
  const res = await sendInvitation([
    TEAM,
    INVITER_IS_OWNER,
    INVITEE_EXISTS,
    [["SELECT id FROM team_members"], [{ id: 1 }]],
  ]);
  assertCoded(res, 400, TEAM_ERROR_CODES.INVITEE_ALREADY_MEMBER);
});

test("sendTeamInvitation answers a full team with TEAM_FULL", async () => {
  const res = await sendInvitation([
    TEAM,
    INVITER_IS_OWNER,
    INVITEE_EXISTS,
    [["SELECT id FROM team_members"], []],
    [["COUNT(*) as count FROM team_members"], [{ count: "5" }]],
  ]);
  assertCoded(res, 400, TEAM_ERROR_CODES.TEAM_FULL);
});

const NOT_A_MEMBER_WITH_ROOM = [
  TEAM,
  INVITER_IS_OWNER,
  INVITEE_EXISTS,
  [["SELECT id FROM team_members"], []],
  [["COUNT(*) as count FROM team_members"], [{ count: "2" }]],
];

test("sendTeamInvitation answers a second invitation with INVITATION_ALREADY_PENDING", async () => {
  const res = await sendInvitation([
    ...NOT_A_MEMBER_WITH_ROOM,
    [["FROM team_invitations", "status = 'pending'"], [{ id: 70 }]],
  ]);
  assertCoded(res, 400, TEAM_ERROR_CODES.INVITATION_ALREADY_PENDING);
});

test("sendTeamInvitation answers an invitee who applied meanwhile with INVITEE_HAS_PENDING_APPLICATION", async () => {
  const res = await sendInvitation([
    ...NOT_A_MEMBER_WITH_ROOM,
    [["FROM team_invitations", "status = 'pending'"], []],
    [["DELETE FROM team_invitations"], []],
    [["FROM team_applications", "status = 'pending'"], [{ id: 80 }]],
  ]);
  assertCoded(res, 400, TEAM_ERROR_CODES.INVITEE_HAS_PENDING_APPLICATION);
});

// --- applyToJoinTeam ---------------------------------------------------------

async function apply(rules, body = {}) {
  db.pool.query = route(rules);
  const res = createResponse();
  await teamApplicationsController.applyToJoinTeam(
    request({ params: { id: "42" }, body: { message: "Hello", ...body }, userId: 7 }),
    res,
  );
  return res;
}

test("applyToJoinTeam answers a member applying without a role with ALREADY_MEMBER", async () => {
  const res = await apply([TEAM, [["SELECT id FROM team_members"], [{ id: 1 }]]]);
  assertCoded(res, 400, TEAM_ERROR_CODES.ALREADY_MEMBER);
});

test("applyToJoinTeam answers a second application with APPLICATION_ALREADY_PENDING", async () => {
  const res = await apply([
    TEAM,
    [["SELECT id FROM team_members"], []],
    [["COUNT(*) as count FROM team_members"], [{ count: "2" }]],
    [["FROM team_applications", "status = 'pending'"], [{ id: 80 }]],
  ]);
  assertCoded(res, 400, TEAM_ERROR_CODES.APPLICATION_ALREADY_PENDING);
});

test("applyToJoinTeam answers an archived team with TEAM_NOT_FOUND", async () => {
  const res = await apply([[TEAM[0], []]]);
  assertCoded(res, 404, TEAM_ERROR_CODES.TEAM_NOT_FOUND);
});

// --- invitations: respond and cancel ----------------------------------------

test("respondToInvitation answers a handled invitation with INVITATION_UNAVAILABLE", async () => {
  db.pool.query = route([[["FROM team_invitations ti"], []]]);
  const res = createResponse();
  await invitationController.respondToInvitation(
    request({ params: { invitationId: "70" }, body: { action: "accept" }, userId: 7 }),
    res,
  );
  assertCoded(res, 404, TEAM_ERROR_CODES.INVITATION_UNAVAILABLE);
});

for (const [name, handler] of [
  ["cancelInvitation", invitationController.cancelInvitation],
  ["cancelRoleInvitation", invitationController.cancelRoleInvitation],
]) {
  test(`${name} answers a handled invitation with INVITATION_UNAVAILABLE`, async () => {
    db.pool.query = route([[["FROM team_invitations ti"], []]]);
    const res = createResponse();
    await handler(request({ params: { invitationId: "70" } }), res);
    assertCoded(res, 404, TEAM_ERROR_CODES.INVITATION_UNAVAILABLE);
  });
}

test("cancelRoleInvitation answers a role invitation already withdrawn with ROLE_INVITATION_WITHDRAWN", async () => {
  // An invitee outside the team keeps a pending team invitation whose role
  // was unlinked by the first admin.
  db.pool.query = route([
    [["FROM team_invitations ti"], [{ id: 70, team_id: 42, invitee_id: 8, role_id: null, is_internal: false }]],
  ]);
  const res = createResponse();
  await invitationController.cancelRoleInvitation(request({ params: { invitationId: "70" } }), res);
  assertCoded(res, 400, TEAM_ERROR_CODES.ROLE_INVITATION_WITHDRAWN);
});

function mockRoleOfferAccept({ roleStatus }) {
  db.pool.query = route([
    [
      ["FROM team_invitations ti"],
      [
        {
          id: 70,
          team_id: 42,
          invitee_id: 7,
          role_id: 9,
          role_name: "Designer",
          role_status: roleStatus,
          max_members: 5,
          team_name: "Alpha",
        },
      ],
    ],
  ]);
  const statements = [];
  const clientQuery = route([
    [["BEGIN"], []],
    [["ROLLBACK"], []],
    [["DELETE FROM notifications"], []],
    [["SELECT id FROM team_members"], [{ id: 1 }]],
    [["UPDATE team_invitations"], []],
    [["FROM team_vacant_roles", "filled_by = $2"], [{ id: 3, role_name: "Developer" }]],
  ]);
  db.pool.connect = async () => ({
    query: (sql, params) => {
      statements.push(sql.trim());
      return clientQuery(sql, params);
    },
    release() {},
  });
  return statements;
}

test("respondToInvitation names the role already filled with ALREADY_FILLING_ROLE", async () => {
  const statements = mockRoleOfferAccept({ roleStatus: "open" });
  const res = createResponse();
  await invitationController.respondToInvitation(
    request({ params: { invitationId: "70" }, body: { action: "accept" }, userId: 7 }),
    res,
  );
  assertCoded(res, 409, TEAM_ERROR_CODES.ALREADY_FILLING_ROLE, { roleName: "Developer" });
  assert.ok(statements.includes("ROLLBACK"));
});

test("respondToInvitation answers a switch to a role that is gone with ROLE_OFFER_UNAVAILABLE", async () => {
  mockRoleOfferAccept({ roleStatus: "filled" });
  const res = createResponse();
  await invitationController.respondToInvitation(
    request({
      params: { invitationId: "70" },
      body: { action: "accept", switch_roles: true },
      userId: 7,
    }),
    res,
  );
  assertCoded(res, 400, TEAM_ERROR_CODES.ROLE_OFFER_UNAVAILABLE);
});

// --- applications: cancel ----------------------------------------------------

test("cancelApplication answers a handled application with APPLICATION_UNAVAILABLE", async () => {
  db.pool.query = route([[["FROM team_applications ta"], []]]);
  const res = createResponse();
  await teamApplicationsController.cancelApplication(
    request({ params: { applicationId: "5" }, userId: 7 }),
    res,
  );
  assertCoded(res, 404, TEAM_ERROR_CODES.APPLICATION_UNAVAILABLE);
});

// --- vacant roles --------------------------------------------------------------

const ROLE_ADMIN = [["FROM team_members tm", "t.archived_at IS NULL"], [{ role: "admin" }]];

test("updateVacantRole, deleteVacantRole and updateVacantRoleStatus answer a deleted role with ROLE_NOT_FOUND", async () => {
  const params = { teamId: "42", roleId: "9" };
  const cases = [
    [vacantRoleController.updateVacantRole, {}, [["FROM team_vacant_roles"], []]],
    [vacantRoleController.deleteVacantRole, {}, [["DELETE FROM team_vacant_roles"], []]],
    [vacantRoleController.updateVacantRoleStatus, { status: "closed" }, [["UPDATE team_vacant_roles"], []]],
  ];

  for (const [handler, body, roleRule] of cases) {
    db.pool.query = route([ROLE_ADMIN, roleRule]);
    const res = createResponse();
    await handler(request({ params, body }), res);
    assertCoded(res, 404, TEAM_ERROR_CODES.ROLE_NOT_FOUND);
  }
});

// --- team settings -------------------------------------------------------------

async function updateTeam(body, memberCount) {
  const updates = [];
  db.pool.query = route([
    [["FROM teams t", "tm.role = 'owner' OR tm.role = 'admin'"], [{ id: 42, role: "owner" }]],
    [["COUNT(*) AS count FROM team_members"], [{ count: String(memberCount) }]],
  ]);
  db.pool.connect = async () => ({
    query: async (sql) => {
      updates.push(sql.trim());
      if (sql.includes("UPDATE teams")) return { rows: [{ id: 42, max_members: body.max_members }] };
      return { rows: [] };
    },
    release() {},
  });
  const res = createResponse();
  await teamController.updateTeam(request({ params: { id: "42" }, body }), res);
  return { res, updates };
}

test("updateTeam refuses a maximum below the member count with MAX_MEMBERS_BELOW_MEMBER_COUNT", async () => {
  const { res, updates } = await updateTeam({ max_members: 7 }, 9);
  assertCoded(res, 400, TEAM_ERROR_CODES.MAX_MEMBERS_BELOW_MEMBER_COUNT, { memberCount: 9 });
  assert.equal(updates.length, 0, "nothing is written");
});

test("updateTeam accepts a maximum equal to the member count, and unlimited", async () => {
  for (const [body, count] of [[{ max_members: 9 }, 9], [{ max_members: null }, 30]]) {
    const { res, updates } = await updateTeam(body, count);
    assert.notEqual(res.body?.code, TEAM_ERROR_CODES.MAX_MEMBERS_BELOW_MEMBER_COUNT);
    assert.ok(updates.some((sql) => sql.startsWith("UPDATE teams")), JSON.stringify(res.body));
  }
});
