/**
 * `npm run demo-db` — builds a NEW, LOCAL Lomir database with everything needed to try the app:
 *
 *   1. the structure (scripts/demo/schema.sql),
 *   2. the focus area taxonomy and the 30 badges (scripts/demo/reference/*.json),
 *   3. the German names of the focus areas (scripts/import-tag-translations.js),
 *   4. an INVENTED world: people, teams in different states, roles, applications and invitations,
 *      badge awards, chat messages, notifications (scripts/demo/data/demoData.js and demoChat.js).
 *
 * `npm run demo-db -- --empty` stops after step 3: the structure and the reference data, no people.
 *
 * Everything written comes from this repository. Nothing is read from, or copied out of, any other
 * database, and every address is on example.com. The password of all demo accounts is printed at the end.
 *
 * 🔴 It refuses to run unless the database is LOCAL and EMPTY (scripts/demo/guard.js).
 * The `DATABASE_URL` of a live setup fails the first check; a tunnel to a live database fails
 * the second. There is no flag that turns the checks off.
 *
 * Run it from the repository root: the connection comes from `.env` / `DATABASE_URL`.
 */
require("dotenv").config();

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const bcrypt = require("bcrypt");
const { Client } = require("pg");
const { assertLocalTarget, assertNoTables } = require("./demo/guard");
const { DEMO_PASSWORD, users } = require("./demo/data/demoData");
const { buildDemoDatabase } = require("./demo/buildDemoDatabase");

const withPeople = !process.argv.includes("--empty");

async function main() {
  const target = assertLocalTarget(process.env.DATABASE_URL);
  console.log(`Target: database "${target.database}" on ${target.host}:${target.port} (local)`);

  const passwordHash = withPeople ? await bcrypt.hash(DEMO_PASSWORD, 10) : null;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let counts;
  try {
    await assertNoTables(client);
    await client.query("BEGIN");
    counts = await buildDemoDatabase(client, { passwordHash, withPeople });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  console.log(withPeople ? "Structure, reference data and the demo world are in." : "Structure and reference data are in.");

  // The German names: the existing import script, which checks the file strictly.
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "import-tag-translations.js"), "--apply"],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) {
    throw new Error("The German tag names could not be imported (see the output above).");
  }

  const check = new Client({ connectionString: process.env.DATABASE_URL });
  await check.connect();
  try {
    const { rows } = await check.query(`
      SELECT (SELECT count(*) FROM tags) AS tags,
             (SELECT count(*) FROM badges) AS badges,
             (SELECT count(*) FROM tag_translations) AS tag_translations`);
    console.log("\nReference data:", rows[0]);
  } finally {
    await check.end();
  }

  if (withPeople) {
    console.log("\nWritten:", counts);
    console.log("\nTry it: npm run dev (backend) and npm run dev in the frontend repository.");
    console.log(`Log in with demo.${users[0].key}@example.com and the password ${DEMO_PASSWORD}`);
    console.log("(the same password for every demo account: demo.<name>@example.com)");
  } else {
    console.log("\nNo people were created (--empty).");
  }
}

main().catch((error) => {
  console.error(`\ndemo-db stopped: ${error.message}`);
  process.exit(1);
});
