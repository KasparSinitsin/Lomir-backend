// Shared reply-preview ("quoted message") snapshot helpers.
//
// The reply snapshot embedded in each delivered message must be self-contained
// so the frontend can render the quoted message (text, image, file, expiry)
// without needing the original message to still be in the loaded window. This
// used to be hand-built in 5 places with only id/content/sender columns, which
// drifted from what the frontend renders and dropped image/file/expiry fields
// for everyone except the message author's optimistic copy. Centralize the
// column list + the row->object mapping here so all call sites stay in sync.
//
// Two SELECT-column fragments because the reply row is queried two ways:
//   - JOINED into the main message query (aliases rm = reply message, ru = its sender)
//   - as a STANDALONE lookup by id (aliases m = reply message, u = its sender)
// Both alias to the same `reply_to_*` output columns so `buildReplyTo` works for either.

const replySnapshotJoinColumns = `
  rm.id AS reply_to_message_id,
  rm.content AS reply_to_content,
  rm.sender_id AS reply_to_sender_id,
  ru.username AS reply_to_sender_username,
  ru.first_name AS reply_to_sender_first_name,
  rm.image_url AS reply_to_image_url,
  rm.file_url AS reply_to_file_url,
  rm.file_name AS reply_to_file_name,
  rm.file_size AS reply_to_file_size,
  rm.file_expires_at AS reply_to_file_expires_at,
  rm.file_deleted_at AS reply_to_file_deleted_at,
  rm.deleted_at AS reply_to_deleted_at
`;

const replySnapshotSelfColumns = `
  m.id AS reply_to_message_id,
  m.content AS reply_to_content,
  m.sender_id AS reply_to_sender_id,
  u.username AS reply_to_sender_username,
  u.first_name AS reply_to_sender_first_name,
  m.image_url AS reply_to_image_url,
  m.file_url AS reply_to_file_url,
  m.file_name AS reply_to_file_name,
  m.file_size AS reply_to_file_size,
  m.file_expires_at AS reply_to_file_expires_at,
  m.file_deleted_at AS reply_to_file_deleted_at,
  m.deleted_at AS reply_to_deleted_at
`;

// Map a row carrying the `reply_to_*` columns above to the frontend reply-preview
// shape, or null if the message has no reply. Content is trimmed to 150 chars to
// match the previous inline behavior.
const buildReplyTo = (row) => {
  if (!row || !row.reply_to_message_id) return null;

  return {
    id: row.reply_to_message_id,
    content: row.reply_to_content ? row.reply_to_content.slice(0, 150) : null,
    senderId: row.reply_to_sender_id,
    senderUsername: row.reply_to_sender_username,
    senderFirstName: row.reply_to_sender_first_name,
    imageUrl: row.reply_to_image_url,
    fileUrl: row.reply_to_file_url,
    fileName: row.reply_to_file_name,
    fileSize: row.reply_to_file_size,
    fileExpiresAt: row.reply_to_file_expires_at,
    fileDeletedAt: row.reply_to_file_deleted_at,
    deletedAt: row.reply_to_deleted_at,
  };
};

module.exports = {
  replySnapshotJoinColumns,
  replySnapshotSelfColumns,
  buildReplyTo,
};
