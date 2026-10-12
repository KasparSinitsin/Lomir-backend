// The ImageKit deletion queue (STATUS item 59). Mocks only: the SQL itself is
// checked on a throwaway postgres with the real schema
// (deletion-audit/fixtures/85-pending-file-deletions-verify.cjs).

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const imagekitUtils = require("../src/utils/imagekitUtils");
const {
  FILE_DELETION_SOURCE,
  queueFiles,
  queueMessageAttachments,
  processFileDeletions,
} = require("../src/utils/fileDeletionQueue");

const originalQuery = db.query;
const originalDelete = imagekitUtils.deleteImageKitFileWithResult;
const originalFetch = global.fetch;

// Nothing here may reach ImageKit (the local .env holds real keys).
test.beforeEach(() => {
  global.fetch = async () => {
    throw new Error("network call in a queue test");
  };
  imagekitUtils.deleteImageKitFileWithResult = async () => {
    throw new Error("ImageKit stub missing");
  };
});

test.afterEach(() => {
  db.query = originalQuery;
});

test.after(() => {
  imagekitUtils.deleteImageKitFileWithResult = originalDelete;
  global.fetch = originalFetch;
});

const recordingClient = (respond) => {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return respond(sql, params);
    },
  };
};

test("queueFiles keeps file ids and ImageKit URLs and drops everything else", async () => {
  const client = recordingClient(() => ({ rows: [{ id: "41" }, { id: "42" }] }));
  const ids = await queueFiles(
    client,
    [
      { url: "https://ik.imagekit.io/demo123/lomir/avatars/a_1.png" },
      { url: "https://example.com/elsewhere.png" },
      { url: null, fileId: "file-9" },
      null,
      { url: null, fileId: null },
    ],
    FILE_DELETION_SOURCE.ACCOUNT_DELETION,
  );

  assert.deepEqual(ids, [41, 42]);
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /INSERT INTO pending_file_deletions \(file_url, file_id, source\)/);
  assert.deepEqual(client.calls[0].params, [
    ["https://ik.imagekit.io/demo123/lomir/avatars/a_1.png", null],
    [null, "file-9"],
    ["account_deletion", "account_deletion"],
  ]);
});

test("queueFiles with nothing deletable sends no query", async () => {
  const client = recordingClient(() => {
    throw new Error("no query expected");
  });
  assert.deepEqual(
    await queueFiles(client, [{ url: "https://example.com/x.png" }], "account_deletion"),
    [],
  );
});

test("queueMessageAttachments queues image AND file, ImageKit only, with the caller's condition", async () => {
  const client = recordingClient(() => ({ rows: [{ id: 7 }] }));
  const ids = await queueMessageAttachments(
    client,
    { where: "m.team_id = $1", params: [12] },
    FILE_DELETION_SOURCE.TEAM_DELETION,
  );

  assert.deepEqual(ids, [7]);
  const { sql, params } = client.calls[0];
  assert.match(sql, /VALUES \(m\.image_url\), \(m\.file_url\)/);
  assert.match(sql, /WHERE \(m\.team_id = \$1\)/);
  assert.match(sql, /position\(\$2::text IN attachment\.url\) > 0/);
  assert.match(sql, /SELECT DISTINCT attachment\.url, \$3::text/);
  assert.deepEqual(params, [12, "ik.imagekit.io", "team_deletion"]);
});

test("processFileDeletions removes settled files and counts a failure on the rest", async () => {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*SELECT/.test(sql)) {
      return {
        rows: [
          { id: 1, file_url: "https://ik.imagekit.io/x/lomir/chat-files/a.pdf", file_id: null },
          { id: 2, file_url: null, file_id: "file-2" },
          { id: 3, file_url: "https://ik.imagekit.io/x/lomir/chat-images/b.jpg", file_id: null },
          { id: 4, file_url: "https://ik.imagekit.io/x/lomir/chat-images/c.jpg", file_id: null },
        ],
      };
    }
    return { rows: [], rowCount: 1 };
  };
  const results = {
    1: { result: imagekitUtils.DELETION_RESULT.DELETED },
    2: { result: imagekitUtils.DELETION_RESULT.NOT_FOUND },
    3: { result: imagekitUtils.DELETION_RESULT.FAILED, error: "search API status 503" },
    4: { result: imagekitUtils.DELETION_RESULT.SKIPPED },
  };
  const seen = [];
  const rowByReference = {
    "https://ik.imagekit.io/x/lomir/chat-files/a.pdf": 1,
    "file-2": 2,
    "https://ik.imagekit.io/x/lomir/chat-images/b.jpg": 3,
    "https://ik.imagekit.io/x/lomir/chat-images/c.jpg": 4,
  };
  imagekitUtils.deleteImageKitFileWithResult = async (url, fileId) => {
    const row = rowByReference[fileId || url];
    seen.push(row);
    return results[row];
  };

  const stats = await processFileDeletions({ ids: [1, 2, 3, 4] });

  assert.deepEqual(stats, { processed: 4, settled: 3, failed: 1 });
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.match(calls[0].sql, /WHERE id = ANY\(\$1::bigint\[\]\)/);
  assert.deepEqual(calls[0].params, [[1, 2, 3, 4]]);
  const deletes = calls.filter((c) => /DELETE FROM pending_file_deletions/.test(c.sql));
  assert.deepEqual(deletes.map((c) => c.params[0]), [1, 2, 4]);
  const updates = calls.filter((c) => /UPDATE pending_file_deletions/.test(c.sql));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [3, "search API status 503"]);
  assert.match(updates[0].sql, /attempts = attempts \+ 1/);
});

test("without ids it takes the fewest attempts first, oldest first, up to the limit", async () => {
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  };

  assert.deepEqual(await processFileDeletions({ limit: 25 }), {
    processed: 0,
    settled: 0,
    failed: 0,
  });
  assert.match(calls[0].sql, /ORDER BY attempts ASC, id ASC\s+LIMIT \$1/);
  assert.deepEqual(calls[0].params, [25]);
});

test("an empty id list sends no query at all", async () => {
  db.query = async () => {
    throw new Error("no query expected");
  };
  assert.deepEqual(await processFileDeletions({ ids: [] }), {
    processed: 0,
    settled: 0,
    failed: 0,
  });
});

test("a database error while recording one outcome counts as failed and does not stop the run", async () => {
  db.query = async (sql) => {
    if (/^\s*SELECT/.test(sql)) {
      return { rows: [{ id: 1, file_url: null, file_id: "f1" }, { id: 2, file_url: null, file_id: "f2" }] };
    }
    if (/DELETE FROM pending_file_deletions/.test(sql)) {
      throw new Error("connection reset");
    }
    return { rows: [] };
  };
  imagekitUtils.deleteImageKitFileWithResult = async () => ({
    result: imagekitUtils.DELETION_RESULT.DELETED,
  });

  assert.deepEqual(await processFileDeletions({ ids: [1, 2] }), {
    processed: 2,
    settled: 0,
    failed: 2,
  });
});
