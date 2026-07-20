const db = require("../../config/database");
const {
  getBlockedUserRooms,
  isCurrentTeamMember,
  hasDirectConversationAccess,
} = require("../access");

const registerReadHandlers = (io, socket, userId) => {
  // Handle message read status
  socket.on("message:read", async (data) => {
    try {
      const { conversationId, type = "direct" } = data;

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `User ${userId} marking ${type} messages as read in conversation ${conversationId}`,
        );
      }

      if (type === "team") {
        const canAccessTeam = await isCurrentTeamMember(conversationId, userId);
        if (!canAccessTeam) {
          socket.emit("error", { message: "Not authorized for this team conversation" });
          return;
        }

        const readStatusResult = await db.query(
          `WITH inserted_reads AS (
             INSERT INTO message_reads (message_id, user_id, read_at)
             SELECT m.id, $2, NOW()
             FROM messages m
             WHERE m.team_id = $1
               AND m.sender_id != $2
               AND NOT EXISTS (
                 SELECT 1
                 FROM message_reads mr
                 WHERE mr.message_id = m.id
                   AND mr.user_id = $2
               )
             ON CONFLICT (message_id, user_id) DO NOTHING
             RETURNING message_id, read_at
           )
           SELECT
             m.id as message_id,
             COALESCE(read_stats.read_count, 0)::int as read_count,
             COALESCE(recipient_stats.recipient_count, 0)::int as recipient_count,
             read_stats.first_read_at,
             COALESCE(read_stats.read_by_users, '[]'::jsonb) as read_by_users
           FROM inserted_reads ir
           JOIN messages m ON m.id = ir.message_id
           LEFT JOIN LATERAL (
             SELECT
               COUNT(*)::int as read_count,
               MIN(mr.read_at) as first_read_at,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', u.id,
                     'username', u.username,
                     'firstName', u.first_name,
                     'lastName', u.last_name
                   )
                   ORDER BY mr.read_at
                 ) FILTER (WHERE u.id IS NOT NULL),
                 '[]'::jsonb
               ) as read_by_users
             FROM message_reads mr
             LEFT JOIN users u ON u.id = mr.user_id
             WHERE mr.message_id = m.id
               AND mr.user_id != m.sender_id
           ) read_stats ON TRUE
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int as recipient_count
             FROM team_members tm
             WHERE tm.team_id = m.team_id
               AND tm.user_id != m.sender_id
           ) recipient_stats ON TRUE`,
          [conversationId, userId],
        );

        // Emit read status update to the team room (excluding blocked users so
        // the reader's identity stays hidden from anyone they've blocked).
        if (readStatusResult.rows.length > 0) {
          const blockedRooms = await getBlockedUserRooms(userId);
          const readEmitter =
            blockedRooms.length > 0
              ? socket.to(`team:${conversationId}`).except(blockedRooms)
              : socket.to(`team:${conversationId}`);
          readEmitter.emit("message:status", {
            conversationId: String(conversationId),
            type: "team",
            readBy: userId,
            readAt: new Date().toISOString(),
            messageReadCounts: readStatusResult.rows.map((row) => ({
              messageId: row.message_id,
              readCount: Number(row.read_count) || 0,
              recipientCount: Number(row.recipient_count) || 0,
              firstReadAt: row.first_read_at,
              readByUsers: row.read_by_users || [],
            })),
          });
        }
      } else {
        const canAccessDirect = await hasDirectConversationAccess(userId, conversationId);
        if (!canAccessDirect) {
          socket.emit("error", { message: "Not authorized for this direct conversation" });
          return;
        }

        // Mark direct messages as read
        await db.query(
          `UPDATE messages
           SET read_at = NOW()
           WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL`,
          [userId, conversationId],
        );

        // Emit read status update to the sender
        socket.to(`user:${conversationId}`).emit("message:status", {
          conversationId: String(userId),
          type: "direct",
          readBy: userId,
          readAt: new Date().toISOString(),
        });
      }

      // IMPORTANT: Emit to the current user so their Navbar can update the unread count
      socket.emit("messages:read", {
        conversationId: String(conversationId),
        type: type,
        readAt: new Date().toISOString(),
      });

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `Messages marked as read for ${type} conversation ${conversationId}`,
        );
      }
    } catch (error) {
      console.error("Error handling message read status:", error);
    }
  });
};

module.exports = { registerReadHandlers };
