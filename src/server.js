const { initScheduledJobs } = require("./jobs/fileCleanupScheduler");

require("dotenv").config();

// Fail-closed security check (runs before any DB/job side effects): Turnstile
// CAPTCHA on registration and the contact form is gated on TURNSTILE_SECRET_KEY
// (see authController/contactController). If the key is missing, that protection
// silently turns off (fail-open). In production, refuse to start so a
// misconfigured deploy is caught immediately instead of running without CAPTCHA.
// Non-production keeps the feature-flag behaviour (key optional → local dev runs
// without it).
if (process.env.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET_KEY) {
  console.error(
    "FATAL: TURNSTILE_SECRET_KEY is not set in production — CAPTCHA protection " +
      "on registration and the contact form would be silently disabled. " +
      "Set TURNSTILE_SECRET_KEY and redeploy. Refusing to start.",
  );
  process.exit(1);
}

const app = require("./app");
const http = require("http");
const { initSocket } = require("./socket");
const PORT = process.env.PORT || 5001;

// Create HTTP server
const server = http.createServer(app);

// Attach Socket.IO (auth middleware, presence, and all event handlers)
initSocket(server, app);

// Initialize scheduled jobs
initScheduledJobs();

const cleanupUnverifiedAccounts = require("./jobs/cleanupUnverifiedAccounts");
cleanupUnverifiedAccounts();
cleanupUnverifiedAccounts.purgeExpiredUnverifiedAccounts().catch((error) => {
  console.error("[Cleanup] Error cleaning up unverified accounts on startup:", error);
});

const cleanupArchivedTeams = require("./jobs/cleanupArchivedTeams");
cleanupArchivedTeams();
cleanupArchivedTeams.purgeExpiredArchivedTeams().catch((error) => {
  console.error("[Cleanup] Error cleaning up archived teams on startup:", error);
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} with Socket.IO enabled`);
});
