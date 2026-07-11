const test = require("node:test");
const assert = require("node:assert/strict");

const bcrypt = require("bcrypt");
const db = require("../src/config/database");
const userDeletionController = require("../src/controllers/userDeletionController");

const originalQuery = db.pool.query;
const originalCompare = bcrypt.compare;

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

function createRequest({
  userId = 7,
  paramId = "7",
  body = { password: "secret123" },
} = {}) {
  return {
    params: { id: paramId },
    user: { id: userId },
    body,
  };
}

test.afterEach(() => {
  db.pool.query = originalQuery;
  bcrypt.compare = originalCompare;
});

test("deletionPreview rejects attempts to preview another user's account", async () => {
  let queryCalled = false;

  db.pool.query = async () => {
    queryCalled = true;
    throw new Error("query should not be called");
  };

  const req = createRequest({ userId: 7, paramId: "8" });
  const res = createResponse();

  await userDeletionController.deletionPreview(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /your own account/i);
  assert.equal(queryCalled, false);
});

test("deletionPreview returns 401 when the password is incorrect", async () => {
  const calls = [];

  db.pool.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("SELECT id, password_hash FROM users WHERE id = $1")) {
      return { rows: [{ id: 7, password_hash: "stored-hash" }] };
    }

    throw new Error(`Unexpected SQL in wrong-password test: ${sql}`);
  };

  bcrypt.compare = async (password, hash) => {
    assert.equal(password, "secret123");
    assert.equal(hash, "stored-hash");
    return false;
  };

  const req = createRequest();
  const res = createResponse();

  await userDeletionController.deletionPreview(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /password is incorrect/i);
  assert.equal(calls.length, 1);
});

test("deletionPreview returns transfer, deletion, role, and count summaries", async () => {
  const calls = [];

  db.pool.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("SELECT id, password_hash FROM users WHERE id = $1")) {
      return { rows: [{ id: 7, password_hash: "stored-hash" }] };
    }

    if (sql.includes("JOIN team_members tm_owner")) {
      return {
        rows: [
          {
            team_id: 10,
            team_name: "Solo Team",
            member_count: 1,
            other_member_count: 0,
          },
          {
            team_id: 20,
            team_name: "Shared Team",
            member_count: 3,
            other_member_count: 2,
          },
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
            role_id: 30,
            role_name: "Backend Developer",
            team_id: 20,
            team_name: "Shared Team",
          },
        ],
      };
    }

    if (sql.includes("FROM badge_awards")) {
      return { rows: [{ count: 4 }] };
    }

    if (sql.includes("FROM team_members") && sql.includes("WHERE user_id = $1")) {
      return { rows: [{ count: 5 }] };
    }

    if (sql.includes("FROM messages") && sql.includes("team_id IS NULL")) {
      return { rows: [{ count: 6 }] };
    }

    if (sql.includes("ROW_NUMBER() OVER")) {
      return {
        rows: [
          {
            team_id: 20,
            user_id: 11,
            role: "admin",
            joined_at: new Date("2024-01-15T12:00:00.000Z"),
            first_name: "Jamie",
            last_name: "Rivera",
            username: "jamier",
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in success test: ${sql}`);
  };

  bcrypt.compare = async (password, hash) => {
    assert.equal(password, "secret123");
    assert.equal(hash, "stored-hash");
    return true;
  };

  const req = createRequest();
  const res = createResponse();

  await userDeletionController.deletionPreview(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data.teamsToDelete, [
    { teamId: 10, teamName: "Solo Team" },
  ]);
  assert.deepEqual(res.body.data.teamsToTransfer, [
    {
      teamId: 20,
      teamName: "Shared Team",
      successor: {
        userId: 11,
        name: "Jamie Rivera",
        role: "admin",
        joinedAt: "2024-01-15T12:00:00.000Z",
      },
      memberCount: 3,
    },
  ]);
  assert.deepEqual(res.body.data.rolesToReopen, [
    {
      roleId: 30,
      roleName: "Backend Developer",
      teamId: 20,
      teamName: "Shared Team",
    },
  ]);
  assert.deepEqual(res.body.data.counts, {
    badgeAwardsGiven: 4,
    teamMemberships: 5,
    directMessages: 6,
  });
  assert.equal(
    calls.some(
      ({ sql, params }) =>
        sql.includes("ROW_NUMBER() OVER") &&
        Array.isArray(params[0]) &&
        params[0].length === 1 &&
        params[0][0] === 20,
    ),
    true,
  );
});
