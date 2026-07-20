// The frontend api.js snake_cases request bodies, and messageService sends
// startConversation / sendMessage payloads in snake_case explicitly (with
// skipRequestCaseTransform). These tests drive the controllers with the exact
// snake_case shape the frontend puts on the wire, so a camelCase-only read
// fails here instead of silently resolving to undefined in production.
// Each snake_case case is paired with a camelCase one to keep both accepted.

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const userModel = require("../src/models/userModel");
const messageController = require("../src/controllers/messageController");

const originalQuery = db.query;
const originalIsBlockedBetween = userModel.isBlockedBetween;

test.afterEach(() => {
  db.query = originalQuery;
  userModel.isBlockedBetween = originalIsBlockedBetween;
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

// --- startConversation -------------------------------------------------

const stubStartConversationQueries = (inserts) => {
  db.query = async (sql, params) => {
    if (sql.includes("SELECT id FROM users")) {
      return { rows: [{ id: 42 }] };
    }

    if (sql.includes("INSERT INTO messages")) {
      inserts.push(params);
      return { rows: [] };
    }

    return { rows: [] };
  };

  userModel.isBlockedBetween = async () => false;
};

test("startConversation accepts the snake_case body the frontend sends", async () => {
  const inserts = [];
  stubStartConversationQueries(inserts);

  const req = {
    user: { id: 10 },
    body: { recipient_id: 42, initial_message: "Hello there" },
  };
  const res = createResponse();

  await messageController.startConversation(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.conversationId, 42);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0], [10, 42, "Hello there"]);
});

test("startConversation still accepts a camelCase body", async () => {
  const inserts = [];
  stubStartConversationQueries(inserts);

  const req = {
    user: { id: 10 },
    body: { recipientId: 42, initialMessage: "Hello there" },
  };
  const res = createResponse();

  await messageController.startConversation(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.conversationId, 42);
  assert.deepEqual(inserts[0], [10, 42, "Hello there"]);
});

test("startConversation rejects a body with no recipient in either spelling", async () => {
  const inserts = [];
  stubStartConversationQueries(inserts);

  const req = { user: { id: 10 }, body: { initial_message: "Hello" } };
  const res = createResponse();

  await messageController.startConversation(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(inserts.length, 0);
});

// --- sendMessage -------------------------------------------------------

const stubTeamSendQueries = (inserts) => {
  db.query = async (sql, params) => {
    if (sql.includes("FROM team_members tm")) {
      return { rows: [{ "?column?": 1 }] };
    }

    if (sql.includes("INSERT INTO messages")) {
      inserts.push(params);
      return {
        rows: [
          {
            id: 123,
            sender_id: 10,
            team_id: 20,
            content: "See the attachment",
            reply_to_id: null,
            image_url: null,
            file_url: null,
            file_name: params[6],
            file_size: null,
            file_expires_at: null,
            sent_at: new Date("2026-07-20T10:00:00.000Z"),
          },
        ],
      };
    }

    if (sql.includes("SELECT username, first_name, last_name FROM users")) {
      return { rows: [{ username: "jane", first_name: "Jane", last_name: "Doe" }] };
    }

    if (sql.includes("SELECT COUNT(*)::int AS recipient_count")) {
      return { rows: [{ recipient_count: 1 }] };
    }

    return { rows: [] };
  };
};

const createTeamSendRequest = (body) => ({
  user: { id: 10 },
  params: { id: "20" },
  body,
  app: {
    get() {
      return {
        to() {
          return { emit() {} };
        },
      };
    },
  },
});

test("sendMessage persists file_name from a snake_case body", async () => {
  const inserts = [];
  stubTeamSendQueries(inserts);

  const res = createResponse();
  await messageController.sendMessage(
    createTeamSendRequest({
      type: "team",
      content: "See the attachment",
      file_name: "quarterly-report.pdf",
    }),
    res,
  );

  assert.equal(res.statusCode, 201);
  // INSERT params: sender, conversation, content, reply_to, image, file, file_name, ...
  assert.equal(inserts[0][6], "quarterly-report.pdf");
});

test("sendMessage still persists fileName from a camelCase body", async () => {
  const inserts = [];
  stubTeamSendQueries(inserts);

  const res = createResponse();
  await messageController.sendMessage(
    createTeamSendRequest({
      type: "team",
      content: "See the attachment",
      fileName: "quarterly-report.pdf",
    }),
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(inserts[0][6], "quarterly-report.pdf");
});

// A camelCase-only read would leave imageUrl undefined, so an image-only
// message would fail the "content, image, or file is required" check instead
// of reaching file validation. Asserting on which rejection comes back
// distinguishes the two without needing a real ImageKit URL.
const CONTENT_REQUIRED = "Message content, image, or file is required";

test("sendMessage reads image_url from a snake_case body", async () => {
  stubTeamSendQueries([]);

  const res = createResponse();
  await messageController.sendMessage(
    createTeamSendRequest({
      type: "team",
      content: "",
      image_url: "https://example.com/not-imagekit.jpg",
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.notEqual(res.body.message, CONTENT_REQUIRED);
  assert.equal(res.body.message, "Files must be uploaded through Lomir");
});

test("sendMessage reads file_url from a snake_case body", async () => {
  stubTeamSendQueries([]);

  const res = createResponse();
  await messageController.sendMessage(
    createTeamSendRequest({
      type: "team",
      content: "",
      file_url: "https://example.com/not-imagekit.pdf",
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.notEqual(res.body.message, CONTENT_REQUIRED);
  assert.equal(res.body.message, "Files must be uploaded through Lomir");
});

test("sendMessage still reads imageUrl from a camelCase body", async () => {
  stubTeamSendQueries([]);

  const res = createResponse();
  await messageController.sendMessage(
    createTeamSendRequest({
      type: "team",
      content: "",
      imageUrl: "https://example.com/not-imagekit.jpg",
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Files must be uploaded through Lomir");
});

test("sendMessage still rejects a message with no content, image, or file", async () => {
  stubTeamSendQueries([]);

  const res = createResponse();
  await messageController.sendMessage(
    createTeamSendRequest({ type: "team", content: "" }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, CONTENT_REQUIRED);
});
