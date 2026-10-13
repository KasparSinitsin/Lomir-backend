#!/usr/bin/env node
/**
 * Counts the ImageKit files nothing in the database points at any more
 * (STATUS item 59: chat files of deleted accounts and teams, avatars of
 * unverified accounts, failed deletions from before the deletion queue).
 *
 *   npm run files:orphans
 *
 * 🟢 READ-ONLY on both sides: the database is only read (SELECT), and ImageKit
 *    only listed. A guard replaces fetch BEFORE anything else loads and lets
 *    through only GET requests to the ImageKit files API; nothing is deleted.
 * 🟢 Prints counts per folder and the database host, never a file name, path,
 *    URL or id.
 * Uses DATABASE_URL and the ImageKit keys of `.env`: run it against the
 * database whose files are in that ImageKit account. Deleting the orphans is a
 * separate decision.
 *
 * Test mode: `--fake-imagekit=<file.json>` answers the listing from a file
 * instead of ImageKit (no network), for the fixture on a throwaway database.
 */

const fs = require("node:fs");

const args = process.argv.slice(2);
const fakeArg = args.find((a) => a.startsWith("--fake-imagekit="));
const FAKE_FILES = fakeArg ? JSON.parse(fs.readFileSync(fakeArg.slice("--fake-imagekit=".length), "utf8")) : null;

// The read-only guard, installed before any module that could capture fetch.
const realFetch = globalThis.fetch;
const blocked = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  if (method !== "GET" || !url.startsWith("https://api.imagekit.io/v1/files")) {
    blocked.push(method);
    throw new Error(`blocked ${method} (this script is read-only)`);
  }
  if (FAKE_FILES) {
    const skip = Number(new URL(url).searchParams.get("skip") || 0);
    const limit = Number(new URL(url).searchParams.get("limit") || 1000);
    return { ok: true, status: 200, json: async () => FAKE_FILES.slice(skip, skip + limit) };
  }
  return realFetch(input, init);
};

const { listAllFiles, BASE_REFERENCES_SQL, QUEUE_REFERENCES_SQL, hostOf } = require("./orphans/listing");

const main = async () => {
  const { countOrphans } = require("./orphans/countOrphans");
  const db = require("../src/config/database");
  try {
    console.log(`READ-ONLY — database host: ${hostOf(process.env.DATABASE_URL || "")}${FAKE_FILES ? " — FAKE ImageKit listing" : ""}`);
    const { rows: [table] } = await db.query(
      "SELECT to_regclass('pending_file_deletions') IS NOT NULL AS present",
    );
    if (!table.present) {
      console.log("the deletion queue table does not exist here yet (before migrate:one): counted as empty");
    }
    const { rows } = await db.query(BASE_REFERENCES_SQL + (table.present ? QUEUE_REFERENCES_SQL : ""));
    const references = rows.map((row) => ({ url: row.url, fileId: row.file_id, queued: row.queued }));
    const files = await listAllFiles();
    const result = countOrphans(files, references);

    console.log(`database references: ${references.length}; ImageKit files: ${files.length}\n`);
    console.log("folder               files  referenced  queued  orphaned<1day  orphaned older");
    for (const [folder, n] of Object.entries(result)) {
      console.log(
        `${folder.padEnd(20)} ${String(n.files).padStart(5)}  ${String(n.referenced).padStart(10)}  ${String(n.queued).padStart(6)}  ${String(n.orphanedUnderADay).padStart(13)}  ${String(n.orphanedOlder).padStart(14)}`,
      );
    }
    console.log(`\nrequests blocked by the read-only guard: ${blocked.length}`);
  } finally {
    await db.pool.end();
  }
};

main().catch((error) => {
  console.error("STOPPED:", error.message);
  process.exitCode = 1;
});
