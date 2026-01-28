/**
 * Backfill State Data Script
 * 
 * This script updates existing users with state/region information
 * by using reverse geocoding on their stored coordinates.
 * 
 * Run with: node scripts/backfill-state-data.js
 */

require('dotenv').config();
const axios = require('axios');
const { pool } = require('../src/config/database');

// Delay between API calls to respect Nominatim rate limits (1 req/sec)
const DELAY_MS = 1100;

/**
 * Reverse geocode coordinates to get state/region
 */
async function reverseGeocode(latitude, longitude) {
  try {
    const response = await axios.get(
      'https://nominatim.openstreetmap.org/reverse',
      {
        params: {
          lat: latitude,
          lon: longitude,
          format: 'json',
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'Lomir-App/1.0 (team-building-app)',
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.address) {
      const address = response.data.address;
      // Nominatim returns state in different fields depending on the country
      const state = address.state || address.county || address.region || address.state_district || null;
      return state;
    }
    return null;
  } catch (error) {
    console.error(`Reverse geocoding error: ${error.message}`);
    return null;
  }
}

/**
 * Sleep helper function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main backfill function
 */
async function backfillStateData() {
  console.log('Starting state data backfill...\n');

  try {
    // Get all users with coordinates but no state
    const result = await pool.query(`
      SELECT id, username, latitude, longitude, city, country
      FROM users 
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL 
        AND (state IS NULL OR state = '')
      ORDER BY id
    `);

    const users = result.rows;
    console.log(`Found ${users.length} users to update.\n`);

    if (users.length === 0) {
      console.log('No users need state data. Exiting.');
      return;
    }

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const user of users) {
      console.log(`Processing user ${user.id} (${user.username})...`);
      console.log(`  Coordinates: ${user.latitude}, ${user.longitude}`);
      console.log(`  City: ${user.city}, Country: ${user.country}`);

      const state = await reverseGeocode(user.latitude, user.longitude);

      if (state) {
        // Update the user's state
        await pool.query(
          'UPDATE users SET state = $1, updated_at = NOW() WHERE id = $2',
          [state, user.id]
        );
        console.log(`  ✓ Updated state to: ${state}`);
        updated++;
      } else {
        console.log(`  ✗ Could not determine state`);
        failed++;
      }

      // Respect rate limits
      await sleep(DELAY_MS);
    }

    console.log('\n--- Backfill Complete ---');
    console.log(`Total users processed: ${users.length}`);
    console.log(`Successfully updated: ${updated}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);

  } catch (error) {
    console.error('Backfill error:', error);
  } finally {
    await pool.end();
  }
}

// Run the script
backfillStateData();