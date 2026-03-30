/**
 * Backfill script to geocode existing teams
 *
 * Run this once to add latitude/longitude to teams that have
 * postal_code/city/country but no coordinates.
 *
 * Usage: node backfill-team-geocoding.js
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

async function backfillTeamGeocoding() {
  console.log("Starting team geocoding backfill...\n");

  try {
    // Find teams that need geocoding
    const result = await pool.query(`
      SELECT id, name, city, country, postal_code, state
      FROM teams 
      WHERE archived_at IS NULL 
        AND is_remote = false 
        AND (latitude IS NULL OR longitude IS NULL)
        AND (postal_code IS NOT NULL OR city IS NOT NULL)
        AND country IS NOT NULL
      ORDER BY id
    `);

    console.log(`Found ${result.rows.length} teams needing geocoding.\n`);

    if (result.rows.length === 0) {
      console.log("All teams are already geocoded!");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const team of result.rows) {
      console.log(`Processing team ${team.id}: "${team.name}"`);
      console.log(
        `  Location: ${team.city || ""}, ${team.postal_code || ""}, ${team.country}`,
      );

      try {
        const coordinates = await geocodeAddress({
          postal_code: team.postal_code,
          city: team.city,
          country: team.country,
        });

        if (coordinates && coordinates.latitude && coordinates.longitude) {
          // Update the team with coordinates
          await pool.query(
            `
            UPDATE teams 
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
              team.id,
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

backfillTeamGeocoding();
