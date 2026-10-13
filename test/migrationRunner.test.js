const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The runner is exercised with its first two migrations replaced by stubs, so no
// database is touched. The point: a failing migration must reach the caller
// (`migrate.js` turns that into "Migration failed" and exit code 1), and the
// list must stop there. Until 2026-10-11 the runner's catch swallowed the error.

const migrationsDir = path.join(__dirname, "../src/database/migrations");
const resolveMigration = (name) => require.resolve(path.join(migrationsDir, name));

const stub = (file, fn) => {
  const resolved = resolveMigration(file);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: fn,
    children: [],
    paths: [],
  };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
};

const loadRunner = () => {
  const indexPath = resolveMigration("index.js");
  delete require.cache[indexPath];
  return { runMigrations: require(indexPath), indexPath };
};

test("a failing migration reaches the caller and stops the list", async () => {
  const calls = [];
  const restore = [
    stub("fix_messages_timestamps.js", async () => {
      calls.push("first");
      throw new Error("boom");
    }),
    stub("create_message_reads.js", async () => {
      calls.push("second");
    }),
  ];
  const { runMigrations, indexPath } = loadRunner();
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));

  try {
    await assert.rejects(() => runMigrations(), /boom/);
  } finally {
    console.error = originalError;
    delete require.cache[indexPath];
    restore.forEach((undo) => undo());
  }

  assert.deepEqual(calls, ["first"], "the list must stop at the first failure");
  assert.ok(
    logged.some((line) => line.includes("Error running migrations")),
    "the failure is still logged",
  );
});

test("scripts/migrate.js turns a failed run into a message and exit code 1", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/migrate.js"), "utf8");
  assert.match(source, /Migration failed/);
  assert.match(source, /process\.exit\(1\)/);
  // The success line must come only after the awaited run.
  assert.ok(
    source.indexOf("await runMigrations()") <
      source.indexOf("Migration completed successfully"),
  );
});
