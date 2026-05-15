const db = require("../config/database");

const getSender = async (senderId) => {
  if (!senderId) return {};

  const senderResult = await db.query(
    `SELECT username, first_name, last_name FROM users WHERE id = $1`,
    [senderId],
  );

  return senderResult.rows[0] || {};
};

const emitInsertedMessage = async (req, messageRow) => {
  const io = req?.app?.get?.("io");
  if (!io || !messageRow) return;

  const sender = await getSender(messageRow.sender_id);
  const isTeamMessage = Boolean(messageRow.team_id);
  const conversationId = isTeamMessage
    ? messageRow.team_id
    : messageRow.receiver_id;

  const message = {
    id: messageRow.id,
    conversationId: String(conversationId),
    teamId: messageRow.team_id ? Number(messageRow.team_id) : null,
    senderId: messageRow.sender_id,
    senderUsername: sender.username,
    senderFirstName: sender.first_name,
    senderLastName: sender.last_name,
    content: messageRow.content,
    createdAt: messageRow.sent_at,
    type: isTeamMessage ? "team" : "direct",
  };

  if (isTeamMessage) {
    io.to(`team:${messageRow.team_id}`).emit("message:received", message);
    return;
  }

  io.to(`user:${messageRow.sender_id}`).emit("message:received", message);
  io.to(`user:${messageRow.receiver_id}`).emit("message:received", message);
};

module.exports = {
  emitInsertedMessage,
};
