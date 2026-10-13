const db = require("../../config/database");

/**
 * Gives the tag categories and supercategories ids (STATUS item 11, the tag taxonomy).
 *
 * 🔴 **Why it exists.** A tag carries its category and supercategory only as TEXT, so a
 * translation of them would be keyed by text, and round 74 showed the text is not a key:
 * the category "Social Impact" sits under TWO supercategories (68 pairs for 67 texts).
 * Julia decided on 2026-10-10 that both get ids, and that the one stray tag moves.
 *
 * ✅ **Measured on production, 2026-10-10** (`deletion-audit/74`, `75`): 780 tags, 13
 * supercategories, 67 category texts in 68 pairs; no NULL, empty or padded value; no two
 * spellings that differ only by case or spacing. The extra pair is tag 21 "Social Impact"
 * (Business & Entrepreneurship, parent 30, in use) beside 7 tags in "Social, Community &
 * Volunteering". Nothing but display, sorting and grouping reads these two columns.
 *
 * 🟢 **What it does (additive).**
 *   1  creates `tag_supercategories` and `tag_categories` (unique `(supercategory_id, name)`)
 *   2  adds `tags.supercategory_id` and `tags.category_id`; the TEXT columns stay as they are,
 *      so none of the ~30 queries that read them changes
 *   3  moves tag 21 into "Social, Community & Volunteering" (guarded on its exact values;
 *      its `parent_id` is left alone). After this each category text exists once: 67 pairs
 *   4  FIRST RUN ONLY (the tables are empty): fills the two tables from the distinct text
 *   5  every run: links tags whose ids are still NULL to the rows with the same text
 *
 * 🔴 **It does not create categories on later runs.** A tag made later with a new category
 * text stays unlinked and is only counted; deciding what a new category is belongs to
 * Phase 2 (user-made focus areas), not to a migration that re-runs.
 * 🟢 **Idempotent by guard.** 🔴 **Verified by itself:** it owns its transaction, refuses a
 * count beyond what exists, and rolls back unless every id agrees with the text beside it.
 *
 * Dry run: `deletion-audit/76`.
 */

const EXPECTED_SUPERCATEGORIES = 13; // `deletion-audit/74` on production, 2026-10-10
const EXPECTED_CATEGORIES = 67; // 68 pairs, 67 after tag 21 moves
const MAX_SUPERCATEGORIES = 40; // far above 13; more means the text is not what was measured
const MAX_CATEGORIES = 200;

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS tag_supercategories (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    CONSTRAINT tag_supercategories_name_clean CHECK (name <> '' AND name = btrim(name))
  );
  CREATE TABLE IF NOT EXISTS tag_categories (
    id               SERIAL PRIMARY KEY,
    supercategory_id INTEGER NOT NULL REFERENCES tag_supercategories(id),
    name             TEXT NOT NULL,
    CONSTRAINT tag_categories_name_clean CHECK (name <> '' AND name = btrim(name)),
    CONSTRAINT tag_categories_supercategory_id_name_key UNIQUE (supercategory_id, name)
  );
  ALTER TABLE tags ADD COLUMN IF NOT EXISTS supercategory_id INTEGER REFERENCES tag_supercategories(id);
  ALTER TABLE tags ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES tag_categories(id);
`;

// Tag 21 is the single "Social Impact" tag filed under Business & Entrepreneurship.
const MOVE_TAG_21_SQL = `
  UPDATE tags
  SET supercategory = 'Social, Community & Volunteering'
  WHERE id = 21 AND name = 'Social Impact' AND category = 'Social Impact'
    AND supercategory = 'Business & Entrepreneurship'
`;

const SEED_SUPERCATEGORIES_SQL = `
  INSERT INTO tag_supercategories (name)
  SELECT DISTINCT supercategory FROM tags
  WHERE supercategory IS NOT NULL AND btrim(supercategory) <> ''
  ORDER BY supercategory
`;

const SEED_CATEGORIES_SQL = `
  INSERT INTO tag_categories (supercategory_id, name)
  SELECT DISTINCT s.id, t.category
  FROM tags t
  JOIN tag_supercategories s ON s.name = t.supercategory
  WHERE t.category IS NOT NULL AND btrim(t.category) <> ''
  ORDER BY 1, 2
