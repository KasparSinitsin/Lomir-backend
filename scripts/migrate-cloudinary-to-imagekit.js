/**
 * migrate-cloudinary-to-imagekit.js
 *
 * One-time migration script: downloads images from Cloudinary,
 * re-uploads them to ImageKit, and updates the database URLs.
 *
 * Run from the Lomir-backend root:
 *   node scripts/migrate-cloudinary-to-imagekit.js
 *
 * Optional flags:
 *   --dry-run    Log what would happen without making changes
 *   --table=X    Only migrate a specific table (users, teams, messages)
 *
 * Prerequisites:
 *   - .env must contain DATABASE_URL, IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT
 *   - npm packages already installed (@imagekit/nodejs, pg via database config)
 */

require("dotenv").config();
const https = require("https");
const http = require("http");
const { Pool } = require("pg");
const ImageKit = require("@imagekit/nodejs");
const { toFile } = require("@imagekit/nodejs");

// ─── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
const TABLE_FILTER = process.argv
  .find((a) => a.startsWith("--table="))
  ?.split("=")[1];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// Map each table/column to the correct ImageKit folder
const MIGRATIONS = [
  {
    name: "users",
    table: "users",
    column: "avatar_url",
    idColumn: "id",
    folder: "lomir/avatars",
  },
  {
    name: "teams",
    table: "teams",
    column: "teamavatar_url",
    idColumn: "id",
    folder: "lomir/team-avatars",
  },
  {
    name: "messages-images",
    table: "messages",
    column: "image_url",
    idColumn: "id",
    folder: "lomir/chat-images",
  },
  {
    name: "messages-files",
    table: "messages",
    column: "file_url",
    idColumn: "id",
    folder: "lomir/chat-files",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Download a file from a URL and return it as a Buffer.
 */
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, { timeout: 30000 }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject)
      .on("timeout", function () {
        this.destroy();
        reject(new Error(`Timeout downloading ${url}`));
      });
  });
}

/**
 * Extract a reasonable filename from a Cloudinary URL.
 * e.g. https://res.cloudinary.com/xxx/image/upload/v123/lomir/avatars/file-name.jpg
 *      → file-name.jpg
 */
function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || `migrated-${Date.now()}.jpg`;
  } catch {
    return `migrated-${Date.now()}.jpg`;
  }
}

/**
 * Upload a buffer to ImageKit using the @imagekit/nodejs SDK.
 * Uses imagekit.files.upload() and the toFile() helper.
 * Returns { url, fileId } on success.
 */
async function uploadToImageKit(buffer, fileName, folder) {
  const result = await imagekit.files.upload({
    file: await toFile(buffer, fileName),
    fileName: fileName,
    folder: folder,
  });
  return { url: result.url, fileId: result.fileId };
}

/**
 * Sleep helper to avoid rate-limiting.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Migration ──────────────────────────────────────────────────────────

async function migrateBatch(migration) {
  const { name, table, column, idColumn, folder } = migration;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Migrating: ${name} (${table}.${column} → ${folder})`);
  console.log("=".repeat(60));

  // Find all rows with Cloudinary URLs
  const query = `
    SELECT ${idColumn}, ${column}
    FROM ${table}
    WHERE ${column} IS NOT NULL
      AND ${column} LIKE '%cloudinary.com%'
    ORDER BY ${idColumn}
  `;

  const { rows } = await pool.query(query);
  console.log(`Found ${rows.length} Cloudinary URLs to migrate.\n`);

  if (rows.length === 0) return { total: 0, success: 0, failed: 0, skipped: 0 };

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row[idColumn];
    const oldUrl = row[column];

    const fileName = extractFilename(oldUrl);
    const label = `[${table} #${id}] ${fileName}`;

    if (DRY_RUN) {
      console.log(`  DRY RUN ${label}`);
      console.log(`    FROM: ${oldUrl}`);
      console.log(`    TO:   ${folder}/${fileName}`);
      skipped++;
      continue;
    }

    try {
      // 1. Download from Cloudinary
      process.stdout.write(`  ${label} ... downloading`);
      const buffer = await downloadFile(oldUrl);
      process.stdout.write(` (${(buffer.length / 1024).toFixed(1)} KB)`);

      // 2. Upload to ImageKit
      process.stdout.write(" → uploading");
      const result = await uploadToImageKit(buffer, fileName, folder);

      // 3. Update the database
      process.stdout.write(" → updating DB");
      await pool.query(
        `UPDATE ${table} SET ${column} = $1 WHERE ${idColumn} = $2`,
        [result.url, id]
      );

      console.log(` ✓ ${result.url}`);
      success++;

      // Small delay to respect ImageKit rate limits
      await sleep(200);
    } catch (err) {
      console.log(` ✗ FAILED: ${err.message}`);
      failed++;
    }
  }

  return { total: rows.length, success, failed, skipped };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Cloudinary → ImageKit URL Migration                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE — no changes will be made.\n");
  }

  if (TABLE_FILTER) {
    console.log(`📋 Filtering to table: ${TABLE_FILTER}\n`);
  }

  // Test DB connection
  try {
    await pool.query("SELECT 1");
    console.log("✓ Database connection OK");
  } catch (err) {
    console.error("✗ Database connection failed:", err.message);
    process.exit(1);
  }

  // Test ImageKit SDK is configured correctly
  if (!DRY_RUN) {
    if (typeof imagekit.files.upload !== "function") {
      console.error("✗ ImageKit SDK not configured correctly — imagekit.files.upload is not available");
      process.exit(1);
    }
    console.log("✓ ImageKit SDK OK");
  }

  const results = {};

  for (const migration of MIGRATIONS) {
    if (TABLE_FILTER && migration.name !== TABLE_FILTER && migration.table !== TABLE_FILTER) {
      continue;
    }
    results[migration.name] = await migrateBatch(migration);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(60));

  let totalSuccess = 0;
  let totalFailed = 0;

  for (const [name, r] of Object.entries(results)) {
    const status = r.failed > 0 ? "⚠️ " : "✓ ";
    console.log(
      `${status}${name}: ${r.total} found, ${r.success} migrated, ${r.failed} failed, ${r.skipped} skipped`
    );
    totalSuccess += r.success;
    totalFailed += r.failed;
  }

  console.log(`\nTotal: ${totalSuccess} migrated, ${totalFailed} failed`);

  if (totalFailed > 0) {
    console.log("\n⚠️  Some migrations failed. Re-run the script to retry them.");
    console.log("   (Successfully migrated URLs won't be processed again.)");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end();
  process.exit(1);
});