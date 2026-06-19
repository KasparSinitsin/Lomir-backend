const test = require("node:test");
const assert = require("node:assert/strict");

const bcrypt = require("bcrypt");
const db = require("../src/config/database");
const userModel = require("../src/models/userModel");

const originalQuery = db.query;
const originalHash = bcrypt.hash;

test.afterEach(() => {
  db.query = originalQuery;
  bcrypt.hash = originalHash;
});

test("createUser stores legal consent and age confirmation timestamps and versions", async () => {
  let capturedSql = null;
  let capturedParams = null;

  bcrypt.hash = async (password, rounds) => {
    assert.equal(password, "secret123");
    assert.equal(rounds, 10);
    return "hashed-password";
  };

  db.query = async (sql, params) => {
    capturedSql = sql;
    capturedParams = params;

    return {
      rows: [
        {
          id: 42,
          username: "legaluser",
          email: "legal@example.com",
          accepted_terms_at: new Date("2026-06-15T00:00:00.000Z"),
          accepted_privacy_at: new Date("2026-06-15T00:00:00.000Z"),
          confirmed_age_16_at: new Date("2026-06-15T00:00:00.000Z"),
          accepted_terms_version: "2026-06-15",
          accepted_privacy_version: "2026-06-15",
          confirmed_age_16_version: "2026-06-15",
        },
      ],
    };
  };

  const created = await userModel.createUser({
    username: "legaluser",
    email: "legal@example.com",
    password: "secret123",
    accepted_terms_version: "2026-06-15",
    accepted_privacy_version: "2026-06-15",
    confirmed_age_16_version: "2026-06-15",
  });

  assert.match(capturedSql, /accepted_terms_at/);
  assert.match(capturedSql, /accepted_privacy_at/);
  assert.match(capturedSql, /confirmed_age_16_at/);
  assert.match(capturedSql, /accepted_terms_version/);
  assert.match(capturedSql, /accepted_privacy_version/);
  assert.match(capturedSql, /confirmed_age_16_version/);
  assert.match(
    capturedSql,
    /confirmed_age_16_at,\s*accepted_terms_version,\s*accepted_privacy_version,\s*confirmed_age_16_version/,
  );
  assert.equal(capturedParams.length, 17);
  assert.equal(capturedParams[14], "2026-06-15");
  assert.equal(capturedParams[15], "2026-06-15");
  assert.equal(capturedParams[16], "2026-06-15");
  assert.equal(created.accepted_terms_version, "2026-06-15");
  assert.equal(created.accepted_privacy_version, "2026-06-15");
  assert.equal(created.confirmed_age_16_version, "2026-06-15");
});
