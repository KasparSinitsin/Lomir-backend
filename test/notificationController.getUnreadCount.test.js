const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const notificationController = require("../src/controllers/notificationController");

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

test("getUnreadCount returns the oldest unread notification per type with a navigation target", async () => {
  db.query = async (sql) => {
    if (sql.includes("first_unread_json")) {
      return {
        rows: [
          {
            count: "3",
            first_unread_json: {
              id: 10,
              type: "application_approved",
              team_id: 45,
              reference_type: "message",
              reference_id: 5,
              actor_id: 7,
              title: "Welcome",
            },
          },
        ],
      };
    }

    if (sql.includes("GROUP BY type")) {
      return {
        rows: [
          { type: "application_approved", count: 1, team_count: 1 },
          { type: "invitation_received", count: 2, team_count: 2 },
        ],
      };
    }

    if (sql.includes("DISTINCT ON (type)")) {
      return {
        rows: [
          {
            id: 10,
            type: "application_approved",
            team_id: 45,
            reference_type: "message",
            reference_id: 5,
            actor_id: 7,
            title: "Welcome",
            created_at: "2026-01-01T00:00:00.000Z",
          },
          {
            id: 22,
            type: "invitation_received",
            team_id: 45,
            reference_type: "invitation",
            reference_id: 99,
            actor_id: 8,
            title: "You are invited",
            created_at: "2026-02-01T00:00:00.000Z",
          },
        ],
      };
    }

    throw new Error(`Unexpected query in getUnreadCount test: ${sql}`);
  };

  const req = { user: { id: 1 } };
  const res = createResponse();

  await notificationController.getUnreadCount(req, res);

  assert.equal(res.statusCode, 200);
  const { typeFirstUnread } = res.body.data;

  // application_approved points at the DM with the approver, highlighting the
  // approval message.
  assert.deepEqual(typeFirstUnread.application_approved, {
    id: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    navigateTo: "/chat/7?type=direct&highlightMessage=5",
  });

  // invitation_received points at the My Teams invitations tab.
  assert.equal(typeFirstUnread.invitation_received.id, 22);
  assert.match(
    typeFirstUnread.invitation_received.navigateTo,
    /\/teams\/my-teams\?tab=invitations&highlight=99/,
  );
});
