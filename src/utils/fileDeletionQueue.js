// The ImageKit files that still have to be deleted (STATUS item 59).
//
// 🔴 The order is the point. A file is queued in the SAME transaction that
// deletes or clears the row pointing at it, and deleted from ImageKit only after
// the commit. A rollback therefore keeps both the row and the file; a commit
// keeps the file on the list until ImageKit confirms it is gone. Before this, a
// failed call after the commit left a file behind with nothing pointing at it.
//
// Rows hold the file reference only, never a person or a team
// (`create_pending_file_deletions`). Retried by the daily cleanup and at every
// server start (`jobs/fileCleanupScheduler.js`).

const db = require("../config/database");
const imagekitUtils = require("./imagekitUtils");

const FILE_DELETION_SOURCE = Object.freeze({
  ACCOUNT_DELETION: "account_deletion",
  TEAM_DELETION: "team_deletion",
  CHAT_FILE_EXPIRY: "chat_file_expiry",
  UNVERIFIED_ACCOUNT: "unverified_account",
});

const DEFAULT_BATCH_SIZE = 100;

/**
 * Queues single files, e.g. an avatar. Only references ImageKit can delete are
 * kept: a file id, or an ImageKit URL.
 *
 * @param {{ query: Function }} queryable the transaction's client
 * @param {Array<{ url?: string|null, fileId?: string|null }>} files
 * @param {string} source one of FILE_DELETION_SOURCE
 * @returns {Promise<number[]>} the ids of the queued rows
 */
const queueFiles = async (queryable, files, source) => {
  const deletable = (files || []).filter(
    (file) => file && (file.fileId || imagekitUtils.isImageKitUrl(file.url)),
  );

  if (deletable.length === 0) {
    return [];
  }

  const { rows } = await queryable.query(
    `INSERT INTO pending_file_deletions (file_url, file_id, source)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     RETURNING id`,
    [
      deletable.map((file) => file.url || null),
      deletable.map((file) => file.fileId || null),
      deletable.map(() => source),
    ],
  );

  return rows.map((row) => Number(row.id));
};

/**
 * Queues the attachments of the messages that `where` selects: the image AND
 * the file of each, ImageKit URLs only. Call it BEFORE the statement that
 * deletes or clears those messages, in the same transaction.
 *
 * `where` is a fixed SQL condition over the alias `m` (messages), written in the
 * calling code, never built from input; its parameters are `$1…$n`.
 *
 * @returns {Promise<number[]>} the ids of the queued rows
 */
const queueMessageAttachments = async (queryable, { where, params = [] }, source) => {
  const hostParam = `$${params.length + 1}`;
  const sourceParam = `$${params.length + 2}`;

  const { rows } = await queryable.query(
    `INSERT INTO pending_file_deletions (file_url, source)
     SELECT DISTINCT attachment.url, ${sourceParam}::text
     FROM messages m
     CROSS JOIN LATERAL (VALUES (m.image_url), (m.file_url)) AS attachment(url)
     WHERE (${where})
       AND attachment.url IS NOT NULL
       AND position(${hostParam}::text IN attachment.url) > 0
     RETURNING id`,
    [...params, imagekitUtils.IMAGEKIT_HOST, source],
  );

  return rows.map((row) => Number(row.id));
};

/**
 * Queues every ImageKit file of a team that is about to be deleted: the image
 * and file of each chat message, and the team avatar. Call it inside the
 * deleting transaction, before the messages and the team row are deleted.
 *
 * @returns {Promise<number[]>} the ids of the queued rows
 */
const queueTeamFiles = async (queryable, teamId, source) => {
  const attachmentIds = await queueMessageAttachments(
    queryable,
    { where: "m.team_id = $1", params: [teamId] },
    source,
  );

  const { rows } = await queryable.query(
    `INSERT INTO pending_file_deletions (file_url, file_id, source)
     SELECT t.teamavatar_url, t.teamavatar_file_id, $3::text
     FROM teams t
     WHERE t.id = $1
       AND (t.teamavatar_file_id IS NOT NULL
            OR position($2::text IN coalesce(t.teamavatar_url, '')) > 0)
     RETURNING id`,
    [teamId, imagekitUtils.IMAGEKIT_HOST, source],
  );

  return [...attachmentIds, ...rows.map((row) => Number(row.id))];
};

/**
 * Tries to delete queued files. A file that is gone (deleted, not found, or
 * nothing ImageKit could delete) leaves the list; a failure stays on it with
 * the attempt counted.
 *
 * Without `ids` it takes the oldest rows with the fewest attempts first, so a
 * file that keeps failing does not block the others.
 *
 * @returns {Promise<{ processed: number, settled: number, failed: number }>}
 */
const processFileDeletions = async ({ ids = null, limit = DEFAULT_BATCH_SIZE } = {}) => {
  const stats = { processed: 0, settled: 0, failed: 0 };

  if (Array.isArray(ids) && ids.length === 0) {
    return stats;
  }

  const { rows } = Array.isArray(ids)
    ? await db.query(
        `SELECT id, file_url, file_id FROM pending_file_deletions
         WHERE id = ANY($1::bigint[])
         ORDER BY id`,
        [ids],
      )
    : await db.query(
        `SELECT id, file_url, file_id FROM pending_file_deletions
         ORDER BY attempts ASC, id ASC
         LIMIT $1`,
        [limit],
      );

  for (const row of rows) {
    stats.processed += 1;

    try {
      const outcome = await imagekitUtils.deleteImageKitFileWithResult(
        row.file_url,
        row.file_id,
      );

      if (imagekitUtils.isDeletionSettled(outcome.result)) {
        await db.query(`DELETE FROM pending_file_deletions WHERE id = $1`, [row.id]);
        stats.settled += 1;
      } else {
        await db.query(
          `UPDATE pending_file_deletions
           SET attempts = attempts + 1,
               last_error = $2,
               last_attempt_at = NOW()
           WHERE id = $1`,
          [row.id, outcome.error || outcome.result],
        );
        stats.failed += 1;
      }
    } catch (error) {
      console.error(
        `[FileDeletion] Could not record the outcome for queued file ${row.id}:`,
        error?.message || error,
      );
      stats.failed += 1;
    }
  }

  if (stats.failed > 0) {
    console.warn(
      `[FileDeletion] ${stats.failed} of ${stats.processed} queued file(s) could not be deleted yet; they stay queued.`,
    );
  }

  return stats;
};

/**
 * Starts the deletion of freshly queued files without making the caller wait.
 * Call it AFTER the commit. Whatever fails stays queued for the next run.
 */
const processFileDeletionsSoon = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return;
  }

  processFileDeletions({ ids }).catch((error) => {
    console.error("[FileDeletion] Immediate deletion failed; the files stay queued:", error?.message || error);
  });
};

module.exports = {
  FILE_DELETION_SOURCE,
  DEFAULT_BATCH_SIZE,
  queueFiles,
  queueMessageAttachments,
  queueTeamFiles,
  processFileDeletions,
  processFileDeletionsSoon,
};
