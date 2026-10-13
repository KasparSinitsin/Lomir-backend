const db = require("../../config/database");

/**
 * Creates the PostgreSQL extension `unaccent`, which the accent-insensitive
 * search needs (STATUS item 52, utils/search/accentFolding.js).
 *
 * 🟢 **Additive and idempotent** (`IF NOT EXISTS`): it adds functions and a text
 * search dictionary, no table and no row, and changes nothing that exists. It
 * may run before the code that calls it with `npm run migrate:one`.
 * 🔴 **It must exist before that code runs anywhere** (local development uses
 * the live database): without it every search that folds accents fails.
 * 🔴 Needs the right to create extensions; if the host refuses, the run stops
 * and rolls back, and nothing is left half done.
 */

const EXTENSION = "unaccent";

const createUnaccentExtension = async () => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS unaccent");

    const { rows } = await client.query("SELECT unaccent('Müller André') AS folded");
    if (rows[0].folded !== "Muller Andre") {
      throw new Error(`${EXTENSION} does not fold as expected (${rows[0].folded}) — rolled back.`);
    }

    await client.query("COMMIT");
    console.log(`${EXTENSION} is available.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Error creating the ${EXTENSION} extension (rolled back):`, error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = createUnaccentExtension;
module.exports.EXTENSION = EXTENSION;
