const test = require("node:test");
const assert = require("node:assert/strict");

const {
  describeTarget,
  isLocalTarget,
  assertLocalTarget,
  assertNoTables,
} = require("../scripts/demo/guard");

// The guard decides whether npm run demo-db may write. It must say yes only to a local database.

test("local addresses pass", () => {
  for (const url of [
    "postgresql://u:p@localhost:5432/lomir",
    "postgres://u@127.0.0.1/lomir",
    "postgresql://u@[::1]:5432/lomir",
    "postgresql://u@LOCALHOST/lomir",
    "postgresql://u@/lomir?host=/var/run/postgresql", // a Unix socket
    "postgresql://u@/lomir", // no host: the local socket
    "postgresql:///lomir",
  ]) {
    assert.equal(isLocalTarget(url), true, url);
  }
});

test("everything else is refused, including every way to smuggle in another host", () => {
  for (const url of [
    "postgresql://u:p@ep-cool-123.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    "postgresql://u@db.example.com/lomir",
    "postgresql://u@localhost/lomir?host=db.example.com", // ?host= overrides the host part
    "postgresql://u@/lomir?host=db.example.com",
    "postgresql://u@localhost/lomir?hostaddr=10.0.0.5", // ?hostaddr= too
    "postgresql://u@evil.com/x?host=localhost&hostaddr=1.2.3.4",
    "postgresql://u@a.example.com,localhost/lomir", // several hosts
    "mysql://u@localhost/lomir", // not PostgreSQL
    "not a url",
    "",
    undefined,
    null,
  ]) {
    assert.equal(isLocalTarget(url), false, String(url));
  }
});

test("the refusal never contains the password and says what to do", () => {
  assert.throws(
    () => assertLocalTarget("postgresql://user:SECRETPW@ep-x.neon.tech/neondb"),
    (error) => {
      assert.match(error.message, /not local/);
      assert.match(error.message, /LOCAL database/);
      assert.ok(!error.message.includes("SECRETPW"), "the password must not appear");
      return true;
    },
  );
  assert.equal(describeTarget("postgresql://user:SECRETPW@localhost:5433/demo").database, "demo");
  assert.ok(!JSON.stringify(describeTarget("postgresql://user:SECRETPW@localhost/demo")).includes("SECRETPW"));
});

const clientAnswering = (...answers) => {
  const queue = [...answers];
  return { query: async () => ({ rows: [queue.shift()] }) };
};

test("setup needs an empty database", async () => {
  await assert.doesNotReject(() => assertNoTables(clientAnswering({ n: 0 })));
  await assert.rejects(() => assertNoTables(clientAnswering({ n: 30 })), /already has 30 tables/);
});
