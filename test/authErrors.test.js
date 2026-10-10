const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { AUTH_ERROR_CODES } = require("../src/config/authErrors");
const authController = require("../src/controllers/authController");
const userModel = require("../src/models/userModel");

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const sources = {
  auth: read("src/controllers/authController.js"),
  deletion: read("src/controllers/userDeletionController.js"),
  limiter: read("src/middlewares/rateLimiter.js"),
};
const allSource = Object.values(sources).join("\n");

const originalFindByEmail = userModel.findByEmail;
const originalFindByUsername = userModel.findByUsername;
const originalVerifyPassword = userModel.verifyPassword;
const originalTurnstileSecret = process.env.TURNSTILE_SECRET_KEY;

test.afterEach(() => {
  userModel.findByEmail = originalFindByEmail;
  userModel.findByUsername = originalFindByUsername;
  userModel.verifyPassword = originalVerifyPassword;
  if (originalTurnstileSecret === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = originalTurnstileSecret;
  }
});

// Shaped like a real login, so the input validation passes and the credentials are checked.
const loginRequest = () => ({
  body: { email: "jane@example.com", password: "secret123" },
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

test("every auth error code is SCREAMING_SNAKE and equals its key", () => {
  for (const [key, value] of Object.entries(AUTH_ERROR_CODES)) {
    assert.equal(value, key);
    assert.match(value, /^[A-Z]+(_[A-Z]+)*$/);
  }
});

test("no auth error code is dead: each is attached to a response or a limiter", () => {
  for (const code of Object.keys(AUTH_ERROR_CODES)) {
    assert.ok(
      allSource.includes(`AUTH_ERROR_CODES.${code}`),
      `${code} is never used`,
    );
  }
});

test("a code is always sent beside the prose message, never instead of it", () => {
  const attached = sources.auth.match(/code: AUTH_ERROR_CODES\.[A-Z_]+,/g) || [];
  const withMessage =
    sources.auth.match(/code: AUTH_ERROR_CODES\.[A-Z_]+,\n\s*message:/g) || [];
  assert.ok(attached.length >= 19);
  assert.equal(withMessage.length, attached.length);

  const deletion =
    sources.deletion.match(
      /code: AUTH_ERROR_CODES\.PASSWORD_INCORRECT,\n\s*message: "Password is incorrect"/g,
    ) || [];
  assert.equal(deletion.length, 2, "both deletion password checks");
});

test("the three account limiters answer with the rate limit code", () => {
  const matches = sources.limiter.match(/code: AUTH_ERROR_CODES\.RATE_LIMITED,/g) || [];
  assert.equal(matches.length, 3);
});

test("an unknown email and a wrong password get the same code, status and message", async () => {
  userModel.findByEmail = async () => null;
  const unknown = createResponse();
  await authController.login(loginRequest(), unknown);

  userModel.findByEmail = async () => ({
    id: 1,
    email: "a@example.com",
    password_hash: "h",
    email_verified: true,
  });
  userModel.verifyPassword = async () => false;
  const wrong = createResponse();
  await authController.login(loginRequest(), wrong);

  assert.equal(unknown.body.code, "INVALID_CREDENTIALS");
  assert.deepEqual(wrong.body, unknown.body);
  assert.equal(wrong.statusCode, unknown.statusCode);
});

test("EMAIL_NOT_VERIFIED is answered only after the password matched", async () => {
  userModel.findByEmail = async () => ({
    id: 1,
    email: "a@example.com",
    password_hash: "h",
    email_verified: false,
  });

  userModel.verifyPassword = async () => false;
  const stranger = createResponse();
  await authController.login(loginRequest(), stranger);
  assert.equal(stranger.body.code, "INVALID_CREDENTIALS");

  userModel.verifyPassword = async () => true;
  const owner = createResponse();
  await authController.login(loginRequest(), owner);
  assert.equal(owner.statusCode, 403);
  assert.equal(owner.body.code, "EMAIL_NOT_VERIFIED");
});

test("registration with a taken username answers USERNAME_TAKEN", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  userModel.findByEmail = async () => null;
  userModel.findByUsername = async () => ({ id: 9 });
  const res = createResponse();
  await authController.register(
    {
      body: {
        username: "janedoe",
        email: "jane@example.com",
        password: "secret123",
        acceptedTerms: true,
        acceptedPrivacy: true,
        confirmedAge16: true,
      },
    },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "USERNAME_TAKEN");
  assert.equal(res.body.message, "User with this username already exists");
});
