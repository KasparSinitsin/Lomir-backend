const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../src/controllers/authController");
const userModel = require("../src/models/userModel");

const originalFindByEmail = userModel.findByEmail;
const originalVerifyPassword = userModel.verifyPassword;

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

test.afterEach(() => {
  userModel.findByEmail = originalFindByEmail;
  userModel.verifyPassword = originalVerifyPassword;
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
