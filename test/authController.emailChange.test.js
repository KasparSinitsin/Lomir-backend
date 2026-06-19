const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../src/controllers/authController");
const userModel = require("../src/models/userModel");
const emailService = require("../src/services/emailService");
const db = require("../src/config/database");

const originalDbQuery = db.query;
const originalVerifyPassword = userModel.verifyPassword;
const originalSendEmailChangeVerificationEmail =
  emailService.sendEmailChangeVerificationEmail;
const originalConsoleError = console.error;

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

const createAuthenticatedRequest = (body = {}) => ({
  user: { id: 7 },
  body,
  query: {},
});

test.afterEach(() => {
  db.query = originalDbQuery;
  userModel.verifyPassword = originalVerifyPassword;
  emailService.sendEmailChangeVerificationEmail =
    originalSendEmailChangeVerificationEmail;
  console.error = originalConsoleError;
});

test("changeEmail stores a pending email and sends a verification email", async () => {
  const calls = [];
  let sentEmail = null;

  db.query = async (sql, params = []) => {
    const query = String(sql);
    calls.push({ sql: query, params });

    if (query.includes("SELECT id, username, password_hash, email FROM users")) {
      return {
        rows: [
          {
            id: 7,
            username: "janedoe",
            email: "old@example.com",
            password_hash: "stored-hash",
          },
        ],
      };
    }

    if (
      query.includes("FROM users") &&
      query.includes("LOWER(email) = LOWER($1)") &&
      query.includes("pending_email")
    ) {
      return { rows: [] };
    }

    if (
      query.includes("UPDATE users") &&
      query.includes("pending_email = $1") &&
      query.includes("email_change_token = $2")
    ) {
      assert.equal(params[0], "new@example.com");
      assert.match(params[1], /^[a-f0-9]{64}$/);
      assert.ok(params[2] instanceof Date);
      assert.equal(params[3], 7);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL in changeEmail test: ${query}`);
  };

  userModel.verifyPassword = async (password, hash) => {
    assert.equal(password, "secret123");
    assert.equal(hash, "stored-hash");
    return true;
  };

  emailService.sendEmailChangeVerificationEmail = async (
    email,
    token,
    username,
  ) => {
    sentEmail = { email, token, username };
    return { success: true, messageId: "mail-123" };
  };

  const req = createAuthenticatedRequest({
    new_email: "new@example.com",
    current_password: "secret123",
  });
  const res = createResponse();

  await authController.changeEmail(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.pendingEmail, "new@example.com");
  assert.equal(sentEmail.email, "new@example.com");
  assert.match(sentEmail.token, /^[a-f0-9]{64}$/);
  assert.equal(sentEmail.username, "janedoe");
  assert.equal(
    calls.some(({ sql }) => sql.includes("SET email = $1")),
    false,
  );
});

test("changeEmail rejects an incorrect current password", async () => {
  db.query = async (sql) => {
    const query = String(sql);

    if (query.includes("SELECT id, username, password_hash, email FROM users")) {
      return {
        rows: [
          {
            id: 7,
            username: "janedoe",
            email: "old@example.com",
            password_hash: "stored-hash",
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in wrong-password test: ${query}`);
  };

  userModel.verifyPassword = async () => false;
  emailService.sendEmailChangeVerificationEmail = async () => {
    throw new Error("email should not be sent when password is wrong");
  };

  const req = createAuthenticatedRequest({
    new_email: "new@example.com",
    current_password: "wrong-password",
  });
  const res = createResponse();

  await authController.changeEmail(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /current password is incorrect/i);
});

test("verifyEmailChange promotes the pending email and clears the token", async () => {
  let updateCall = null;

  db.query = async (sql, params = []) => {
    const query = String(sql);

    if (
      query.includes("WHERE email_change_token = $1") &&
      query.includes("pending_email IS NOT NULL")
    ) {
      assert.equal(params[0], "valid-token");
      return {
        rows: [
          {
            id: 7,
            username: "janedoe",
            email: "old@example.com",
            pending_email: "new@example.com",
          },
        ],
      };
    }

    if (
      query.includes("FROM users") &&
      query.includes("LOWER(email) = LOWER($1)") &&
      query.includes("id != $2")
    ) {
      assert.deepEqual(params, ["new@example.com", 7]);
      return { rows: [] };
    }

    if (
      query.includes("UPDATE users") &&
      query.includes("SET email = pending_email")
    ) {
      updateCall = { sql: query, params };
      return {
        rows: [
          {
            id: 7,
            username: "janedoe",
            email: "new@example.com",
          },
        ],
      };
    }

    throw new Error(`Unexpected SQL in verifyEmailChange test: ${query}`);
  };

  const req = { query: { token: "valid-token" } };
  const res = createResponse();

  await authController.verifyEmailChange(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.email, "new@example.com");
  assert.ok(updateCall);
  assert.match(updateCall.sql, /pending_email = NULL/);
  assert.match(updateCall.sql, /email_change_token = NULL/);
  assert.match(updateCall.sql, /email_verified = TRUE/);
});

test("verifyEmailChange rejects invalid or expired tokens", async () => {
  db.query = async (sql, params = []) => {
    const query = String(sql);

    if (query.includes("WHERE email_change_token = $1")) {
      assert.equal(params[0], "expired-token");
      return { rows: [] };
    }

    throw new Error(`Unexpected SQL in expired token test: ${query}`);
  };

  const req = { query: { token: "expired-token" } };
  const res = createResponse();

  await authController.verifyEmailChange(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /invalid or expired/i);
});