`;

const LINK_SQL = `
  UPDATE tags t
  SET supercategory_id = s.id,
      category_id = c.id
  FROM tag_supercategories s
  JOIN tag_categories c ON c.supercategory_id = s.id
  WHERE s.name = t.supercategory AND c.name = t.category
    AND t.supercategory_id IS NULL AND t.category_id IS NULL
`;

// Ids that disagree with the text beside them. Must be 0 after every run.
const DISAGREE_SQL = `
  SELECT count(*)::int AS n
  FROM tags t
  LEFT JOIN tag_categories c ON c.id = t.category_id
  LEFT JOIN tag_supercategories s ON s.id = t.supercategory_id
  WHERE (t.category_id IS NOT NULL OR t.supercategory_id IS NOT NULL)
    AND (c.id IS NULL OR s.id IS NULL
         OR c.name IS DISTINCT FROM t.category
         OR s.name IS DISTINCT FROM t.supercategory
         OR c.supercategory_id IS DISTINCT FROM t.supercategory_id)
`;

const UNLINKED_SQL = `
  SELECT count(*)::int AS n FROM tags
  WHERE category IS NOT NULL AND supercategory IS NOT NULL
    AND (category_id IS NULL OR supercategory_id IS NULL)
`;

const createTagCategoryTables = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(CREATE_SQL);

    const moved = await client.query(MOVE_TAG_21_SQL);

    const { rows: before } = await client.query(
      `SELECT (SELECT count(*)::int FROM tag_supercategories) AS s,
              (SELECT count(*)::int FROM tag_categories) AS c`,
    );
    const firstRun = before[0].s === 0 && before[0].c === 0;

    let seededS = 0;
    let seededC = 0;
    if (firstRun) {
      seededS = (await client.query(SEED_SUPERCATEGORIES_SQL)).rowCount;
      seededC = (await client.query(SEED_CATEGORIES_SQL)).rowCount;

      if (seededS > MAX_SUPERCATEGORIES || seededC > MAX_CATEGORIES) {
        throw new Error(
          `tag category ids would create ${seededS} supercategories and ${seededC} ` +
            `categories, but only ${EXPECTED_SUPERCATEGORIES} and ${EXPECTED_CATEGORIES} ` +
            "were measured — rolled back. The text is not what the dry run saw.",
        );
      }
    }

    const linked = await client.query(LINK_SQL);

    const { rows: bad } = await client.query(DISAGREE_SQL);
    if (bad[0].n !== 0) {
      throw new Error(
        `tag category ids: ${bad[0].n} tags have an id that disagrees with their text — ` +
          "rolled back.",
      );
    }

    const { rows: left } = await client.query(UNLINKED_SQL);
    if (firstRun && left[0].n !== 0) {
      throw new Error(
        `tag category ids left ${left[0].n} tags without ids on the first run — rolled back. ` +
          "The rule and the data disagree.",
      );
    }

    await client.query("COMMIT");

    console.log(
      `tag category ids: tag 21 moved ${moved.rowCount}, ` +
        (firstRun
          ? `${seededS} supercategories and ${seededC} categories created ` +
            `(dry run ${EXPECTED_SUPERCATEGORIES} and ${EXPECTED_CATEGORIES}), `
          : "tables already filled, ") +
        `${linked.rowCount} tags linked, ${left[0].n} tags without ids.`,
    );
    if (firstRun && (seededS !== EXPECTED_SUPERCATEGORIES || seededC !== EXPECTED_CATEGORIES)) {
      console.log(
        "tag category ids: ⚠️ the counts differ from the dry run — re-run " +
          "deletion-audit/76 and read why before trusting it.",
      );
    }
    if (!firstRun && left[0].n !== 0) {
      console.log(
        `tag category ids: ${left[0].n} tags carry a category text that has no row yet ` +
          "(made after the first run). Left alone on purpose; see the migration header.",
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating the tag category tables (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = createTagCategoryTables;
module.exports.EXPECTED_SUPERCATEGORIES = EXPECTED_SUPERCATEGORIES;
module.exports.EXPECTED_CATEGORIES = EXPECTED_CATEGORIES;
