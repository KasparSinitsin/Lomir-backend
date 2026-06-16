const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../src/controllers/authController");
const userModel = require("../src/models/userModel");
const emailService = require("../src/services/emailService");
const db = require("../src/config/database");

const originalFindByEmail = userModel.findByEmail;
const originalFindByUsername = userModel.findByUsername;
const originalVerifyPassword = userModel.verifyPassword;
const originalCreateUser = userModel.createUser;
const originalSendVerificationEmail = emailService.sendVerificationEmail;
const originalDbQuery = db.query;
const originalTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;
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

const createLoginRequest = (overrides = {}) => ({
  body: {
    email: "jane@example.com",
    password: "secret123",
    ...overrides,
  },
});

const createRegisterRequest = (overrides = {}) => ({
  body: {
    username: "janedoe",
    email: "jane@example.com",
    password: "secret123",
    acceptedTerms: true,
    acceptedPrivacy: true,
    confirmedAge16: true,
    ...overrides,
  },
});

test.afterEach(() => {
  userModel.findByEmail = originalFindByEmail;
  userModel.findByUsername = originalFindByUsername;
  userModel.verifyPassword = originalVerifyPassword;
  userModel.createUser = originalCreateUser;
  emailService.sendVerificationEmail = originalSendVerificationEmail;
  db.query = originalDbQuery;
  console.error = originalConsoleError;

  if (originalTurnstileSecret === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecret;
  }
});

test("login returns a generic credential error when the email is unknown", async () => {
  userModel.findByEmail = async () => null;
  userModel.verifyPassword = async () => {
    throw new Error("verifyPassword should not be called");
  };

  const res = createResponse();

  await authController.login(createLoginRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    success: false,
    message: "Invalid email or password",
  });
});

test("login returns the same generic credential error for a wrong password", async () => {
  userModel.findByEmail = async () => ({
    id: 7,
    email: "jane@example.com",
    password_hash: "stored-hash",
    email_verified: true,
  });
  userModel.verifyPassword = async (password, hash) => {
    assert.equal(password, "secret123");
    assert.equal(hash, "stored-hash");
    return false;
  };

  const res = createResponse();

  await authController.login(createLoginRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    success: false,
    message: "Invalid email or password",
  });
});

test("login does not reveal an unverified account when the password is wrong", async () => {
  userModel.findByEmail = async () => ({
    id: 7,
    email: "jane@example.com",
    password_hash: "stored-hash",
    email_verified: false,
  });
  userModel.verifyPassword = async () => false;

  const res = createResponse();

  await authController.login(createLoginRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    success: false,
    message: "Invalid email or password",
  });
});

test("login asks for email verification only after the password is correct", async () => {
  userModel.findByEmail = async () => ({
    id: 7,
    email: "jane@example.com",
    password_hash: "stored-hash",
    email_verified: false,
  });
  userModel.verifyPassword = async () => true;

  const res = createResponse();

  await authController.login(createLoginRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.requiresVerification, true);
  assert.match(res.body.message, /verify your email/i);
});

test("register returns a generic verification response when the email cannot create a new account", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  userModel.findByEmail = async () => ({
    id: 7,
    email: "jane@example.com",
    email_verified: true,
  });
  userModel.findByUsername = async () => null;
  userModel.createUser = async () => {
    throw new Error("createUser should not be called for an existing email");
  };
  db.query = async () => {
    throw new Error("db.query should not be called for an existing email");
  };

  const res = createResponse();

  await authController.register(createRegisterRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.requiresVerification, true);
  assert.equal(res.body.data.user, undefined);
  assert.doesNotMatch(res.body.message, /already|exists|registered/i);
});

test("register returns the same generic verification response for a new account", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  userModel.findByEmail = async () => null;
  userModel.findByUsername = async () => null;
  userModel.createUser = async (userData) => {
    assert.equal(userData.email, "jane@example.com");
    return {
      id: 8,
      username: "janedoe",
      email: "jane@example.com",
      is_synthetic: false,
    };
  };
  db.query = async (sql) => {
    assert.match(String(sql), /UPDATE users/i);
    return { rows: [], rowCount: 1 };
  };
  emailService.sendVerificationEmail = async () => ({ success: true });

  const res = createResponse();

  await authController.register(createRegisterRequest(), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.requiresVerification, true);
  assert.equal(res.body.data.user, undefined);
  assert.doesNotMatch(res.body.message, /already|exists|registered/i);
});

test("resendVerification returns a generic success when the account is already verified", async () => {
  db.query = async () => ({
    rows: [
      {
        id: 7,
        username: "janedoe",
        email: "jane@example.com",
        email_verified: true,
      },
    ],
  });
  emailService.sendVerificationEmail = async () => {
    throw new Error("sendVerificationEmail should not be called");
  };

  const res = createResponse();

  await authController.resendVerification(
    { body: { email: "jane@example.com" } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.doesNotMatch(res.body.message, /already|verified|log in/i);
});

test("resendVerification returns the same generic success when the account is unknown", async () => {
  db.query = async () => ({ rows: [] });
  emailService.sendVerificationEmail = async () => {
    throw new Error("sendVerificationEmail should not be called");
  };

  const res = createResponse();

  await authController.resendVerification(
    { body: { email: "jane@example.com" } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.doesNotMatch(res.body.message, /already|verified|log in/i);
});

test("resendVerification stays generic when verification email delivery fails", async () => {
  console.error = () => {};
  db.query = async (sql) => {
    const query = String(sql);

    if (/FROM users/i.test(query)) {
      return {
        rows: [
          {
            id: 7,
            username: "janedoe",
            email: "jane@example.com",
            email_verified: false,
          },
        ],
      };
    }

    if (/UPDATE users/i.test(query)) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL: ${query}`);
  };
  emailService.sendVerificationEmail = async () => ({ success: false });

  const res = createResponse();

  await authController.resendVerification(
    { body: { email: "jane@example.com" } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.doesNotMatch(res.body.message, /failed|already|verified|log in/i);
});
