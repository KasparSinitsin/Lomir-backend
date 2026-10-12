// The 60-day chat-file cleanup and its startup run (STATUS item 59). Mocks only;
// the SQL runs on a throwaway postgres in
// deletion-audit/fixtures/85-pending-file-deletions-verify.cjs.

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const fileDeletionQueue = require("../src/utils/fileDeletionQueue");
const fileCleanup = require("../src/utils/fileCleanup");

const originalConnect = db.pool.connect;
const originalProcess = fileDeletionQueue.processFileDeletions;
const originalFetch = global.fetch;

test.beforeEach(() => {
  global.fetch = async () => {
    throw new Error("network call in a cleanup test");
  };
});

test.afterEach(() => {
  db.pool.connect = originalConnect;
  fileDeletionQueue.processFileDeletions = originalProcess;
});

test.after(() => {
  global.fetch = originalFetch;
});

const mockClient = (respond) => {
  const calls = [];
  const client = {
    released: false,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      return respond(String(sql), params);
    },
    release() {
      client.released = true;
    },
  };
  db.pool.connect = async () => client;
  return { client, calls };
};

test("expired messages: both attachments are queued, the messages cleared, then the queue is processed", async () => {
  const { client, calls } = mockClient((sql) => {
    if (/SELECT id\s+FROM messages/.test(sql)) return { rows: [{ id: 5 }, { id: 6 }] };
    if (/INSERT INTO pending_file_deletions/.test(sql)) {
      return { rows: [{ id: 11 }, { id: 12 }, { id: 13 }] };
    }
    return { rows: [] };
  });
  let processedWith = null;
  fileDeletionQueue.processFileDeletions = async (options) => {
    processedWith = options;
    return { processed: 3, settled: 2, failed: 1 };
  };

  const stats = await fileCleanup.cleanupExpiredFiles();

  const order = calls.map(({ sql }) =>
    sql === "BEGIN" || sql === "COMMIT" ? sql : sql.split(" ").slice(0, 3).join(" "),
  );
  assert.deepEqual(order, [
    "BEGIN",
    "SELECT id FROM",
    "INSERT INTO pending_file_deletions",
    "UPDATE messages SET",
    "COMMIT",
  ]);
  assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.deepEqual(calls[1].params, [100]);
  assert.match(calls[2].sql, /VALUES \(m\.image_url\), \(m\.file_url\)/);
  assert.deepEqual(calls[2].params, [[5, 6], "ik.imagekit.io", "chat_file_expiry"]);
  assert.deepEqual(calls[3].params, [[5, 6]]);
  assert.deepEqual(processedWith, { ids: [11, 12, 13] });
  assert.deepEqual(stats, { processed: 2, deleted: 2, errors: 1 });
  assert.equal(client.released, true);
});

test("nothing expired: nothing is queued or cleared", async () => {
  const { calls } = mockClient((sql) =>
    /SELECT id\s+FROM messages/.test(sql) ? { rows: [] } : { rows: [] },
  );
  fileDeletionQueue.processFileDeletions = async ({ ids }) => {
    assert.deepEqual(ids, []);
    return { processed: 0, settled: 0, failed: 0 };
  };

  assert.deepEqual(await fileCleanup.cleanupExpiredFiles(), {
    processed: 0,
    deleted: 0,
    errors: 0,
  });
  assert.deepEqual(calls.map((c) => c.sql.split(" ")[0]), ["BEGIN", "SELECT", "COMMIT"]);
});

test("a failure while queueing rolls back: the messages keep their files and nothing is deleted", async () => {
  const { client, calls } = mockClient((sql) => {
    if (/SELECT id\s+FROM messages/.test(sql)) return { rows: [{ id: 5 }] };
    if (/INSERT INTO pending_file_deletions/.test(sql)) {
      throw new Error('relation "pending_file_deletions" does not exist');
    }
    return { rows: [] };
  });
  fileDeletionQueue.processFileDeletions = async () => {
    throw new Error("must not run after a rollback");
  };

  await assert.rejects(fileCleanup.cleanupExpiredFiles(), /does not exist/);
  assert.ok(calls.some((c) => c.sql === "ROLLBACK"));
  assert.ok(!calls.some((c) => c.sql.startsWith("UPDATE messages")));
  assert.ok(!calls.some((c) => c.sql === "COMMIT"));
  assert.equal(client.released, true);
});

test("the startup run does the file cleanup and the retry, and survives a failure of either", async () => {
  // The scheduler takes both functions at require time, so they are replaced first.
  const cleanupModule = require("../src/utils/fileCleanup");
  const queueModule = require("../src/utils/fileDeletionQueue");
  const savedCleanup = cleanupModule.cleanupExpiredFiles;
  const savedProcess = queueModule.processFileDeletions;
  const schedulerPath = require.resolve("../src/jobs/fileCleanupScheduler");
  const ran = [];
  const originalError = console.error;
  console.error = () => {};

  try {
    cleanupModule.cleanupExpiredFiles = async () => {
      ran.push("cleanup");
      throw new Error("database asleep");
    };
    queueModule.processFileDeletions = async (options) => {
      ran.push(["retry", options]);
      return { processed: 0, settled: 0, failed: 0 };
    };
    delete require.cache[schedulerPath];
    const { runStartupFileCleanup } = require("../src/jobs/fileCleanupScheduler");

    await runStartupFileCleanup();
    assert.deepEqual(ran, ["cleanup", ["retry", undefined]]);

    ran.length = 0;
    cleanupModule.cleanupExpiredFiles = async () => {
      ran.push("cleanup");
    };
    queueModule.processFileDeletions = async () => {
      ran.push("retry");
      throw new Error("ImageKit down");
    };
    delete require.cache[schedulerPath];
    await require("../src/jobs/fileCleanupScheduler").runStartupFileCleanup();
    assert.deepEqual(ran, ["cleanup", "retry"]);
  } finally {
    console.error = originalError;
    cleanupModule.cleanupExpiredFiles = savedCleanup;
    queueModule.processFileDeletions = savedProcess;
    delete require.cache[schedulerPath];
  }
});
