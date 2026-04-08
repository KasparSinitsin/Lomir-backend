// Utilities for cleaning up expired chat files

const db = require("../config/database");
const imagekit = require("../config/imagekit");
const {
  extractImageKitFilename,
  isImageKitUrl,
} = require("./imagekitUtils");

/**
 * Delete a file from ImageKit
 * @param {string} url - The ImageKit file URL
 * @returns {Promise<boolean>} - Success status
 */
const deleteFromImageKit = async (url) => {
  try {
    if (!isImageKitUrl(url)) {
      return false;
    }

    const filename = extractImageKitFilename(url);

    if (!filename) {
      return false;
    }

    const response = await fetch(
      `https://api.imagekit.io/v1/files?searchQuery=${encodeURIComponent(`name="${filename}"`)}`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString(
              "base64",
            ),
        },
      },
    );

    if (!response.ok) {
      console.error("[CLEANUP] Search API error:", response.status);
      return false;
    }

    const files = await response.json();

    if (!Array.isArray(files) || files.length === 0) {
      return false;
    }

    await imagekit.files.delete(files[0].fileId);
    return true;
  } catch (error) {
    console.error(`[CLEANUP] Error deleting from ImageKit:`, error);
    return false;
  }
};

/**
 * Clean up expired files
 * - Deletes files from ImageKit
 * - Updates database to mark files as deleted
 * @returns {Promise<{processed: number, deleted: number, errors: number}>}
 */
const cleanupExpiredFiles = async () => {
  if (process.env.NODE_ENV !== "production") {
    console.log("[CLEANUP] Starting expired file cleanup...");
  }

  const stats = { processed: 0, deleted: 0, errors: 0 };

  try {
    // Find all expired files that haven't been deleted yet
    const expiredFiles = await db.query(`
      SELECT id, image_url, file_url
      FROM messages
      WHERE file_expires_at IS NOT NULL
        AND file_expires_at < NOW()
        AND file_deleted_at IS NULL
        AND (image_url IS NOT NULL OR file_url IS NOT NULL)
      LIMIT 100
    `);

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[CLEANUP] Found ${expiredFiles.rows.length} expired files to process`,
      );
    }

    for (const row of expiredFiles.rows) {
      stats.processed++;

      const url = row.file_url || row.image_url;

      if (isImageKitUrl(url)) {
        const imagekitDeleted = await deleteFromImageKit(url);

        if (!imagekitDeleted) {
          console.warn(`[CLEANUP] Could not delete file from ImageKit for message ${row.id}`);
          stats.errors++;
        }
      }

      // Update database to mark as deleted (even if ImageKit delete failed)
      await db.query(`
        UPDATE messages
        SET file_deleted_at = NOW(),
            image_url = NULL,
            file_url = NULL
        WHERE id = $1
      `, [row.id]);

      stats.deleted++;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[CLEANUP] Processed message ${row.id}`);
      }
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[CLEANUP] Completed. Processed: ${stats.processed}, Deleted: ${stats.deleted}, Errors: ${stats.errors}`,
      );
    }
    return stats;
  } catch (error) {
    console.error("[CLEANUP] Error during cleanup:", error);
    throw error;
  }
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
  deleteFromImageKit,
  cleanupExpiredFiles,
  getFilesExpiringSoon,
  createExpirationNotifications,
};
