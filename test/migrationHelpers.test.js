const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../src/config/database");
const {
  convertColumnsToTimestamptz,
} = require("../src/database/migrations/_helpers");
const fixMessagesTimestamps = require("../src/database/migrations/fix_messages_timestamps");

const originalQuery = db.query;
const originalConsoleLog = console.log;

// Returns the statements the helper issued, with information_schema answering
// the types given per column. A column left out of `types` does not exist.
function run(fn, types) {
  const statements = [];
  db.query = async (sql) => {
    const query = String(sql);
    statements.push(query);
    if (query.includes("information_schema")) {
      return {
        rows: Object.entries(types).map(([column_name, data_type]) => ({
          column_name,
          data_type,
        })),
      };
    }
    return { rows: [] };
  };
  console.log = () => {};
  return fn().then(
    (result) => ({ statements, result }),
    (error) => {
      throw error;
    },
  );
}

const NAIVE = "timestamp without time zone";
const AWARE = "timestamp with time zone";

test.afterEach(() => {
  db.query = originalQuery;
  console.log = originalConsoleLog;
});

test("only the columns that are still naive are converted", async () => {
  const { statements, result } = await run(
    () =>
      convertColumnsToTimestamptz("messages", [
        "sent_at",
        "read_at",
        "deleted_at",
      ]),
    { sent_at: NAIVE, read_at: AWARE },
  );

  assert.deepEqual(result.converted, ["sent_at"]);
  assert.deepEqual(result.alreadyDone, ["read_at"]);
  assert.deepEqual(result.missing, ["deleted_at"]);

  const alters = statements.filter((s) => s.includes("ALTER TABLE"));
  assert.equal(alters.length, 1);
  assert.match(alters[0], /ALTER COLUMN sent_at TYPE TIMESTAMPTZ/);
  // The already-converted one must not be touched: on a TIMESTAMPTZ value
  // `AT TIME ZONE 'UTC'` strips the zone instead of attaching it, and the
  // session timezone would then shift the value on the way back in.
  assert.doesNotMatch(alters[0], /read_at/);
  assert.doesNotMatch(alters[0], /deleted_at/);
});

test("a second run is a no-op, which is the whole point", async () => {
  const { statements, result } = await run(
    () => convertColumnsToTimestamptz("messages", ["sent_at", "read_at"]),
    { sent_at: AWARE, read_at: AWARE },
  );

  assert.deepEqual(result.converted, []);
  assert.equal(statements.filter((s) => s.includes("ALTER TABLE")).length, 0);
});

test("several naive columns are converted in one ALTER TABLE", async () => {
  const { statements } = await run(
    () =>
      convertColumnsToTimestamptz("messages", ["sent_at", "read_at", "deleted_at"]),
    { sent_at: NAIVE, read_at: NAIVE, deleted_at: NAIVE },
  );

  // One statement, so the table is rewritten once rather than three times.
  const alters = statements.filter((s) => s.includes("ALTER TABLE"));
  assert.equal(alters.length, 1);
  for (const column of ["sent_at", "read_at", "deleted_at"]) {
    assert.match(alters[0], new RegExp(`USING ${column} AT TIME ZONE 'UTC'`));
  }
});

test("a missing column is skipped rather than raised", async () => {
  const { statements, result } = await run(
    () => convertColumnsToTimestamptz("messages", ["sent_at", "not_a_column"]),
    { sent_at: NAIVE },
  );

  assert.deepEqual(result.missing, ["not_a_column"]);
  assert.equal(statements.filter((s) => s.includes("ALTER TABLE")).length, 1);
});

test("an identifier that is not a plain name is refused before it becomes SQL", async () => {
  db.query = async () => {
    throw new Error("the helper must not reach the database");
  };

  for (const columns of [
    ["sent_at; DROP TABLE messages"],
    ['sent_at" '],
    ["Sent_At"],
  ]) {
    await assert.rejects(
      () => convertColumnsToTimestamptz("messages", columns),
      /unsafe identifier/,
    );
  }
  await assert.rejects(
    () => convertColumnsToTimestamptz("messages; DROP TABLE users", ["sent_at"]),
    /unsafe identifier/,
  );
});

test("the messages migration converts exactly the five chat timestamps", async () => {
  const columns = [
    "sent_at",
    "read_at",
    "file_expires_at",
    "file_deleted_at",
    "deleted_at",
  ];
  const { statements } = await run(
    fixMessagesTimestamps,
    Object.fromEntries(columns.map((c) => [c, NAIVE])),
  );

  const alters = statements.filter((s) => s.includes("ALTER TABLE messages"));
  assert.equal(alters.length, 1);
  for (const column of columns) {
    assert.match(alters[0], new RegExp(`USING ${column} AT TIME ZONE 'UTC'`));
  }
});
