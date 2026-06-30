const cron = require("node-cron");
const db = require("../config/database");
const { permanentlyDeleteTeam } = require("../controllers/teamController");

// When an owner deletes a team that still has other members it is only
// soft-deleted (archived): the chat is kept so the remaining members can see the
// "team deleted" notice and read the history one last time, and it is normally
// purged once the last member leaves (see checkAndCleanupArchivedTeam). This job
// is the safety net for the case where members never explicitly leave — it
// permanently removes any team that has been archived for longer than the grace
// period, together with its chat messages, members and avatar, so a deleted team
// never lingers forever.
const parsedGrace = Number(process.env.ARCHIVED_TEAM_GRACE_DAYS);
const GRACE_PERIOD_DAYS =
  Number.isFinite(parsedGrace) && parsedGrace >= 0 ? parsedGrace : 30;

const debugLog = (...args) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
};

// Core logic, separated from the schedule so it can be unit-tested and triggered
// manually. Returns how many archived teams were found and successfully purged.
const purgeExpiredArchivedTeams = async () => {
  const { rows } = await db.query(
    `
    SELECT id
    FROM teams
    WHERE archived_at IS NOT NULL
      AND archived_at < NOW() - INTERVAL '${GRACE_PERIOD_DAYS} days'
    `,
  );

  let deleted = 0;
  for (const { id } of rows) {
    try {
      await permanentlyDeleteTeam(id);
      deleted += 1;
    } catch (error) {
      console.error(
        `[Cleanup] Failed to permanently delete archived team ${id}:`,
        error,
      );
    }
  }

  return { found: rows.length, deleted };
};

const cleanupArchivedTeams = () => {
  // Daily at 03:30 — after the 02:00 file cleanup, before the 09:00 notifications.
  cron.schedule(
    "30 3 * * *",
    async () => {
      try {
        const { found, deleted } = await purgeExpiredArchivedTeams();
        if (found > 0) {
          debugLog(
            `[Cleanup] Permanently deleted ${deleted}/${found} archived team(s) older than ${GRACE_PERIOD_DAYS} day(s).`,
          );
        } else {
          debugLog(
            "[Cleanup] No archived teams past the grace period to delete.",
          );
        }
      } catch (error) {
        console.error("[Cleanup] Error cleaning up archived teams:", error);
      }
    },
    { timezone: "Europe/Berlin" },
  );

  debugLog(
    `[Cleanup] Archived-team cleanup job scheduled (daily 03:30 Europe/Berlin, grace ${GRACE_PERIOD_DAYS} day(s)).`,
  );
};

module.exports = cleanupArchivedTeams;
module.exports.purgeExpiredArchivedTeams = purgeExpiredArchivedTeams;
module.exports.GRACE_PERIOD_DAYS = GRACE_PERIOD_DAYS;
