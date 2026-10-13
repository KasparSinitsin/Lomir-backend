#!/usr/bin/env node
/**
 * Deletes the ImageKit files nothing in the database points at any more
 * (STATUS item 59; counted by `npm run files:orphans`). The files go through the
 * deletion queue `pending_file_deletions`, so a failed deletion is retried by the
 * daily cleanup and at every server start.
 *
 *   npm run files:orphans:delete                        dry run: counts only
 *   npm run files:orphans:delete -- --apply --expect=14 queue and delete
 *
 * 🟢 The dry run is READ-ONLY on both sides: the database is only read, and a
 *    guard lets through only GET requests to the ImageKit files API.
 * 🔴 `--apply` deletes real files. It needs `--expect=<n>` with the number the
 *    dry run printed; any other number stops it. Before queueing, the
 *    references are read AGAIN inside the transaction that queues the files, and
 *    a file that is referenced again by then stops the whole run.
 * 🟢 Only orphans older than a day inside the four Lomir folders are taken; a
 *    file in another folder is never touched. Output is counts only, never a file
 *    name, path, URL or id.
 * Uses DATABASE_URL and the ImageKit keys of `.env`: run it against the database
 * whose files are in that ImageKit account.
 *
 * Test mode: `--fake-imagekit=<file.json>` answers the listing from a file and
 * simulates every deletion as successful (no network), for the fixture on a
 * throwaway database.
 */

const fs = require("node:fs");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const expectArg = args.find((a) => a.startsWith("--expect="));
const EXPECT = expectArg ? Number(expectArg.slice("--expect=".length)) : null;
const fakeArg = args.find((a) => a.startsWith("--fake-imagekit="));
const FAKE_FILES = fakeArg ? JSON.parse(fs.readFileSync(fakeArg.slice("--fake-imagekit=".length), "utf8")) : null;

// Installed before any module that could capture fetch. The dry run lets only
// GETs to the files API through; with --apply the ImageKit client must be able to
// delete, so only the fake listing is served.
const realFetch = globalThis.fetch;
const blocked = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  if (!APPLY && (method !== "GET" || !url.startsWith("https://api.imagekit.io/v1/files"))) {
    blocked.push(method);
    throw new Error(`blocked ${method} (the dry run is read-only)`);
  }
  if (FAKE_FILES) {
    if (method !== "GET" || !url.startsWith("https://api.imagekit.io/v1/files")) {
      throw new Error(`blocked ${method} (fake ImageKit: nothing leaves the machine)`);
    }
    const skip = Number(new URL(url).searchParams.get("skip") || 0);
    const limit = Number(new URL(url).searchParams.get("limit") || 1000);
    return { ok: true, status: 200, json: async () => FAKE_FILES.slice(skip, skip + limit) };
  }
  return realFetch(input, init);
};

const { listAllFiles, BASE_REFERENCES_SQL, QUEUE_REFERENCES_SQL, hostOf } = require("./orphans/listing");

const readReferences = async (queryable) => {
  const { rows } = await queryable.query(BASE_REFERENCES_SQL + QUEUE_REFERENCES_SQL);
  return rows.map((row) => ({ url: row.url, fileId: row.file_id, queued: row.queued }));
};

const main = async () => {
  const { FOLDERS, folderOf, countOrphans, findOrphans } = require("./orphans/countOrphans");
  const db = require("../src/config/database");
  const imagekitUtils = require("../src/utils/imagekitUtils");
  const queue = require("../src/utils/fileDeletionQueue");

  if (FAKE_FILES) {
    imagekitUtils.deleteImageKitFileWithResult = async () => ({ result: imagekitUtils.DELETION_RESULT.DELETED });
  }

  try {
    console.log(
      `${APPLY ? "APPLY" : "DRY RUN (read-only)"} — database host: ${hostOf(process.env.DATABASE_URL || "")}${FAKE_FILES ? " — FAKE ImageKit listing" : ""}`,
    );
    const { rows: [table] } = await db.query("SELECT to_regclass('pending_file_deletions') IS NOT NULL AS present");
    if (!table.present) {
      throw new Error("the deletion queue table does not exist here (run migrate:one create_pending_file_deletions first)");
    }

    const files = await listAllFiles();
    const references = await readReferences(db);
    const orphans = findOrphans(files, references);
    const counts = countOrphans(files, references);

    console.log(`database references: ${references.length}; ImageKit files: ${files.length}\n`);
    console.log("folder               to delete (orphaned older)  orphaned<1day (kept)");
    for (const folder of FOLDERS) {
      console.log(
        `${folder.padEnd(20)} ${String(orphans.filter((f) => folderOf(f.filePath) === folder).length).padStart(9)}  ${String(counts[folder].orphanedUnderADay).padStart(27)}`,
      );
    }
    console.log(`\nto delete in total: ${orphans.length}`);

    if (!APPLY) {
      console.log(`nothing queued, nothing deleted. To delete: --apply --expect=${orphans.length}`);
      console.log(`requests blocked by the read-only guard: ${blocked.length}`);
      return;
    }

    if (EXPECT === null || !Number.isInteger(EXPECT)) {
      throw new Error("--apply needs --expect=<n>, the number the dry run printed");
    }
    if (EXPECT !== orphans.length) {
      throw new Error(`--expect=${EXPECT} but ${orphans.length} files are orphaned now; nothing queued`);
    }
    if (orphans.length === 0) {
      console.log("nothing to do");
      return;
    }

    // The queueing transaction re-reads the references; a file referenced again
    // since the listing stops the run.
    const client = await db.pool.connect();
    let ids;
    try {
      await client.query("BEGIN");
      const fresh = await readReferences(client);
      const stillOrphans = findOrphans(orphans, fresh);
      if (stillOrphans.length !== orphans.length) {
        throw new Error(
          `${orphans.length - stillOrphans.length} file(s) are referenced or queued again since the listing; nothing queued`,
        );
      }
      ids = await queue.queueFiles(
        client,
        orphans.map((file) => ({ url: file.url, fileId: file.fileId })),
        queue.FILE_DELETION_SOURCE.ORPHAN_CLEANUP,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const stats = await queue.processFileDeletions({ ids });
    console.log(`queued: ${ids.length}; deleted or gone: ${stats.settled}; failed (stay queued, retried daily): ${stats.failed}`);
    if (stats.failed > 0) process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
};

main().catch((error) => {
  console.error("STOPPED:", error.message);
  process.exitCode = 1;
});
