/**
 * The rules of `scripts/import-tag-translations.js` (STATUS item 11), without any I/O so they
 * can be tested: checking the seed file, and planning what an import would do.
 *
 * Seed file (`src/database/seeds/tag-translations.<lang>.json`), keyed by ID:
 *   { "language": "de",
 *     "tags":            { "38": { "en": "Hiking", "name": "Wandern" } },
 *     "categories":      { "<tag_categories.id>": { "en": "...", "name": "..." } },
 *     "supercategories": { "<tag_supercategories.id>": { "en": "...", "name": "..." } } }
 *
 * The `en` is only a CHECK: the import compares it with the stored name and skips a row that
 * differs (a renamed tag, or the wrong database). It is never written. An optional `note` is
 * for the reviewer and is ignored.
 */

const SECTIONS = ["tags", "categories", "supercategories"];

const isCleanText = (value) =>
  typeof value === "string" && value !== "" && value === value.trim();

// Returns { errors: [...], entries: { tags: [{ id, en, name }], categories: [...], ... } }.
const validateSeed = (seed, expectedLanguage) => {
  const errors = [];
  const entries = { tags: [], categories: [], supercategories: [] };

  if (!seed || typeof seed !== "object" || Array.isArray(seed)) {
    return { errors: ["the seed file is not a JSON object"], entries };
  }
  if (typeof seed.language !== "string" || !/^[a-z]{2}$/.test(seed.language)) {
    errors.push(`"language" must be two lowercase letters, got ${JSON.stringify(seed.language)}`);
  } else if (expectedLanguage && seed.language !== expectedLanguage) {
    errors.push(`"language" is "${seed.language}" but the import was asked for "${expectedLanguage}"`);
  }
  if (seed.language === "en") errors.push('"en" needs no translations: the stored name is the English text');

  for (const key of Object.keys(seed)) {
    if (key !== "language" && !SECTIONS.includes(key)) errors.push(`unknown top-level key "${key}"`);
  }

  for (const section of SECTIONS) {
    const value = seed[section] === undefined ? {} : seed[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`"${section}" must be an object`);
      continue;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!/^[1-9]\d*$/.test(key)) {
        errors.push(`${section}: key "${key}" is not an id`);
        continue;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`${section}.${key}: must be an object with "en" and "name"`);
        continue;
      }
      const extra = Object.keys(entry).filter((k) => !["en", "name", "note"].includes(k));
      if (extra.length > 0) errors.push(`${section}.${key}: unknown field ${extra.join(", ")}`);
      if (!isCleanText(entry.en)) errors.push(`${section}.${key}: "en" must be non-empty text without outer spaces`);
      if (!isCleanText(entry.name)) errors.push(`${section}.${key}: "name" must be non-empty text without outer spaces`);
      if (isCleanText(entry.en) && isCleanText(entry.name)) {
        entries[section].push({ id: Number(key), en: entry.en, name: entry.name });
      }
    }
  }

  return { errors, entries };
};

/**
 * stored:   { tags|categories|supercategories: [{ id, name }] }   the English text in the database
 * existing: { tags|categories|supercategories: [{ id, name }] }   the translations already stored
 *
 * Nothing is deleted: a translation that is in the database and not in the file stays.
 */
const planImport = (entries, stored, existing) => {
  const sections = {};
  const writes = {};
  let problems = 0;

  for (const section of SECTIONS) {
    const storedById = new Map(stored[section].map((r) => [r.id, r.name]));
    const existingById = new Map(existing[section].map((r) => [r.id, r.name]));
    const result = { insert: 0, update: 0, unchanged: 0, unknownIds: [], mismatchIds: [] };
    writes[section] = [];

    for (const entry of entries[section]) {
      const storedName = storedById.get(entry.id);
      if (storedName === undefined) {
        result.unknownIds.push(entry.id);
      } else if (storedName !== entry.en) {
        result.mismatchIds.push(entry.id);
      } else if (!existingById.has(entry.id)) {
        result.insert += 1;
        writes[section].push({ id: entry.id, name: entry.name });
      } else if (existingById.get(entry.id) !== entry.name) {
        result.update += 1;
        writes[section].push({ id: entry.id, name: entry.name });
      } else {
        result.unchanged += 1;
      }
    }

    // What the table holds once the writes are in.
    const finalById = new Map(existingById);
    for (const w of writes[section]) finalById.set(w.id, w.name);

    result.untranslated = stored[section].filter((r) => !finalById.has(r.id)).length;
    result.total = stored[section].length;

    // Two different tags with the same translated name: reported, never blocked (Phase 1).
    if (section === "tags") {
      const byName = new Map();
      for (const [id, name] of finalById) {
        if (storedById.has(id)) byName.set(name, (byName.get(name) || 0) + 1);
      }
      result.sharedNames = [...byName.values()].filter((n) => n > 1).length;
    }

    // The dictionary is keyed by the English TEXT, so two ids with one text must agree.
    if (section !== "tags") {
      const namesByText = new Map();
      for (const r of stored[section]) {
        if (!finalById.has(r.id)) continue;
        const set = namesByText.get(r.name) || new Set();
        set.add(finalById.get(r.id));
        namesByText.set(r.name, set);
      }
      result.textConflicts = [...namesByText.values()].filter((set) => set.size > 1).length;
    }

    problems += result.unknownIds.length + result.mismatchIds.length + (result.textConflicts || 0);
    sections[section] = result;
  }

  return { sections, writes, problems };
};

module.exports = { SECTIONS, validateSeed, planImport };
