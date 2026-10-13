// Mentions of a deleted person (STATUS item 59, decided by Julia on 2026-10-12).
//
// A mention is stored inside the message text as  @[Display Name](userId)
// (written by the frontend's MessageInput, read by its utils/mentions.js). The
// display resolves the label from the id, so a deleted person already shows as
// the placeholder, but the stored label still holds the name. On an account
// deletion every token carrying that id gets the placeholder label:
//   · anchored on the id, never on a name, so a rename before the deletion is
//     covered and nobody else's token is touched ("](7)" never matches "](17)");
//   · only the label inside the token changes; the rest of the text stays
//     exactly as its author wrote it.
// Notifications holding such a token are deleted, not rewritten (Julia's rule
// of 2026-10-02: messages stay, notifications go).
//
// Measured before (deletion-audit round 86, 2026-10-12): 4 tokens of 2 deleted
// accounts in 4 team messages, none in direct messages or notifications.

const MENTION_PLACEHOLDER = "Former Lomir User";

// The token of exactly this id, as a POSIX regex built in SQL from $1 (digits).
const TOKEN_OF_ID = `('@\\[[^]]+\\]\\(' || $1 || '\\)')`;

const asId = (userId) => {
  const id = String(userId);
  if (!/^[0-9]{1,18}$/.test(id)) {
    throw new Error("mentionScrub: not a user id");
  }
  return id;
};

/**
 * Gives every mention token of this id the placeholder label, in all messages
 * (team chats and other people's direct messages). Idempotent.
 * @returns {Promise<number>} messages changed
 */
const scrubMentionLabels = async (queryable, userId) => {
  const result = await queryable.query(
    `
    UPDATE messages
    SET content = regexp_replace(content, ${TOKEN_OF_ID}, '@[' || $2 || '](' || $1 || ')', 'g')
    WHERE content IS NOT NULL
      AND position('](' || $1 || ')' IN content) > 0
      AND content ~ ${TOKEN_OF_ID}
      AND content <> regexp_replace(content, ${TOKEN_OF_ID}, '@[' || $2 || '](' || $1 || ')', 'g')
    `,
    [asId(userId), MENTION_PLACEHOLDER],
  );
  return result.rowCount || 0;
};

/**
 * Deletes the notifications whose title or text holds a mention token of this
 * id (a mention notification keeps up to 100 characters of the message,
 * other people's tokens included).
 * @returns {Promise<number>} notifications deleted
 */
const deleteNotificationsMentioning = async (queryable, userId) => {
  const result = await queryable.query(
    `
    DELETE FROM notifications
    WHERE (COALESCE(title, '') || ' ' || COALESCE(message, '')) ~ ${TOKEN_OF_ID}
    `,
    [asId(userId)],
  );
  return result.rowCount || 0;
};

module.exports = {
  MENTION_PLACEHOLDER,
  scrubMentionLabels,
  deleteNotificationsMentioning,
};
