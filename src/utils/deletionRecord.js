// A short internal record of every account deletion and every permanent team
// deletion, mailed to the operator inbox (STATUS item 59, decided 2026-10-11
// and 2026-10-12).
//
// 🔴 Why. A database backup still holds what was deleted after it was taken.
// After a restore, those deletions have to be made again (the re-deletion
// script, BACKUP_RESTORE_RUNBOOK). The list must live OUTSIDE the database,
// or the restore would take it back too, so it goes to the operator inbox.
//
// 🟢 Ids and timestamps only, never a name or an e-mail address:
//   · `createdAt` lets the re-deletion refuse an id that the restore handed
//     out again to someone else (ids come from a sequence that goes back too);
//   · `successors` lets it give each team the owner the person chose;
//   · `teams` names the solo teams deleted with the account, which do not go
//     through permanentlyDeleteTeam;
//   · `db` is the database HOST (never credentials), so a record from another
//     database is skipped. A local database (the demo) is not backed up, so
//     nothing is sent for it.

const emailService = require("../services/emailService");

const RECORD_VERSION = 1;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const databaseHost = (url = process.env.DATABASE_URL) => {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
};

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildAccountDeletionRecord = ({
  userId,
  createdAt,
  successors = [],
  deletedTeams = [],
  deletedAt = new Date(),
  db = databaseHost(),
}) => ({
  v: RECORD_VERSION,
  kind: "account",
  id: Number(userId),
  createdAt: toIso(createdAt),
  deletedAt: toIso(deletedAt),
  db,
  successors: successors.map(({ teamId, successorId }) => ({
    team: Number(teamId),
    user: Number(successorId),
  })),
  teams: deletedTeams.map(({ teamId, createdAt: teamCreatedAt }) => ({
    id: Number(teamId),
    createdAt: toIso(teamCreatedAt),
  })),
});

const buildTeamDeletionRecord = ({
  teamId,
  createdAt,
  deletedAt = new Date(),
  db = databaseHost(),
}) => ({
  v: RECORD_VERSION,
  kind: "team",
  id: Number(teamId),
  createdAt: toIso(createdAt),
  deletedAt: toIso(deletedAt),
  db,
});

const isLocalDatabase = (host) => !host || LOCAL_HOSTS.has(host);

/**
 * Mails one record. Resolves `{ sent: false }` for a local database; throws
 * when the mail did not go out.
 */
const sendDeletionRecord = async (record) => {
  if (isLocalDatabase(record?.db)) {
    return { sent: false, reason: "local database" };
  }

  const result = await emailService.sendDeletionRecordEmail(record);
  if (!result?.success) {
    throw new Error("the mail provider did not accept the record");
  }
  return { sent: true };
};

/**
 * Sends a record without holding the caller. Call it AFTER the commit.
 *
 * If the mail fails, the record goes to the error log instead: it holds ids
 * and timestamps only, and the log line is then the operator's only copy.
 */
const sendDeletionRecordSoon = (record) => {
  sendDeletionRecord(record).catch((error) => {
    console.error(
      `[DeletionRecord] Mail failed (${error?.message || error}); keep this record: ${JSON.stringify(record)}`,
    );
  });
};

module.exports = {
  RECORD_VERSION,
  databaseHost,
  isLocalDatabase,
  buildAccountDeletionRecord,
  buildTeamDeletionRecord,
  sendDeletionRecord,
  sendDeletionRecordSoon,
};
