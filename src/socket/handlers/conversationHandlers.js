const db = require("../../config/database");

const registerConversationHandlers = (io, socket, userId) => {
  // Handle joining a conversation
  socket.on("conversation:join", async (data) => {
    try {
      const conversationId =
        typeof data === "object" ? data.conversationId : data;

      const teamCheck = await db.query(
        `SELECT 1
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         WHERE tm.team_id = $1
           AND tm.user_id = $2`,
        [conversationId, userId],
      );

      if (teamCheck.rows.length > 0) {
        socket.join(`conversation:${conversationId}`);
        if (process.env.NODE_ENV !== "production") {
          console.log(`User ${userId} joined team conversation ${conversationId}`);
        }
        return;
      }

      const dmCheck = await db.query(
        `SELECT 1 FROM messages
         WHERE team_id IS NULL
           AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
         LIMIT 1`,
        [userId, conversationId],
      );

      if (dmCheck.rows.length > 0) {
        socket.join(`conversation:${conversationId}`);
        if (process.env.NODE_ENV !== "production") {
          console.log(`User ${userId} joined direct conversation ${conversationId}`);
        }
        return;
      }

      socket.emit("error", { message: "Not authorized to join this conversation" });
    } catch (error) {
      console.error("Error validating conversation join:", error);
      socket.emit("error", { message: "Error joining conversation" });
    }
  });

  // Handle leaving a conversation
  socket.on("conversation:leave", (data) => {
    const conversationId =
      typeof data === "object" ? data.conversationId : data;
    const type = typeof data === "object" ? data.type : "direct";

    socket.leave(`conversation:${conversationId}`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`User ${userId} left ${type} conversation ${conversationId}`);
    }
  });
};

module.exports = { registerConversationHandlers };
