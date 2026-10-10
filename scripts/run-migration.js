#!/usr/bin/env node
/**
 * Runs ONE named migration, not the whole list in `src/database/migrations/index.js`.
 *
 *   node scripts/run-migration.js create_tag_category_tables           # shows what it would do
 *   node scripts/run-migration.js create_tag_category_tables --run     # really runs it
 *   npm run migrate:one -- create_tag_category_tables --run            # the same
 *
 * 🔴 **Why it exists.** Lomir has ONE database, shared by local development and the live app, and
 * `npm run migrate` runs every migration, including item 35's data migration, which the live
 * frontend cannot read yet (STATUS: "no migrate until the FE release"). The migrations below only
 * ADD tables and columns that the live code does not know, so they can go ahead of the release.
 *
 * 🟢 **Only the migrations in EARLY_SAFE can be started this way.** A held one (item 35, the
 * legacy tag merge, anything that rewrites or deletes rows) is refused. To release one more, add
 * it to the list in a reviewed change, with the reason.
 * 🟢 **Without `--run` nothing happens**: it prints the migration and the database HOST (never the
 * password) and stops. Take a backup first (`npm run backup`), and run the dry run of the
 * migration (`deletion-audit/76` for the category tables).
 * 🔴 **Order matters:** the translation tables need the category tables. The migration itself fails
 * and rolls back if they are missing.
 */

const path = require("node:path");

// Migrations that are safe to run before the frontend release, and why.
const EARLY_SAFE = {
  create_tag_category_tables:
    "adds two tables and two columns; moves the one stray tag 21 to another supercategory (a grouping only)",
  create_tag_translation_tables: "adds three EMPTY tables; needs the category tables",
};

const args = process.argv.slice(2);
const RUN = args.includes("--run");
const name = args.find((a) => !a.startsWith("--"));

const refuse = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname || "(no host)";
  } catch {
    return "(unreadable DATABASE_URL)";
  }
};

const main = async () => {
  if (!name) {
    return refuse(
      `usage: node scripts/run-migration.js <name> [--run]\nsafe to run early: ${Object.keys(EARLY_SAFE).join(", ")}`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(EARLY_SAFE, name)) {
    return refuse(
      `REFUSED: "${name}" is not on the list of migrations that may run before the release.\n` +
        `Allowed: ${Object.keys(EARLY_SAFE).join(", ")}.\n` +
        "The others wait for the frontend release (STATUS.md, header step 2).",
    );
  }

  // Required only now, so a refusal never opens a database connection.
  const db = require("../src/config/database");
  try {
    const migration = require(path.join(__dirname, "..", "src", "database", "migrations", `${name}.js`));
    console.log(`${RUN ? "RUN" : "DRY RUN (nothing happens)"} — ${name}`);
    console.log(`  what it does: ${EARLY_SAFE[name]}`);
    console.log(`  database host: ${hostOf(process.env.DATABASE_URL || "")}  (the live database, there is no other)`);
    if (!RUN) {
      console.log("\nAdd --run to execute it. Back up first (npm run backup).");
      return;
    }
    await migration();
    console.log("\nDone. Check with the dry-run query of the migration (deletion-audit/76 for the category tables).");
  } finally {
    await db.pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
