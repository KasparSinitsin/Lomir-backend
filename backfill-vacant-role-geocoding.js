/**
 * Backfill script to geocode existing vacant roles
 *
 * Run this once to add latitude/longitude to vacant roles that have
 * postal_code/city/country but no coordinates.
 *
 * Usage: node backfill-vacant-role-geocoding.js
 *
 * Make sure to run this from your backend directory with access to:
 * - Your .env file (for DATABASE_URL)
 * - The geocodingUtil module
 */

require("dotenv").config();
const { Pool } = require("pg");
const { geocodeAddress } = require("./src/utils/geocodingUtil");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function backfillVacantRoleGeocoding() {
  console.log("Starting vacant role geocoding backfill...\n");

  try {
    // Find vacant roles that need geocoding
    const result = await pool.query(`
      SELECT id, role_name, city, country, postal_code, state, team_id
      FROM team_vacant_roles
      WHERE is_remote = false
        AND (latitude IS NULL OR longitude IS NULL)
        AND (postal_code IS NOT NULL OR city IS NOT NULL)
        AND country IS NOT NULL
      ORDER BY id
    `);

    console.log(`Found ${result.rows.length} vacant roles needing geocoding.\n`);

    if (result.rows.length === 0) {
      console.log("All vacant roles are already geocoded!");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const role of result.rows) {
      console.log(
        `Processing role ${role.id}: "${role.role_name}" (team ${role.team_id})`,
      );
      console.log(
        `  Location: ${role.city || ""}, ${role.postal_code || ""}, ${role.country}`,
      );

      try {
        const coordinates = await geocodeAddress({
          postal_code: role.postal_code,
          city: role.city,
          country: role.country,
        });

        if (coordinates && coordinates.latitude && coordinates.longitude) {
          // Update the role with coordinates
          await pool.query(
            `
            UPDATE team_vacant_roles
            SET latitude = $1,
                longitude = $2,
                state = COALESCE($3, state),
                updated_at = NOW()
            WHERE id = $4
          `,
            [
              coordinates.latitude,
              coordinates.longitude,
              coordinates.state,
              role.id,
            ],
          );

          console.log(
            `  ✅ Updated: ${coordinates.latitude}, ${coordinates.longitude}`,
          );
          if (coordinates.state) {
            console.log(`  📍 State: ${coordinates.state}`);
          }
          successCount++;
        } else {
          console.log(`  ❌ Geocoding returned no results`);
          failCount++;
        }

        // Rate limit: Nominatim requires max 1 request per second
        console.log("  ⏳ Waiting 1.1 seconds (rate limit)...\n");
        await new Promise((resolve) => setTimeout(resolve, 1100));
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        failCount++;
      }
    }

    console.log("\n========== SUMMARY ==========");
    console.log(`✅ Successfully geocoded: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📊 Total processed: ${result.rows.length}`);
  } catch (error) {
    console.error("Database error:", error.message);
  } finally {
    await pool.end();
    console.log("\nDone!");
  }
}

backfillVacantRoleGeocoding();
