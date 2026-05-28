const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const teamController = require("../src/controllers/teamApplicationsController");

const originalQuery = db.pool.query;

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
