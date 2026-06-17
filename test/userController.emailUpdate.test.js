const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const userController = require("../src/controllers/userController");

const originalPoolQuery = db.pool.query;
const originalNodeEnv = process.env.NODE_ENV;

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

test.afterEach(() => {
  db.pool.query = originalPoolQuery;
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("updateUser rejects direct email updates through the profile endpoint", async () => {
  process.env.NODE_ENV = "production";
  let poolCalled = false;
  db.pool.query = async () => {
    poolCalled = true;
    throw new Error("profile email updates should be blocked before DB access");
  };

  const req = {
    params: { id: "7" },
    user: { id: 7 },
    body: { email: "new@example.com" },
  };
  const res = createResponse();

  await userController.updateUser(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /email change flow/i);
  assert.equal(poolCalled, false);
});
