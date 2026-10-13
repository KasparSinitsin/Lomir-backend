const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The entry point writes to a database. The guard has to run BEFORE the first connection is made,
// and nothing may be able to switch it off.

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const FILE = "scripts/demo-database.js";

test("it checks the target before it connects", () => {
  const source = read(FILE);
  const guard = source.indexOf("assertLocalTarget(");
  const connect = source.indexOf("new Client(");
  assert.ok(guard !== -1, "no call to assertLocalTarget");
  assert.ok(connect !== -1, "no connection found, the test needs updating");
  assert.ok(guard < connect, "the guard must come before the connection");
});

test("it checks that the database is empty before it writes", () => {
  const source = read(FILE);
  const check = source.indexOf("assertNoTables(");
  assert.ok(check !== -1, "no call to assertNoTables");
  assert.ok(check < source.indexOf("buildDemoDatabase(client"), "the emptiness check must come before the build");
});

test("the only option is --empty, and it only leaves the people out", () => {
  const source = read(FILE);
  const uses = source.match(/process\.argv[^;\n]*/g) || [];
  assert.deepEqual(uses, ['process.argv.includes("--empty")'], "a command line flag could skip the guard");
  assert.doesNotMatch(source, /--force|--allow|--yes|FORCE|OVERRIDE/i);
});

test("the npm command points at this script, and the old commands are gone", () => {
  const { scripts } = JSON.parse(read("package.json"));
  assert.equal(scripts["demo-db"], "node scripts/demo-database.js");
  assert.equal(scripts["db:setup"], undefined);
  assert.equal(scripts["seed:demo"], undefined);
});

test("no script in the repository changes existing rows of a database it did not build", () => {
  // The one-off backfills are gone on purpose: a public script must not rewrite real data.
  for (const file of fs.readdirSync(path.join(__dirname, "../scripts"))) {
    assert.doesNotMatch(file, /^backfill-/, `${file}: a backfill script`);
  }
});
