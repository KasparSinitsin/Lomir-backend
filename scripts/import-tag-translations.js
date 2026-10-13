#!/usr/bin/env node
/**
 * Imports the reviewed translations of the tag taxonomy (STATUS item 11, mechanism B).
 *
 *   node scripts/import-tag-translations.js                 # DRY RUN: only shows what it would do
 *   node scripts/import-tag-translations.js --apply         # really writes
 *   node scripts/import-tag-translations.js --lang=de       # the language (default de)
 *   node scripts/import-tag-translations.js --file=PATH     # another seed file
 *   node scripts/import-tag-translations.js --require-complete
 *                                                           # exit 1 if any tag, category or
 *                                                           # supercategory has no translation
 *                                                           # (the release gate; writes nothing)
 *
 * 🟢 **Without `--apply` nothing is written**, whatever else is given. The output is counts and
 * id numbers, no tag text.
 * 🟢 **Idempotent upsert, never deletes.** A second `--apply` changes nothing.
 * 🔴 **Refuses to write** while the file has an id that does not exist, an `en` that differs from
 * the stored name, or two ids with one English text and different translations: those are
 * the premise breaking, not something to write around.
 * Needs the tables from the migration `create_tag_translation_tables`.
 *
 * The rules live in `src/utils/tagTranslationImport.js` (tested); this file only does the I/O.
 */

const fs = require("node:fs");
const path = require("node:path");
const db = require("../src/config/database");
const { validateSeed, planImport } = require("../src/utils/tagTranslationImport");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const APPLY = flag("apply");
const REQUIRE_COMPLETE = flag("require-complete");
const LANGUAGE = option("lang") || "de";
const FILE =
  option("file") ||
  path.join(__dirname, "..", "src", "database", "seeds", `tag-translations.${LANGUAGE}.json`);

const SOURCES = {
  tags: { stored: "SELECT id, name FROM tags", existing: "SELECT tag_id AS id, name FROM tag_translations WHERE language = $1",
    table: "tag_translations", key: "tag_id" },
  categories: { stored: "SELECT id, name FROM tag_categories",
    existing: "SELECT category_id AS id, name FROM tag_category_translations WHERE language = $1",
    table: "tag_category_translations", key: "category_id" },
  supercategories: { stored: "SELECT id, name FROM tag_supercategories",
    existing: "SELECT supercategory_id AS id, name FROM tag_supercategory_translations WHERE language = $1",
    table: "tag_supercategory_translations", key: "supercategory_id" },
};

const loadState = async (client) => {
  const stored = {};
  const existing = {};
  for (const [section, src] of Object.entries(SOURCES)) {
    stored[section] = (await client.query(src.stored)).rows;
    existing[section] = (await client.query(src.existing, [LANGUAGE])).rows;
  }
  return { stored, existing };
};

const show = (ids) => (ids.length === 0 ? "-" : ids.slice(0, 20).join(", ") + (ids.length > 20 ? ` … (+${ids.length - 20})` : ""));

const printPlan = (plan) => {
  for (const [section, r] of Object.entries(plan.sections)) {
    console.log(`\n${section}  (${r.total} in the database)`);
    console.log(`  new ${r.insert}   changed ${r.update}   unchanged ${r.unchanged}   still untranslated after this run ${r.untranslated}`);
    console.log(`  ids not in the database: ${show(r.unknownIds)}`);
    console.log(`  ids whose "en" differs from the stored name: ${show(r.mismatchIds)}`);
    if (r.sharedNames !== undefined) console.log(`  translated names shared by several tags: ${r.sharedNames}`);
    if (r.textConflicts !== undefined) console.log(`  English texts translated two different ways: ${r.textConflicts}`);
  }
};

const WRITE_SQL = (src) => `
  INSERT INTO ${src.table} (${src.key}, language, name)
  SELECT u.id, $3, u.name FROM unnest($1::int[], $2::text[]) AS u(id, name)
  ON CONFLICT (${src.key}, language) DO UPDATE SET name = EXCLUDED.name
`;

const main = async () => {
  const seed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const { errors, entries } = validateSeed(seed, LANGUAGE);
  console.log(`${APPLY ? "APPLY" : "DRY RUN (nothing is written)"} — language ${LANGUAGE}, file ${path.relative(process.cwd(), FILE)}`);
  if (errors.length > 0) {
    console.error("\nThe seed file is not valid:");
    errors.slice(0, 30).forEach((e) => console.error("  - " + e));
    if (errors.length > 30) console.error(`  … and ${errors.length - 30} more`);
    process.exitCode = 1;
    return;
  }

  const client = await db.pool.connect();
  try {
    let state;
    try {
      state = await loadState(client);
    } catch (error) {
      if (error && error.code === "42P01") {
        console.error("\nThe translation tables do not exist yet. Run `npm run migrate` first.");
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    const plan = planImport(entries, state.stored, state.existing);
    printPlan(plan);

    const untranslated = Object.values(plan.sections).reduce((n, r) => n + r.untranslated, 0);

    if (REQUIRE_COMPLETE) {
      console.log(`\nRelease gate: ${untranslated} entries without a translation.`);
      process.exitCode = untranslated === 0 && plan.problems === 0 ? 0 : 1;
      return;
    }

    if (!APPLY) {
      console.log("\nDry run only. Add --apply to write.");
      return;
    }

    if (plan.problems > 0) {
      console.error(`\nREFUSED: ${plan.problems} problems above. Nothing was written.`);
      process.exitCode = 1;
      return;
    }

    await client.query("BEGIN");
    try {
      for (const [section, src] of Object.entries(SOURCES)) {
        const rows = plan.writes[section];
        if (rows.length === 0) continue;
        await client.query(WRITE_SQL(src), [rows.map((r) => r.id), rows.map((r) => r.name), LANGUAGE]);
      }
      // Re-plan inside the transaction: nothing may be left to write.
      const reloaded = await loadState(client);
      const after = planImport(entries, reloaded.stored, reloaded.existing);
      const left = Object.values(after.writes).reduce((n, rows) => n + rows.length, 0);
      if (left !== 0) throw new Error(`${left} rows still differ after writing — rolled back.`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const written = Object.values(plan.writes).reduce((n, rows) => n + rows.length, 0);
    console.log(`\nWritten: ${written} rows. A second --apply writes 0.`);
  } finally {
    client.release();
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
