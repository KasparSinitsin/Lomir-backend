const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const { TEAM_ERROR_CODES } = require("../src/config/teamErrors");
const teamApplicationsController = require("../src/controllers/teamApplicationsController");

const originalQuery = db.pool.query;
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

test.afterEach(() => {
  db.pool.query = originalQuery;
  db.pool.connect = originalConnect;
});

// STATUS item 40: approving a pending application to an archived team added
// the applicant to it. The mock answers the application lookup as the
// database would for an archived team — no row once the query filters on
// `t.archived_at IS NULL`, the pending row if it does not.
for (const action of ["approve", "decline"]) {
  test(`handleTeamApplication refuses to ${action} an application to an archived team`, async () => {
    let transactionStarted = false;

    db.pool.query = async (sql) => {
      if (sql.includes("FROM team_applications ta")) {
        if (sql.includes("t.archived_at IS NULL")) return { rows: [] };
        return {
          rows: [
            {
              id: 300,
              team_id: 7,
              applicant_id: 55,
              owner_id: 1,
              role: "owner",
              status: "pending",
              team_name: "Archived Team",
              max_members: null,
              applicant_first_name: "Jamie",
              applicant_last_name: "Doe",
              applicant_username: "applicant55",
            },
          ],
        };
      }
      return { rows: [] };
    };
    db.pool.connect = async () => {
      transactionStarted = true;
      throw new Error("no write may start for an archived team");
    };

    const req = {
      params: { applicationId: "300" },
      body: { action },
      user: { id: 1 },
      app: { get: () => null },
    };
    const res = createResponse();

    await teamApplicationsController.handleTeamApplication(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, TEAM_ERROR_CODES.APPLICATION_UNAVAILABLE);
    assert.equal(transactionStarted, false);
  });
}
