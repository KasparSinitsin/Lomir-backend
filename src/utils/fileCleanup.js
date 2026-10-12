// Utilities for cleaning up expired chat files

const db = require("../config/database");
const fileDeletionQueue = require("./fileDeletionQueue");

const EXPIRED_BATCH_SIZE = 100;

/**
 * Clean up expired chat files.
 *
 * In one transaction, the image AND the file of up to 100 expired messages go
 * onto the deletion queue, and the messages are marked as expired (their URLs
 * cleared). After the commit the queued files are deleted from ImageKit; a file
 * that fails stays queued and is retried by the next run (STATUS item 59).
 *
 * 🔴 Until 2026-10-12 a message was marked even when ImageKit failed, which left
 * the file behind with nothing pointing at it, and only one of image and file
 * was deleted when a message had both.
 *
 * @returns {Promise<{processed: number, deleted: number, errors: number}>}
 *   processed = expired messages handled, deleted = files gone,
 *   errors = files still queued after this run's attempt
 */
const cleanupExpiredFiles = async () => {
  if (process.env.NODE_ENV !== "production") {
    console.log("[CLEANUP] Starting expired file cleanup...");
  }

  const client = await db.pool.connect();
  let messageIds = [];
  let queuedIds = [];

  try {
    await client.query("BEGIN");

    const expired = await client.query(
      `
      SELECT id
      FROM messages
      WHERE file_expires_at IS NOT NULL
        AND file_expires_at < NOW()
        AND file_deleted_at IS NULL
        AND (image_url IS NOT NULL OR file_url IS NOT NULL)
      ORDER BY file_expires_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [EXPIRED_BATCH_SIZE],
    );

    messageIds = expired.rows.map((row) => Number(row.id));

    if (messageIds.length > 0) {
      queuedIds = await fileDeletionQueue.queueMessageAttachments(
        client,
        { where: "m.id = ANY($1::bigint[])", params: [messageIds] },
        fileDeletionQueue.FILE_DELETION_SOURCE.CHAT_FILE_EXPIRY,
      );

      await client.query(
        `
        UPDATE messages
        SET file_deleted_at = NOW(),
            image_url = NULL,
            file_url = NULL
        WHERE id = ANY($1::bigint[])
        `,
        [messageIds],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[CLEANUP] Error during cleanup:", error);
    throw error;
  } finally {
    client.release();
  }

  const deletion = await fileDeletionQueue.processFileDeletions({ ids: queuedIds });
  const stats = {
    processed: messageIds.length,
    deleted: deletion.settled,
    errors: deletion.failed,
  };

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[CLEANUP] Completed. Expired messages: ${stats.processed}, files gone: ${stats.deleted}, still queued: ${stats.errors}`,
    );
  }
  return stats;
};

/**
 * Get files expiring within the next N days
 * @param {number} days - Number of days to look ahead
 * @returns {Promise<Array>} - Array of expiring files with user info
 */
const getFilesExpiringSoon = async (days = 7) => {
  try {
    const result = await db.query(`
      SELECT 
        m.id as message_id,
        m.sender_id,
        m.receiver_id,
        m.team_id,
        m.file_name,
        m.file_url,
        m.image_url,
        m.file_expires_at,
        m.sent_at,
        u.username as sender_username,
        u.email as sender_email
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.file_expires_at IS NOT NULL
        AND m.file_expires_at > NOW()
        AND m.file_expires_at <= NOW() + INTERVAL '${days} days'
        AND m.file_deleted_at IS NULL
        AND (m.image_url IS NOT NULL OR m.file_url IS NOT NULL)
      ORDER BY m.file_expires_at ASC
    `);

    return result.rows;
  } catch (error) {
    console.error("[CLEANUP] Error fetching expiring files:", error);
    throw error;
  }
};

/**
 * Create notifications for users with files expiring soon
 * @param {number} days - Number of days to look ahead (default 7)
 * @returns {Promise<{notified: number, errors: number}>}
 */
const createExpirationNotifications = async (days = 7) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[CLEANUP] Creating notifications for files expiring in ${days} days...`);
  }
  
  const stats = { notified: 0, errors: 0 };

  try {
    // Get unique users who have files expiring soon
    const result = await db.query(`
      SELECT DISTINCT
        m.sender_id as user_id,
        COUNT(*) as file_count,
        MIN(m.file_expires_at) as earliest_expiration
      FROM messages m
      WHERE m.file_expires_at IS NOT NULL
        AND m.file_expires_at > NOW()
        AND m.file_expires_at <= NOW() + INTERVAL '${days} days'
        AND m.file_deleted_at IS NULL
        AND (m.image_url IS NOT NULL OR m.file_url IS NOT NULL)
      GROUP BY m.sender_id
    `);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CLEANUP] Found ${result.rows.length} users with expiring files`);
    }

    for (const row of result.rows) {
      try {
        // Check if we already sent a notification recently (within last 24 hours)
        const existingNotification = await db.query(`
          SELECT id FROM notifications
          WHERE user_id = $1
            AND type = 'file_expiration_warning'
            AND created_at > NOW() - INTERVAL '24 hours'
          LIMIT 1
        `, [row.user_id]);

        if (existingNotification.rows.length > 0) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[CLEANUP] Skipping user ${row.user_id} - already notified recently`);
          }
          continue;
        }

        // Create notification
        const daysUntilExpiration = Math.ceil(
          (new Date(row.earliest_expiration) - new Date()) / (1000 * 60 * 60 * 24)
        );

        await db.query(`
          INSERT INTO notifications (user_id, type, title, message, reference_type, created_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
        `, [
          row.user_id,
          'file_expiration_warning',
          'Files Expiring Soon',
          `You have ${row.file_count} file(s) that will expire in ${daysUntilExpiration} day(s). Download them to keep a copy.`,
          'file_expiration'
        ]);

        stats.notified++;
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[CLEANUP] Notified user ${row.user_id} about ${row.file_count} expiring files`);
        }

      } catch (error) {
        console.error(`[CLEANUP] Error notifying user ${row.user_id}:`, error);
        stats.errors++;
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CLEANUP] Notifications complete. Notified: ${stats.notified}, Errors: ${stats.errors}`);
    }
    return stats;

  } catch (error) {
    console.error("[CLEANUP] Error creating notifications:", error);
    throw error;
  }
};

module.exports = {
  cleanupExpiredFiles,
  getFilesExpiringSoon,
  createExpirationNotifications,
};
