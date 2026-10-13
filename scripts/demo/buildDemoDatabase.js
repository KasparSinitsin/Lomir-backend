const fs = require("node:fs");
const path = require("node:path");
const { createContext } = require("./seed/seedContext");
const { seedPeople } = require("./seed/seedPeople");
const { seedTeams } = require("./seed/seedTeams");
const { seedBadges } = require("./seed/seedBadges");
const { seedChat } = require("./seed/seedChat");
const { seedNotifications } = require("./seed/seedNotifications");

const DATABASE_DIR = __dirname;
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

const REFRESH_BADGE_TOTALS = "REFRESH MATERIALIZED VIEW public.v_user_badges_with_category_totals";

/**
 * Builds the whole demo database inside the transaction the caller has opened:
 * the structure, the focus areas and badges and, unless `withPeople` is false, the invented world.
 * It writes only what is in this repository; it reads nothing from the database it writes to.
 * The caller checks that the target is local and empty first (guard.js).
 */
async function buildDemoDatabase(client, { passwordHash, withPeople = true }) {
  const taxonomy = JSON.parse(read("reference", "taxonomy.json"));
  const { badges } = JSON.parse(read("reference", "badges.json"));

  await client.query(read("schema.sql"));
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

  const ctx = createContext(client);
  if (withPeople) {
    await seedPeople(ctx, { passwordHash });
    await seedTeams(ctx);
    await seedBadges(ctx);
    await seedChat(ctx);
    await seedNotifications(ctx);
  }
  // Created empty by the structure; the app refreshes it with every award. Fill it so it can be read.
  await client.query(REFRESH_BADGE_TOTALS);
  return ctx.counts;
}

module.exports = { buildDemoDatabase };
