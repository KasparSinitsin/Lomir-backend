const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const teamController = require("../src/controllers/teamApplicationsController");

const originalQuery = db.pool.query;
const originalDbQuery = db.query;
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
  db.query = originalDbQuery;
  db.pool.connect = originalConnect;
});

test("getTeamApplications includes filled_by and filled_by_user on embedded roles", async () => {
  const calls = [];

  db.pool.query = async (sql, params = []) => {
    calls.push({ sql, params });

    if (sql.includes("FROM team_members tm") && sql.includes("t.archived_at IS NULL")) {
      return { rows: [{ role: "owner" }] };
    }

    if (sql.includes("FROM team_applications ta") && sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id")) {
      return {
        rows: [
          {
            id: 300,
            role_id: 9,
            message: "I can help with backend work.",
            status: "pending",
            created_at: "2026-03-23T08:00:00.000Z",
            role_name: "Backend Developer",
            role_bio: "Node.js and APIs",
            role_city: "Berlin",
            role_country: "Germany",
            role_state: "Berlin",
            role_is_remote: true,
            role_latitude: null,
            role_longitude: null,
            role_max_distance_km: null,
            role_status: "filled",
            role_filled_by: 45,
            role_filled_by_user_id: 45,
            role_filled_by_user_first_name: "Robert",
            role_filled_by_user_last_name: "Smith",
            role_filled_by_user_username: "rsmith",
            role_filled_by_user_avatar_url: "https://example.com/avatar.png",
            applicant_id: 55,
            username: "applicant55",
            first_name: "Jamie",
            last_name: "Doe",
            bio: "API engineer",
            avatar_url: "https://example.com/applicant.png",
            postal_code: "10115",
            city: "Berlin",
            country: "Germany",
            state: "Berlin",
            applicant_latitude: 52.52,
            applicant_longitude: 13.405,
          },
        ],
      };
    }

    if (sql.includes("FROM team_vacant_role_tags")) {
      return {
        rows: [
          {
            role_id: 9,
            tag_id: 301,
            name: "Node.js",
            category: "backend",
            supercategory: "skills",
          },
        ],
      };
    }

    if (sql.includes("FROM team_vacant_role_badges")) {
      return {
        rows: [
          {
            role_id: 9,
            badge_id: 401,
            name: "API Pro",
            category: "backend",
            color: "blue",
            image_url: "https://example.com/badge.png",
            cat_image_url: null,
          },
        ],
      };
    }

    if (sql.includes("SELECT user_id, tag_id FROM user_tags")) {
      return {
        rows: [{ user_id: 55, tag_id: 301 }],
      };
    }

    if (sql.includes("SELECT DISTINCT ba.awarded_to_user_id AS user_id, ba.badge_id")) {
      return {
        rows: [{ user_id: 55, badge_id: 401 }],
      };
    }

    throw new Error(`Unexpected SQL in getTeamApplications test: ${sql}`);
  };

  const req = {
    params: { id: "42" },
    user: { id: 7 },
  };
  const res = createResponse();

  await teamController.getTeamApplications(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data[0].role.filled_by, 45);
  assert.deepEqual(res.body.data[0].role.filled_by_user, {
    id: 45,
    first_name: "Robert",
    last_name: "Smith",
    username: "rsmith",
    avatar_url: "https://example.com/avatar.png",
  });
  assert.ok(
    calls.some(({ sql }) =>
      sql.includes("LEFT JOIN users fu ON vr.filled_by = fu.id"),
    ),
  );
});

// The toast renders from these fields in the reader's language; `title` stays
// English on the wire as the fallback for an older frontend.
test("handleTeamApplication decline emits application_rejected with the team name as data", async () => {
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

  db.pool.query = async (sql) => {
    if (sql.includes("FROM team_applications ta")) {
      return {
        rows: [
          {
            id: 5,
            team_id: 42,
            applicant_id: 7,
            owner_id: 3,
            max_members: 5,
            team_name: "Alpha",
            role: "owner",
            role_id: null,
            role_name: null,
            applicant_first_name: "Jamie",
            applicant_last_name: "Doe",
            applicant_username: "jamiedoe",
          },
        ],
      };
    }
    if (sql.includes("SELECT first_name, last_name, username FROM users WHERE id = $1")) {
      return { rows: [{ first_name: "Alice", last_name: "Admin", username: "aliceadmin" }] };
    }
    throw new Error(`Unexpected pool SQL in decline test: ${sql}`);
  };

  db.pool.connect = async () => ({
    async query(sql, params = []) {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (sql.includes("DELETE FROM notifications")) return { rows: [] };
      if (sql.includes("UPDATE team_applications")) return { rows: [] };
      if (sql.includes("INSERT INTO messages")) {
        return {
          rows: [
            {
              id: 600,
              sender_id: 3,
              receiver_id: 7,
              content: params[2],
              sent_at: "2026-09-16T12:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`Unexpected client SQL in decline test: ${sql}`);
    },
    release() {},
  });

  db.query = async (sql) => {
    if (sql.includes("SELECT username, first_name, last_name FROM users")) {
      return { rows: [{ username: "aliceadmin", first_name: "Alice", last_name: "Admin" }] };
    }
    if (sql.includes("INSERT INTO notifications")) {
      return { rows: [{ id: 900 }] };
    }
    throw new Error(`Unexpected db SQL in decline test: ${sql}`);
  };

  const req = {
    params: { applicationId: "5" },
    user: { id: 3 },
    body: { action: "decline" },
    app: { get: () => io },
  };
  const res = createResponse();

  await teamController.handleTeamApplication(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const event = emits.find(
    ({ room, event, payload }) =>
      room === "user:7" &&
      event === "notification:new" &&
      payload.type === "application_rejected",
  );
  assert.ok(event);
  assert.equal(event.payload.teamName, "Alpha");
  assert.equal(event.payload.actorName, "Alice Admin");
  assert.equal(typeof event.payload.title, "string");
});
