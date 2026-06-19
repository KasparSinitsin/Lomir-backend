/**
 * Backfill normalized location data for users, teams, and vacant roles.
 *
 * Run after scripts/add-location-district-columns.sql:
 *   node scripts/backfill-location-data.js
 */

require("dotenv").config();
const { pool } = require("../src/config/database");
const { resolveLocationData } = require("../src/utils/geocodingUtil");

const DELAY_MS = Number(process.env.GEOCODING_BACKFILL_DELAY_MS || 1100);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasLocation(row) {
  return Boolean(row.country || row.city || row.postal_code);
}

async function backfillTable({ tableName, labelColumn = "id" }) {
  const result = await pool.query(`
    SELECT id, ${labelColumn}, postal_code, city, state, district, country, latitude, longitude
    FROM ${tableName}
    WHERE country IS NOT NULL
      AND country <> ''
      AND (
        latitude IS NULL
        OR longitude IS NULL
        OR state IS NULL
        OR state = ''
        OR district IS NULL
        OR district = ''
      )
    ORDER BY id
  `);

  const rows = result.rows.filter(hasLocation);
  console.log(`\n${tableName}: found ${rows.length} rows to inspect.`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const label = row[labelColumn] || row.id;
    console.log(`Resolving ${tableName} ${row.id} (${label})...`);

    const resolved = await resolveLocationData(row);

    if (!resolved) {
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    await pool.query(
      `
      UPDATE ${tableName}
      SET postal_code = $1,
          city = $2,
          state = $3,
          district = $4,
          country = $5,
          latitude = $6,
          longitude = $7,
          updated_at = NOW()
      WHERE id = $8
      `,
      [
        resolved.postal_code,
        resolved.city,
        resolved.state,
        resolved.district,
        resolved.country,
        resolved.latitude,
        resolved.longitude,
        row.id,
      ],
    );

    updated++;
    await sleep(DELAY_MS);
  }

  console.log(`${tableName}: updated ${updated}, skipped ${skipped}.`);
}

async function main() {
  try {
    await backfillTable({ tableName: "users", labelColumn: "username" });
    await backfillTable({ tableName: "teams", labelColumn: "name" });
    await backfillTable({
      tableName: "team_vacant_roles",
      labelColumn: "role_name",
    });
  } catch (error) {
    console.error("Location backfill failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
