const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The two entry points write to a database. The guard has to run BEFORE the first connection is made,
// and nothing may be able to switch it off.

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

for (const file of ["scripts/db-setup.js", "scripts/seed-demo.js"]) {
  test(`${file} checks the target before it connects`, () => {
    const source = read(file);
    const guard = source.indexOf("assertLocalTarget(");
    const connect = source.indexOf("new Client(");
    assert.ok(guard !== -1, "no call to assertLocalTarget");
    assert.ok(connect !== -1, "no connection found, the test needs updating");
    assert.ok(guard < connect, "the guard must come before the connection");
  });

  test(`${file} has no way to switch the checks off`, () => {
    const source = read(file);
    assert.doesNotMatch(source, /process\.argv/, "a command line flag could skip the guard");
    assert.doesNotMatch(source, /--force|--allow|--yes|FORCE|OVERRIDE/i);
  });
}

test("db:setup checks that the database is empty, the seed that it has no users", () => {
  assert.match(read("scripts/db-setup.js"), /assertNoTables\(/);
  assert.match(read("scripts/seed-demo.js"), /assertNoUsers\(/);
});

test("the npm commands point at these scripts", () => {
  const { scripts } = JSON.parse(read("package.json"));
  assert.equal(scripts["db:setup"], "node scripts/db-setup.js");
  assert.equal(scripts["seed:demo"], "node scripts/seed-demo.js");
});
