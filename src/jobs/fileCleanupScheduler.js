// Scheduled jobs for file cleanup and expiration notifications

const cron = require('node-cron');
const {
  cleanupExpiredFiles,
  createExpirationNotifications,
} = require('../utils/fileCleanup');

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
    try {
      await cleanupExpiredFiles();
    } catch (error) {
      console.error('[SCHEDULER] File cleanup failed:', error);
    }
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

  if (process.env.NODE_ENV !== 'production') {
    console.log('[SCHEDULER] Scheduled jobs initialized:');
    console.log('  - File cleanup: Daily at 2:00 AM');
    console.log('  - Expiration notifications: Daily at 9:00 AM');
  }
};

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
  runCleanupNow,
  runNotificationsNow,
};
