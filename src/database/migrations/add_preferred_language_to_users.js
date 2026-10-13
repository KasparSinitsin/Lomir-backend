const db = require("../../config/database");

/**
 * The UI language the user chose, as a BCP-47 code ("en", "de").
 *
 * NULL is meaningful and is the default: it means "never chose one", which is
 * what lets the country rule apply. Writing a derived value here would turn a
 * guess into an explicit choice and freeze it.
 *
 * Deliberately a varchar and not an enum - adding a language should be a code
 * change, not a schema migration.
 */
const addPreferredLanguageToUsers = async () => {
  try {
    await db.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10)
    `);

    console.log("preferred_language column added to users (or already exists)");
  } catch (error) {
    console.error("Error adding preferred_language to users:", error);
    throw error;
  }
};

module.exports = addPreferredLanguageToUsers;
