/**
 * `npm run db:setup` — builds a NEW, LOCAL Lomir database that the app can run on.
 *
 *   1. the structure (src/database/schema.sql),
 *   2. the focus area taxonomy and the 30 badges (src/database/reference/*.json),
 *   3. the German names of the focus areas (scripts/import-tag-translations.js).
 *
 * It creates no users. `npm run seed:demo` adds a small invented world on top.
 *
 * 🔴 It refuses to run unless the database is LOCAL and EMPTY (src/database/demo/guard.js).
 * The `DATABASE_URL` of a live setup fails the first check; a tunnel to a live database fails
 * the second. There is no flag that turns the checks off.
 *
 * Run it from the repository root: the connection comes from `.env` / `DATABASE_URL`.
 */
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { assertLocalTarget, assertNoTables } = require("../src/database/demo/guard");

const DATABASE_DIR = path.join(__dirname, "..", "src", "database");
const read = (...parts) => fs.readFileSync(path.join(DATABASE_DIR, ...parts), "utf8");

// Rows as one JSON parameter: no placeholder per value, and the ids stay the ones the
// German translations refer to.
const insertSupercategories = `
  INSERT INTO tag_supercategories (id, name)
  SELECT id, name FROM jsonb_to_recordset($1::jsonb) AS x(id int, name text)`;
const insertCategories = `
  INSERT INTO tag_categories (id, supercategory_id, name)
  SELECT id, supercategory_id, name
  FROM jsonb_to_recordset($1::jsonb) AS x(id int, supercategory_id int, name text)`;
const insertTags = `
  INSERT INTO tags (id, name, category, supercategory, supercategory_id, category_id, is_system, status)
  SELECT id, name, category, supercategory, supercategory_id, category_id, true, 'approved'
  FROM jsonb_to_recordset($1::jsonb)
       AS x(id int, name text, category text, supercategory text, supercategory_id int, category_id int)`;
const insertBadges = `
  INSERT INTO badges (id, name, description, category, color)
  SELECT id, name, description, category, color
  FROM jsonb_to_recordset($1::jsonb)
       AS x(id int, name text, description text, category text, color text)`;

// The ids were inserted by hand, so the counters have to be moved past them.
const TABLES_WITH_COUNTERS = ["tag_supercategories", "tag_categories", "tags", "badges"];

const withNames = (taxonomy) => {
  const superName = new Map(taxonomy.supercategories.map((s) => [s.id, s.name]));
  const category = new Map(taxonomy.categories.map((c) => [c.id, c]));
  return taxonomy.tags.map((tag) => {
    const cat = category.get(tag.category_id);
    return {
      id: tag.id,
      name: tag.name,
      category: cat.name,
      supercategory: superName.get(cat.supercategory_id),
      supercategory_id: cat.supercategory_id,
      category_id: cat.id,
    };
  });
};

async function main() {
  const target = assertLocalTarget(process.env.DATABASE_URL);
  console.log(`Target: database "${target.database}" on ${target.host}:${target.port} (local)`);

  const taxonomy = JSON.parse(read("reference", "taxonomy.json"));
  const { badges } = JSON.parse(read("reference", "badges.json"));
  const schema = read("schema.sql");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await assertNoTables(client);

    await client.query("BEGIN");
    await client.query(schema);
    // schema.sql empties the search path for its session; the rest needs it back.
    await client.query("SET search_path TO public");

    await client.query(insertSupercategories, [JSON.stringify(taxonomy.supercategories)]);
    await client.query(insertCategories, [JSON.stringify(taxonomy.categories)]);
    await client.query(insertTags, [JSON.stringify(withNames(taxonomy))]);
    await client.query(insertBadges, [JSON.stringify(badges)]);

    for (const table of TABLES_WITH_COUNTERS) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), (SELECT max(id) FROM public.${table}))`,
      );
    }
    // Created empty by the structure; the app refreshes it with every award. Fill it once so it can be read.
    await client.query("REFRESH MATERIALIZED VIEW public.v_user_badges_with_category_totals");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  console.log("Structure, taxonomy and badges are in.");

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
             (SELECT count(*) FROM tag_categories) AS categories,
             (SELECT count(*) FROM tag_supercategories) AS supercategories,
             (SELECT count(*) FROM badges) AS badges,
             (SELECT count(*) FROM tag_translations) AS tag_translations`);
    console.log("\nDone:", rows[0]);
    console.log("Next: npm run seed:demo   (a small invented world to try the app with)");
  } finally {
    await check.end();
  }
}

main().catch((error) => {
  console.error(`\ndb:setup stopped: ${error.message}`);
  process.exit(1);
});
