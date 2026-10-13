const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../src/controllers/authController");
const userModel = require("../src/models/userModel");
const db = require("../src/config/database");
const fixTokenExpiryTimestamps = require("../src/database/migrations/fix_token_expiry_timestamps");

const originalDbQuery = db.query;
const originalHashPassword = userModel.hashPassword;
const originalConsoleWarn = console.warn;
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

test.afterEach(() => {
  db.query = originalDbQuery;
  userModel.hashPassword = originalHashPassword;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// The columns held a wall clock with the offset thrown away, so the token's
// lifetime followed the backend process's timezone: three hours on a CEST
// backend, and already expired when issued west of UTC.
test("the migration reads an existing naive value as UTC", async () => {
  const statements = [];
  db.query = async (sql, params = []) => {
    const query = String(sql);
    statements.push(query);
    if (query.includes("information_schema")) {
      return {
        rows: [
          { column_name: "password_reset_expires", data_type: "timestamp without time zone" },
          { column_name: "verification_token_expires", data_type: "timestamp without time zone" },
        ],
      };
    }
    return { rows: [] };
  };

  await fixTokenExpiryTimestamps();

  // Both columns in one ALTER TABLE, so the table is rewritten once.
  const alters = statements.filter((s) => s.includes("ALTER TABLE users"));
  assert.equal(alters.length, 1);
  for (const column of [
    "password_reset_expires",
    "verification_token_expires",
  ]) {
    assert.match(alters[0], new RegExp(`ALTER COLUMN ${column} TYPE TIMESTAMPTZ`));
    assert.match(alters[0], new RegExp(`USING ${column} AT TIME ZONE 'UTC'`));
  }
});

test("the migration leaves an already-converted column alone", async () => {
  const statements = [];
  db.query = async (sql) => {
    const query = String(sql);
    statements.push(query);
    if (query.includes("information_schema")) {
      return {
        rows: [
          { column_name: "password_reset_expires", data_type: "timestamp with time zone" },
          { column_name: "verification_token_expires", data_type: "timestamp with time zone" },
        ],
      };
    }
    return { rows: [] };
  };

  await fixTokenExpiryTimestamps();

  // `x AT TIME ZONE 'UTC'` on a value that is already TIMESTAMPTZ hands back a
  // naive wall clock, which the session timezone would then shift again. A
  // second run has to be a no-op, not a second conversion.
  assert.equal(
    statements.filter((s) => s.includes("ALTER TABLE users")).length,
    0,
  );
});

test("a rejected reset says the same thing to the client either way", async () => {
  const bodies = [];

  for (const rows of [[], [{ id: 9, password_reset_expires: new Date() }]]) {
    db.query = async (sql) => {
      const query = String(sql);
      if (query.includes("password_reset_expires > NOW()")) {
        return { rows: [] };
      }
      return { rows };
    };
    console.warn = () => {};

    const res = createResponse();
    await authController.resetPassword(
      { body: { token: "abc", password: "supersecret1" } },
      res,
    );
    bodies.push({ statusCode: res.statusCode, body: res.body });
  }

  // Distinguishing them here would confirm which reset links exist.
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].statusCode, 400);
  assert.equal(bodies[0].body.message, "Invalid or expired reset token");
});

test("the server log distinguishes an unknown token from an expired one", async () => {
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));

  db.query = async () => ({ rows: [] });
  await authController.resetPassword(
    { body: { token: "stale", password: "supersecret1" } },
    createResponse(),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not found/);

  warnings.length = 0;
  const expiredAt = new Date("2026-09-27T15:42:28.000Z");
  db.query = async (sql) => {
    if (String(sql).includes("password_reset_expires > NOW()")) {
      return { rows: [] };
    }
    return { rows: [{ id: 331, password_reset_expires: expiredAt }] };
  };
  await authController.resetPassword(
    { body: { token: "expired", password: "supersecret1" } },
    createResponse(),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /expired at 2026-09-27T15:42:28\.000Z/);
  assert.match(warnings[0], /user 331/);
  // The token itself never reaches the log.
  assert.doesNotMatch(warnings[0], /expired"|\bexpired\b.*token=|stale/);
});

test("a valid reset token still resets the password", async () => {
  let updated = null;
  db.query = async (sql, params = []) => {
    const query = String(sql);
    if (query.includes("password_reset_expires > NOW()")) {
      return { rows: [{ id: 331, username: "julia" }] };
    }
    if (query.includes("SET password_hash")) {
      updated = { query, params };
      return { rows: [] };
    }
    return { rows: [] };
  };
  userModel.hashPassword = async () => "hashed";

  const res = createResponse();
  await authController.resetPassword(
    { body: { token: "good", password: "supersecret1" } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.ok(updated, "the password was not written");
  assert.match(updated.query, /password_reset_expires = NULL/);
});
