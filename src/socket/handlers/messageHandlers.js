const db = require("../../config/database");
const userModel = require("../../models/userModel");
const { createNotification } = require("../../controllers/notificationController");
const { validateChatFileUrl } = require("../../utils/fileValidation");
const {
  replySnapshotSelfColumns,
  buildReplyTo,
} = require("../../utils/replySnapshot");
const {
  getChatFileExpiresAt,
  getBlockedUserRooms,
  isCurrentTeamMember,
  userExists,
  canAccessReplyMessage,
} = require("../access");

const registerMessageHandlers = (io, socket, userId) => {
  // Handle new message
  socket.on("message:new", async (data) => {
    try {
      const {
        conversationId,
        content,
        type = "direct",
        imageUrl,
        fileUrl,
        fileName,
        replyToId,
      } = data;

      // Allow content OR imageUrl OR fileUrl
      if ((!content || content.trim() === "") && !imageUrl && !fileUrl) {
        socket.emit("error", { message: "Invalid message data" });
        return;
      }

      // Variables to store file metadata
      let fileSize = null;
      let fileExpiresAt = null;

      // Validate image URL and extract metadata
      if (imageUrl) {
        const validation = await validateChatFileUrl(imageUrl, "chatImage");
        if (!validation.valid) {
          console.warn(
            `[SOCKET] Rejected image from user ${userId}: ${validation.error}`,
          );
          socket.emit("error", { message: validation.error });
          return;
        }
        fileSize = validation.size || null;
        fileExpiresAt = getChatFileExpiresAt();
      }

      // Validate file URL and extract metadata
      if (fileUrl) {
        const validation = await validateChatFileUrl(fileUrl, "chatFile");
        if (!validation.valid) {
          console.warn(
            `[SOCKET] Rejected file from user ${userId}: ${validation.error}`,
          );
          socket.emit("error", { message: validation.error });
          return;
        }
        fileSize = validation.size || null;
        fileExpiresAt = getChatFileExpiresAt();
      }

      const senderResult = await db.query(
        `SELECT username, first_name, last_name FROM users WHERE id = $1`,
        [userId],
      );
      const sender = senderResult.rows[0] || {};
      let messageResult;
      let replyTo = null;

      if (type === "team") {
        const canAccessTeam = await isCurrentTeamMember(conversationId, userId);
        if (!canAccessTeam) {
          socket.emit("error", { message: "Not authorized to send messages to this team" });
          return;
        }

        const canReply = await canAccessReplyMessage({
          replyToId,
          userId,
          conversationId,
          type: "team",
        });

        if (!canReply) {
          socket.emit("error", { message: "Not authorized to reply to this message" });
          return;
        }

        messageResult = await db.query(
          `INSERT INTO messages (sender_id, team_id, content, reply_to_id, image_url, file_url, file_name, file_size, file_expires_at, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id, sender_id, team_id, content, reply_to_id, image_url, file_url, file_name, file_size, file_expires_at, sent_at`,
          [
            userId,
            conversationId,
            content?.trim() || null,
            replyToId || null,
            imageUrl || null,
            fileUrl || null,
            fileName || null,
            fileSize,
            fileExpiresAt,
          ],
        );

        if (replyToId) {
          const replyResult = await db.query(
            `SELECT ${replySnapshotSelfColumns}
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
             WHERE m.id = $1`,
            [replyToId],
          );

          if (replyResult.rows.length > 0) {
            replyTo = buildReplyTo(replyResult.rows[0]);
          }
        }

        const recipientCountResult = await db.query(
          `SELECT COUNT(*)::int as recipient_count
           FROM team_members
           WHERE team_id = $1
             AND user_id != $2`,
          [conversationId, userId],
        );

        const message = {
          id: messageResult.rows[0].id,
          conversationId: String(conversationId),
          teamId: parseInt(conversationId),
          senderId: userId,
          senderUsername: sender.username || socket.username,
          senderFirstName: sender.first_name,
          senderLastName: sender.last_name,
          content: messageResult.rows[0].content,
          replyToId: messageResult.rows[0].reply_to_id,
          replyTo,
          imageUrl: messageResult.rows[0].image_url,
          fileUrl: messageResult.rows[0].file_url,
          fileName: messageResult.rows[0].file_name,
          fileSize: messageResult.rows[0].file_size,
          fileExpiresAt: messageResult.rows[0].file_expires_at,
          createdAt: messageResult.rows[0].sent_at,
          readCount: 0,
          recipientCount:
            Number(recipientCountResult.rows[0]?.recipient_count) || 0,
          type: "team",
        };

        const blockedRooms = await getBlockedUserRooms(userId);
        const teamEmitter =
          blockedRooms.length > 0
            ? io.to(`team:${conversationId}`).except(blockedRooms)
            : io.to(`team:${conversationId}`);
        teamEmitter.emit("message:received", message);
      } else {
        const recipientExists = await userExists(conversationId);
        if (!recipientExists) {
          socket.emit("error", { message: "Recipient not found" });
          return;
        }

        if (await userModel.isBlockedBetween(userId, conversationId)) {
          socket.emit("error", {
            message: "You can no longer message this user",
          });
          return;
        }

        const canReply = await canAccessReplyMessage({
          replyToId,
          userId,
          conversationId,
          type: "direct",
        });

        if (!canReply) {
          socket.emit("error", { message: "Not authorized to reply to this message" });
          return;
        }

        messageResult = await db.query(
          `INSERT INTO messages (sender_id, receiver_id, content, reply_to_id, image_url, file_url, file_name, file_size, file_expires_at, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id, sender_id, receiver_id, content, reply_to_id, image_url, file_url, file_name, file_size, file_expires_at, sent_at`,
          [
            userId,
            conversationId,
            content?.trim() || null,
            replyToId || null,
            imageUrl || null,
            fileUrl || null,
            fileName || null,
            fileSize,
            fileExpiresAt,
          ],
        );

        if (replyToId) {
          const replyResult = await db.query(
            `SELECT ${replySnapshotSelfColumns}
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
             WHERE m.id = $1`,
            [replyToId],
          );

          if (replyResult.rows.length > 0) {
            replyTo = buildReplyTo(replyResult.rows[0]);
          }
        }

        const message = {
          id: messageResult.rows[0].id,
          conversationId: String(conversationId),
          senderId: userId,
          senderUsername: sender.username || socket.username,
          senderFirstName: sender.first_name,
          senderLastName: sender.last_name,
          content: messageResult.rows[0].content,
          replyToId: messageResult.rows[0].reply_to_id,
          replyTo,
          imageUrl: messageResult.rows[0].image_url,
          fileUrl: messageResult.rows[0].file_url,
          fileName: messageResult.rows[0].file_name,
          fileSize: messageResult.rows[0].file_size,
          fileExpiresAt: messageResult.rows[0].file_expires_at,
          createdAt: messageResult.rows[0].sent_at,
          type: "direct",
        };

        io.to(`user:${userId}`).emit("message:received", message);
        io.to(`user:${conversationId}`).emit("message:received", message);
      }

      // Notify mentioned users
      if (content) {
        const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;
        const senderName =
          `${sender.first_name || ""} ${sender.last_name || ""}`.trim() ||
          sender.username ||
          "Someone";
        let mentionMatch;
        const notified = new Set();

        // Expand @all into every participant except the sender
        if (content.includes("@[all](all)")) {
          let allUserIds = [];
          if (type === "team") {
            const allMembersResult = await db.query(
              `SELECT user_id FROM team_members WHERE team_id = $1 AND user_id != $2`,
              [conversationId, userId],
            );
            allUserIds = allMembersResult.rows.map((r) => String(r.user_id));
          } else {
            allUserIds = [String(conversationId)];
          }
          for (const uid of allUserIds) notified.add(uid);
        }

        // Collect individual mentions
        while ((mentionMatch = MENTION_RE.exec(content)) !== null) {
          const mentionedUserId = mentionMatch[2];
          if (mentionedUserId === "all" || mentionedUserId === String(userId)) continue;
          notified.add(mentionedUserId);
        }

        for (const mentionedUserId of notified) {
          try {
            if (type === "team") {
              const mentionedMember = await isCurrentTeamMember(
                conversationId,
                mentionedUserId,
              );
              if (!mentionedMember) continue;
            } else if (String(mentionedUserId) !== String(conversationId)) {
              continue;
            }

            await createNotification({
              userId: mentionedUserId,
              type: "message_mention",
              title: `${senderName} mentioned you`,
              message:
                content.length > 100 ? `${content.slice(0, 97)}…` : content,
              referenceType: type === "team" ? "team" : "direct",
              referenceId: messageResult.rows[0].id,
              teamId: type === "team" ? parseInt(conversationId) : null,
              actorId: userId,
            });
            io.to(`user:${mentionedUserId}`).emit("notification:new", {
              type: "message_mention",
              teamId: type === "team" ? parseInt(conversationId) : null,
              actorId: userId,
            });
          } catch (mentionErr) {
            console.error(
              `Error creating mention notification for ${mentionedUserId}:`,
              mentionErr,
            );
          }
        }
      }
    } catch (error) {
      console.error("Error handling new message:", error);
      socket.emit("error", { message: "Error sending message" });
    }
  });
};

module.exports = { registerMessageHandlers };
