/**
 * `npm run seed:demo` — fills a database made by `npm run db:setup` with a small INVENTED world:
 * twelve people, four teams with an open role each, badge awards and a few chat messages.
 * Every address is on example.com; the password of all demo accounts is printed at the end.
 *
 * 🔴 It refuses to run unless the database is LOCAL and has NO USERS (src/database/demo/guard.js).
 * It only inserts. There is no flag that turns the checks off.
 *
 * Run it from the repository root: the connection comes from `.env` / `DATABASE_URL`.
 */
require("dotenv").config();

const bcrypt = require("bcrypt");
const { Client } = require("pg");
const { assertLocalTarget, assertNoUsers } = require("../src/database/demo/guard");
const { DEMO_PASSWORD, users } = require("../src/database/demo/demoData");
const { seedDemo } = require("../src/database/demo/seedDemo");

async function main() {
  const target = assertLocalTarget(process.env.DATABASE_URL);
  console.log(`Target: database "${target.database}" on ${target.host}:${target.port} (local)`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let counts;
  try {
    await assertNoUsers(client);
    await client.query("BEGIN");
    counts = await seedDemo(client, { passwordHash });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  console.log("\nWritten:", counts);
  console.log("\nTry it: npm run dev (backend) and npm run dev in the frontend repository.");
  console.log(`Log in with demo.${users[0].key}@example.com and the password ${DEMO_PASSWORD}`);
  console.log("(the same password for every demo account: demo.<name>@example.com)");
}

main().catch((error) => {
  console.error(`\nseed:demo stopped: ${error.message}`);
  process.exit(1);
});
