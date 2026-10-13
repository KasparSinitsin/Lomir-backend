/**
 * The dictionary of translated tag names that `GET /api/tags/translations?lang=` returns
 * (STATUS item 11, mechanism B).
 *
 *   { language, tags: { "<tag id>": "name" },
 *     categories: { "<English category text>": "name" },
 *     supercategories: { "<English supercategory text>": "name" } }
 *
 * Tags are keyed by id. Categories and supercategories are keyed by their stored ENGLISH
 * TEXT, because that is all a tag carries in the responses of the ~30 queries that
 * return one; the ids live in the database and in the seed file.
 *
 * English, an unknown language, or a table that does not exist yet (the migration has not
 * run) all give EMPTY maps with status 200: the frontend then shows the stored names.
 */

const UNDEFINED_TABLE = "42P01";

// "de", "DE " -> "de". "en" and anything that is not two letters -> null (no translation).
const parseLanguage = (value) => {
  const language = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{2}$/.test(language) && language !== "en" ? language : null;
};

const emptyDictionary = (language = null) => ({
  language,
  tags: {},
  categories: {},
  supercategories: {},
});

// Rows come ordered by (text, name): when two categories share a text but were translated
// differently, the first one wins, the same on every call. The import reports that case.
const textMap = (rows) => {
  const map = {};
  for (const row of rows) {
    if (!(row.source_text in map)) map[row.source_text] = row.name;
  }
  return map;
};

const buildDictionary = (language, tagRows, categoryRows, supercategoryRows) => {
  const tags = {};
  for (const row of tagRows) tags[String(row.tag_id)] = row.name;
  return {
    language,
    tags,
    categories: textMap(categoryRows),
    supercategories: textMap(supercategoryRows),
  };
};

const TAGS_SQL = `
  SELECT tag_id, name FROM tag_translations WHERE language = $1 ORDER BY tag_id
`;
const CATEGORIES_SQL = `
  SELECT c.name AS source_text, t.name
  FROM tag_category_translations t
  JOIN tag_categories c ON c.id = t.category_id
  WHERE t.language = $1
  ORDER BY c.name, t.name
`;
const SUPERCATEGORIES_SQL = `
  SELECT s.name AS source_text, t.name
  FROM tag_supercategory_translations t
  JOIN tag_supercategories s ON s.id = t.supercategory_id
  WHERE t.language = $1
  ORDER BY s.name, t.name
`;

const loadDictionary = async (db, language) => {
  if (!language) return emptyDictionary();

  try {
    const [tags, categories, supercategories] = await Promise.all([
      db.query(TAGS_SQL, [language]),
      db.query(CATEGORIES_SQL, [language]),
      db.query(SUPERCATEGORIES_SQL, [language]),
    ]);
    return buildDictionary(language, tags.rows, categories.rows, supercategories.rows);
  } catch (error) {
    if (error && error.code === UNDEFINED_TABLE) return emptyDictionary(language);
    throw error;
  }
};

module.exports = {
  parseLanguage,
  emptyDictionary,
  buildDictionary,
  loadDictionary,
  TAGS_SQL,
  CATEGORIES_SQL,
  SUPERCATEGORIES_SQL,
};
