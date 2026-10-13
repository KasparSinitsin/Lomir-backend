const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../src/controllers/authController");
const userModel = require("../src/models/userModel");

/**
 * The account's UI language has to come back from the two endpoints that
 * establish a session, or it never reaches the app at all.
 *
 * `userModel`'s field lists select `preferred_language` for both paths
 * (AUTH_USER_FIELDS, CURRENT_USER_FIELDS). The controllers then build their
 * response objects by hand from a picked list of columns - and that list had
 * `country` but not the language, so the value was fetched and dropped.
 *
 * The symptom was subtle because the frontend mirrors the language into
 * localStorage when you change it: the setting appeared to work for the rest
 * of that session, and only stopped applying after a sign-out. That mirror was
 * also leaking one account's language to the next user of the same browser,
 * and closing the leak is what exposed this.
 */

const originalFindByEmail = userModel.findByEmail;
const originalVerifyPassword = userModel.verifyPassword;
const originalFindById = userModel.findById;
const originalJwtSecret = process.env.JWT_SECRET;

const createResponse = () => ({
  statusCode: 200,
  body: null,
  // login issues an httpOnly session cookie on the way out.
  cookies: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  cookie(name, value, options) {
    this.cookies[name] = { value, options };
    return this;
  },
});

test.afterEach(() => {
  userModel.findByEmail = originalFindByEmail;
  userModel.verifyPassword = originalVerifyPassword;
  userModel.findById = originalFindById;
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

const accountRow = (overrides = {}) => ({
  id: 138,
  username: "danielwhite",
  email: "daniel@example.com",
  password_hash: "hashed",
  email_verified: true,
  first_name: "Daniel",
  last_name: "White",
  bio: null,
  postal_code: null,
  city: null,
  country: "GB",
  preferred_language: "de",
  avatar_url: null,
  is_public: true,
  is_synthetic: false,
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("login returns the account's preferred_language", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  userModel.findByEmail = async () => accountRow();
  userModel.verifyPassword = async () => true;

  const res = createResponse();
  await authController.login(
    { body: { email: "daniel@example.com", password: "secret123" } },
    res,
  );

  assert.equal(res.statusCode, 200);
  // Fails against the unfixed controller: the field was never copied across.
  assert.equal(res.body.data.user.preferred_language, "de");
  // The country has to survive alongside it - it is step 3 of the precedence
  // chain and the fallback when no language was ever chosen.
  assert.equal(res.body.data.user.country, "GB");
});

test("getCurrentUser returns the account's preferred_language", async () => {
  userModel.findById = async () => accountRow();

  const res = createResponse();
  await authController.getCurrentUser({ user: { id: 138 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.user.preferred_language, "de");
  assert.equal(res.body.data.user.country, "GB");
});

test("an account that never chose a language reports null, not undefined", async () => {
  userModel.findById = async () => accountRow({ preferred_language: null });

  const res = createResponse();
  await authController.getCurrentUser({ user: { id: 138 } }, res);

  assert.equal(res.statusCode, 200);
  // The distinction matters to the frontend: `resolveLanguage` treats any
  // unsupported value as "no explicit choice" and falls through to the
  // country rule, so null and undefined behave alike there - but a key that
  // is simply absent from the payload is indistinguishable from this bug.
  assert.ok("preferred_language" in res.body.data.user);
  assert.equal(res.body.data.user.preferred_language, null);
});
