const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const cleanupUnverifiedAccounts = require("../src/jobs/cleanupUnverifiedAccounts");

const { purgeExpiredUnverifiedAccounts } = cleanupUnverifiedAccounts;

const fileDeletionQueue = require("../src/utils/fileDeletionQueue");

const originalConnect = db.pool.connect;
const originalProcessSoon = fileDeletionQueue.processFileDeletionsSoon;

// The hand-over to the ImageKit deletion after the commit (item 59) queries
// the database itself, so it is recorded instead.
let handedOver = [];
test.beforeEach(() => {
  handedOver = [];
  fileDeletionQueue.processFileDeletionsSoon = (ids) => {
    handedOver.push(ids);
  };
});

test.afterEach(() => {
  db.pool.connect = originalConnect;
  fileDeletionQueue.processFileDeletionsSoon = originalProcessSoon;
});

test("purgeExpiredUnverifiedAccounts deletes expired unverified accounts", async () => {
  const calls = [];

  db.pool.connect = async () => ({
    async query(sql, params) {
      calls.push({ sql, params });

      if (sql.includes("SELECT id") && sql.includes("FROM users")) {
        return { rows: [{ id: 10 }, { id: 20 }] };
      }

      if (sql.includes("DELETE FROM users")) {
        return {
          rowCount: 2,
          rows: [
            { id: 10, created_at: "2026-06-28T08:00:00.000Z" },
            { id: 20, created_at: "2026-06-28T09:00:00.000Z" },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    },
    release() {},
  });

  const result = await purgeExpiredUnverifiedAccounts();
  const combinedSql = calls.map(({ sql }) => sql).join("\n");
  const arrayParams = calls
    .map(({ params }) => params)
    .filter((params) => Array.isArray(params));

  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.match(combinedSql, /email_verified = FALSE/);
  assert.match(combinedSql, /verification_token_expires IS NOT NULL/);
  assert.match(combinedSql, /verification_token_expires < NOW\(\) - INTERVAL/);
  assert.match(combinedSql, /UPDATE teams SET owner_id = NULL/);
  assert.match(combinedSql, /UPDATE team_vacant_roles SET created_by = NULL/);
  assert.match(combinedSql, /UPDATE team_vacant_roles SET filled_by = NULL/);
  assert.match(combinedSql, /UPDATE team_applications SET reviewed_by = NULL/);
  assert.match(combinedSql, /UPDATE user_badges SET awarded_by = NULL/);
  assert.match(combinedSql, /UPDATE tags SET created_by = NULL/);
  assert.match(combinedSql, /DELETE FROM users/);
  assert.doesNotMatch(combinedSql, /RETURNING id, email/);
  assert.ok(
    arrayParams.every((params) => params.length === 1 && params[0].length === 2),
    "expected cleanup statements to target the expired user ids",
  );
  assert.deepEqual(result, {
    deleted: 2,
    accounts: [
      { id: 10, created: "2026-06-28T08:00:00.000Z" },
      { id: 20, created: "2026-06-28T09:00:00.000Z" },
    ],
  });
});

test("purgeExpiredUnverifiedAccounts is a no-op when no accounts expired", async () => {
  const calls = [];

  db.pool.connect = async () => ({
    async query(sql) {
      calls.push(sql);

      if (sql.includes("SELECT id") && sql.includes("FROM users")) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    },
    release() {},
  });

  const result = await purgeExpiredUnverifiedAccounts();

  assert.deepEqual(result, { deleted: 0, accounts: [] });
  assert.deepEqual(calls, [
    "BEGIN",
    `
      SELECT id, avatar_url, avatar_file_id
      FROM users
      WHERE email_verified = FALSE
        AND verification_token_expires IS NOT NULL
        AND verification_token_expires < NOW() - INTERVAL '1 hours'
      `,
    "COMMIT",
  ]);
});

test("purgeExpiredUnverifiedAccounts rolls back when cleanup fails", async () => {
  const calls = [];

  db.pool.connect = async () => ({
    async query(sql) {
      calls.push(sql);

      if (sql.includes("SELECT id") && sql.includes("FROM users")) {
        return { rows: [{ id: 10 }] };
      }

      if (sql.includes("UPDATE user_badges")) {
        throw new Error("simulated foreign-key cleanup failure");
      }

      return { rows: [], rowCount: 0 };
    },
    release() {},
  });

  await assert.rejects(
    () => purgeExpiredUnverifiedAccounts(),
    /simulated foreign-key cleanup failure/,
  );

  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.includes("COMMIT"), false);
});

test("purgeExpiredUnverifiedAccounts queues the avatars of the expired accounts before deleting them", async () => {
  const calls = [];
  db.pool.connect = async () => ({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id, avatar_url, avatar_file_id") && sql.includes("FROM users")) {
        return {
          rows: [
            { id: 10, avatar_url: "https://ik.imagekit.io/demo123/lomir/avatars/a_10.png", avatar_file_id: null },
            { id: 20, avatar_url: "https://example.com/not-imagekit.png", avatar_file_id: null },
            { id: 30, avatar_url: null, avatar_file_id: null },
          ],
        };
      }
      if (sql.includes("INSERT INTO pending_file_deletions")) {
        return { rows: [{ id: 801 }] };
      }
      if (sql.includes("DELETE FROM users")) {
        return { rowCount: 3, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  });

  await purgeExpiredUnverifiedAccounts();

  const queueIndex = calls.findIndex(({ sql }) => sql.includes("INSERT INTO pending_file_deletions"));
  const deleteIndex = calls.findIndex(({ sql }) => sql.includes("DELETE FROM users"));
  const commitIndex = calls.findIndex(({ sql }) => sql === "COMMIT");
  assert.ok(queueIndex > 0 && queueIndex < deleteIndex && deleteIndex < commitIndex);
  assert.deepEqual(calls[queueIndex].params, [
    ["https://ik.imagekit.io/demo123/lomir/avatars/a_10.png"],
    [null],
    ["unverified_account"],
  ]);
  assert.deepEqual(handedOver, [[801]]);
});
