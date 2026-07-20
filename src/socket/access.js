const db = require("../config/database");
const userModel = require("../models/userModel");

const CHAT_FILE_RETENTION_DAYS = 60;

const getChatFileExpiresAt = () =>
  new Date(Date.now() + CHAT_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

// Socket rooms (`user:<id>`) to exclude when delivering `senderId`'s realtime
// events, so blocked users never see each other's messages/typing in team chats.
const getBlockedUserRooms = async (senderId) => {
  const ids = await userModel.getBlockRelationshipIds(senderId);
  return ids.map((id) => `user:${id}`);
};

const isCurrentTeamMember = async (teamId, userId) => {
  const result = await db.query(
    `SELECT 1
     FROM team_members tm
     WHERE tm.team_id = $1
       AND tm.user_id = $2
     LIMIT 1`,
    [teamId, userId],
  );

  return result.rows.length > 0;
};

const hasDirectConversationAccess = async (userId, conversationId) => {
  // A block (either direction) revokes access to the DM conversation entirely.
  if (await userModel.isBlockedBetween(userId, conversationId)) {
    return false;
  }

  const result = await db.query(
    `SELECT 1
     FROM messages
     WHERE team_id IS NULL
       AND (
         (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
       )
     LIMIT 1`,
    [userId, conversationId],
  );

  return result.rows.length > 0;
};

const userExists = async (userId) => {
  const result = await db.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  return result.rows.length > 0;
};

const canAccessReplyMessage = async ({ replyToId, userId, conversationId, type }) => {
  if (!replyToId) return true;

  const result =
    type === "team"
      ? await db.query(
          `SELECT 1
           FROM messages
           WHERE id = $1
             AND team_id = $2
           LIMIT 1`,
          [replyToId, conversationId],
        )
      : await db.query(
          `SELECT 1
           FROM messages
           WHERE id = $1
             AND team_id IS NULL
             AND (
               (sender_id = $2 AND receiver_id = $3)
               OR (sender_id = $3 AND receiver_id = $2)
             )
           LIMIT 1`,
          [replyToId, userId, conversationId],
        );

  return result.rows.length > 0;
};

module.exports = {
  CHAT_FILE_RETENTION_DAYS,
  getChatFileExpiresAt,
  getBlockedUserRooms,
  isCurrentTeamMember,
  hasDirectConversationAccess,
  userExists,
  canAccessReplyMessage,
};
