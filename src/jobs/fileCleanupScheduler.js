// Scheduled jobs for file cleanup and expiration notifications

const cron = require('node-cron');
const {
  cleanupExpiredFiles,
  createExpirationNotifications,
} = require('../utils/fileCleanup');
const {
  cleanupExpiredPasswordResetTokens,
} = require('../utils/tokenCleanup');
const { processFileDeletions } = require('../utils/fileDeletionQueue');

/**
 * The file part of the daily cleanup: expire old chat files, then retry the
 * ImageKit deletions that are still queued (STATUS item 59). Each half runs even
 * when the other fails.
 *
 * 🔴 Render's free tier puts the server to sleep when nobody uses it, so the
 * 02:00 schedule alone often never fires. `runStartupFileCleanup` runs the same
 * work at every start, which is also every wake-up.
 */
const runFileCleanup = async (label) => {
  try {
    await cleanupExpiredFiles();
  } catch (error) {
    console.error(`[SCHEDULER] ${label}: file cleanup failed:`, error);
  }
  try {
    await processFileDeletions();
  } catch (error) {
    console.error(`[SCHEDULER] ${label}: retrying queued file deletions failed:`, error);
  }
};

/**
 * Initialize all scheduled jobs
 */
const initScheduledJobs = () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[SCHEDULER] Initializing scheduled jobs...');
  }

  // Run file cleanup daily at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SCHEDULER] Running daily file cleanup...');
    }
    await runFileCleanup('Daily run');
  }, {
    timezone: 'Europe/Berlin'
  });

  // Run expiration notifications daily at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SCHEDULER] Running expiration notification check...');
    }
    try {
      await createExpirationNotifications(7);
    } catch (error) {
      console.error('[SCHEDULER] Expiration notifications failed:', error);
    }
  }, {
    timezone: 'Europe/Berlin'
  });

  // Run expired password-reset token cleanup hourly
  cron.schedule('15 * * * *', async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SCHEDULER] Running password reset token cleanup...');
    }
    try {
      await cleanupExpiredPasswordResetTokens();
    } catch (error) {
      console.error('[SCHEDULER] Password reset token cleanup failed:', error);
    }
  }, {
    timezone: 'Europe/Berlin'
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log('[SCHEDULER] Scheduled jobs initialized:');
    console.log('  - File cleanup and queued file deletions: Daily at 2:00 AM and at startup');
    console.log('  - Expiration notifications: Daily at 9:00 AM');
    console.log('  - Password reset token cleanup: Hourly at minute 15');
  }
};

/**
 * The same file work once at startup (see runFileCleanup). Never throws.
 */
const runStartupFileCleanup = () => runFileCleanup('Startup run');

/**
 * Manually trigger file cleanup (for testing or admin use)
 */
const runCleanupNow = async () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[SCHEDULER] Manual cleanup triggered...');
  }
  return await cleanupExpiredFiles();
};

/**
 * Manually trigger expiration notifications (for testing or admin use)
 */
const runNotificationsNow = async () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[SCHEDULER] Manual notification check triggered...');
  }
  return await createExpirationNotifications(7);
};

module.exports = {
  initScheduledJobs,
  runStartupFileCleanup,
  runCleanupNow,
  runNotificationsNow,
};
