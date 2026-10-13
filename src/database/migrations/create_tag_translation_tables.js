const db = require("../../config/database");

/**
 * Creates the three tables that hold the translated names of the tag taxonomy
 * (STATUS item 11, mechanism B: translations in the database).
 *
 *   tag_translations            (tag_id, language) -> name
 *   tag_category_translations   (category_id, language) -> name
 *   tag_supercategory_translations (supercategory_id, language) -> name
 *
 * 🔴 **Three tables, each with a real foreign key.** `user_tags.tag_id` has none, and
 * round 72 found 89 rows pointing at tags that no longer exist; one table with a
 * `kind` column and a bare `ref_id` could not have a key either. A translation of a
 * deleted tag is deleted with it (`ON DELETE CASCADE`).
 *
 * 🟢 **Additive and empty.** No data is written here: the German names come from the
 * reviewed seed file through `scripts/import-tag-translations.js`, so a portion of
 * translations lands without a new migration. English needs no rows: the stored name IS
 * the English text, and a missing row means "show the stored name".
 * 🟢 **Idempotent** (`IF NOT EXISTS`). 🔴 **Needs `create_tag_category_tables`**, which
 * runs before it in `index.js` (the category tables must exist for the keys).
 *
 * No uniqueness of the translated `name`: two English names can share one German word.
 * The import reports such collisions; deciding what to do with them belongs to Phase 2.
 */

const TABLES = [
  "tag_translations",
  "tag_category_translations",
  "tag_supercategory_translations",
];

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS tag_translations (
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    language VARCHAR(2) NOT NULL,
    name     TEXT NOT NULL,
    PRIMARY KEY (tag_id, language),
    CONSTRAINT tag_translations_language_check CHECK (language ~ '^[a-z]{2}$'),
    CONSTRAINT tag_translations_name_clean CHECK (name <> '' AND name = btrim(name))
  );
  CREATE TABLE IF NOT EXISTS tag_category_translations (
    category_id INTEGER NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
    language    VARCHAR(2) NOT NULL,
    name        TEXT NOT NULL,
    PRIMARY KEY (category_id, language),
    CONSTRAINT tag_category_translations_language_check CHECK (language ~ '^[a-z]{2}$'),
    CONSTRAINT tag_category_translations_name_clean CHECK (name <> '' AND name = btrim(name))
  );
  CREATE TABLE IF NOT EXISTS tag_supercategory_translations (
    supercategory_id INTEGER NOT NULL REFERENCES tag_supercategories(id) ON DELETE CASCADE,
    language         VARCHAR(2) NOT NULL,
    name             TEXT NOT NULL,
    PRIMARY KEY (supercategory_id, language),
    CONSTRAINT tag_supercategory_translations_language_check CHECK (language ~ '^[a-z]{2}$'),
    CONSTRAINT tag_supercategory_translations_name_clean CHECK (name <> '' AND name = btrim(name))
  );
`;

const createTagTranslationTables = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(CREATE_SQL);

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [TABLES],
    );
    if (rows[0].n !== TABLES.length) {
      throw new Error(
        `tag translation tables: ${rows[0].n} of ${TABLES.length} exist after the run — rolled back.`,
      );
    }

    await client.query("COMMIT");
    console.log(`tag translation tables: ${TABLES.join(", ")} exist.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating the tag translation tables (rolled back):", error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = createTagTranslationTables;
module.exports.TABLES = TABLES;
