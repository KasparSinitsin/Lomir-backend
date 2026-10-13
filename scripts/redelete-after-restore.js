#!/usr/bin/env node
/**
 * Makes account and team deletions again after a database backup was restored
 * (STATUS item 59; the step is in the internal backup and restore runbook).
 *
 *   npm run redelete -- --file=<records>                 # dry run: shows what it would do
 *   npm run redelete -- --file=<records> --apply         # does it
 *   npm run redelete -- --file=<records> --from-db=<host> [--apply]
 *
 * <records> holds the JSON lines of the "Lomir deletion record" mails, one per
 * line; other text on a line is ignored. Keep the file OUTSIDE OneDrive and
 * delete it afterwards.
 *
 * 🔴 Run it BEFORE the restored database takes traffic again: a restore sets
 *    the id sequences back, and a new account could receive the id of a
 *    deleted one. The creation time in each record guards against deleting
 *    such an account (it is REFUSED), but only for records that carry one.
 * 🟢 A record applies only to the database it was written for (`db`, a host
 *    name). After a restore into a NEW host, name the old one with --from-db.
 * 🟢 Ids and words only in the output, no names. It sends no new deletion
 *    record (the original mail stays the reference) and deletes the files the
 *    deletion queues before it ends.
 * Exit code 1 if any record is refused or fails, or the file has bad lines.
 */

const fs = require("node:fs");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fileArg = args.find((a) => a.startsWith("--file="));
const fromDb = args.filter((a) => a.startsWith("--from-db=")).map((a) => a.slice("--from-db=".length));

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

const main = async () => {
  if (!fileArg) {
    return fail("usage: npm run redelete -- --file=<records> [--from-db=<host>] [--apply]");
  }
  const text = fs.readFileSync(fileArg.slice("--file=".length), "utf8");

  const { parseRecords, planRecord, applyPlan } = require("./redelete/redeletion");
  const { records, problems } = parseRecords(text);

  const dbHost = hostOf(process.env.DATABASE_URL || "");
  if (!dbHost) return fail("DATABASE_URL is missing or unreadable.");

  console.log(`${APPLY ? "APPLY" : "DRY RUN (nothing happens)"} — database host: ${dbHost}`);
  console.log(`records: ${records.length}${problems.length ? `, bad lines: ${problems.length}` : ""}`);
  for (const problem of problems) console.log(`  ${problem}`);
  if (APPLY && problems.length > 0) {
    return fail("REFUSED: fix or remove the bad lines first (a dry run lists them).");
  }

  // Required only now, so a usage error never opens a database connection.
  const db = require("../src/config/database");
  const fileDeletionQueue = require("../src/utils/fileDeletionQueue");
  const deletionRecord = require("../src/utils/deletionRecord");
  const { runAccountDeletion } = require("../src/controllers/userDeletionController");
  const { permanentlyDeleteTeam } = require("../src/controllers/teamController");

  // The deletion code hands its follow-up work off without waiting. Here it is
  // collected and finished before the connection closes; no new record mail.
  const queuedFileIds = [];
  fileDeletionQueue.processFileDeletionsSoon = (ids) => queuedFileIds.push(...ids);
  deletionRecord.sendDeletionRecordSoon = () => {};

  const acceptedHosts = new Set([dbHost, ...fromDb]);
  const counts = { delete: 0, skip: 0, refuse: 0, failed: 0 };

  try {
    for (const record of records) {
      const plan = await planRecord(db, record, { acceptedHosts });
      const label = `${record.kind} ${record.id} (deleted ${record.deletedAt})`;

      if (plan.action === "skip") {
        counts.skip += 1;
        console.log(`${label}: skip, ${plan.reason}`);
        continue;
      }
      if (plan.action === "refuse") {
        counts.refuse += 1;
        console.log(`${label}: REFUSED, ${plan.reason}`);
        continue;
      }

      counts.delete += 1;
      const extra = [];
      if (plan.action === "delete-account") {
        if (plan.overrides.length) extra.push(`recorded successors: ${plan.overrides.length}`);
        if (plan.droppedSuccessors) extra.push(`successors no longer possible, default used: ${plan.droppedSuccessors}`);
        if (plan.teams?.length) extra.push(`solo teams recorded: ${plan.teams.map((t) => `${t.id} ${t.match}`).join(", ")}`);
      }
      console.log(`${label}: ${APPLY ? "deleting" : "would delete"}${extra.length ? ` (${extra.join("; ")})` : ""}`);

      if (APPLY) {
        try {
          const lines = await applyPlan(plan, { queryable: db, runAccountDeletion, permanentlyDeleteTeam });
          for (const line of lines) {
            console.log(`  ${line}`);
            if (/FAILED|REFUSED/.test(line)) counts.failed += 1;
          }
        } catch (error) {
          counts.failed += 1;
          console.log(`  FAILED: ${error?.message || error}`);
        }
      }
    }

    if (APPLY && queuedFileIds.length > 0) {
      const stats = await fileDeletionQueue.processFileDeletions({ ids: queuedFileIds });
      console.log(`files: ${stats.settled} gone, ${stats.failed} still queued (retried by the daily cleanup)`);
    }
  } finally {
    await db.pool.end();
  }

  console.log(
    `\n${APPLY ? "deleted" : "would delete"}: ${counts.delete}, skipped: ${counts.skip}, refused: ${counts.refuse}` +
      (APPLY ? `, failed: ${counts.failed}` : ""),
  );
  if (counts.refuse > 0 || counts.failed > 0 || problems.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
