const { initScheduledJobs } = require("./jobs/fileCleanupScheduler");
const { validateChatFileUrl } = require("./utils/fileValidation");

require("dotenv").config();

// Fail-closed security check (runs before any DB/job side effects): Turnstile
// CAPTCHA on registration and the contact form is gated on TURNSTILE_SECRET_KEY
// (see authController/contactController). If the key is missing, that protection
// silently turns off (fail-open). In production, refuse to start so a
// misconfigured deploy is caught immediately instead of running without CAPTCHA.
// Non-production keeps the feature-flag behaviour (key optional → local dev runs
// without it).
if (process.env.NODE_ENV === "production" && !process.env.TURNSTILE_SECRET_KEY) {
  console.error(
    "FATAL: TURNSTILE_SECRET_KEY is not set in production — CAPTCHA protection " +
      "on registration and the contact form would be silently disabled. " +
      "Set TURNSTILE_SECRET_KEY and redeploy. Refusing to start.",
  );
  process.exit(1);
}

const app = require("./app");
const http = require("http");
const socketIo = require("socket.io");
const { verifyToken } = require("./utils/jwtUtils");
const { getTokenFromCookieHeader } = require("./utils/authCookie");
const { isTokenStillValidForUser } = require("./middlewares/auth");
const { isAllowedOrigin } = require("./utils/allowedOrigins");
const db = require("./config/database");
const userModel = require("./models/userModel");
const PORT = process.env.PORT || 5001;

// Socket rooms (`user:<id>`) to exclude when delivering `senderId`'s realtime
// events, so blocked users never see each other's messages/typing in team chats.
const getBlockedUserRooms = async (senderId) => {
  const ids = await userModel.getBlockRelationshipIds(senderId);
  return ids.map((id) => `user:${id}`);
};

const CHAT_FILE_RETENTION_DAYS = 60;

const getChatFileExpiresAt = () =>
  new Date(Date.now() + CHAT_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

const isActiveTeamMember = async (teamId, userId) => {
  const result = await db.query(
    `SELECT 1
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.team_id = $1
       AND tm.user_id = $2
       AND t.archived_at IS NULL
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

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Make io accessible to controllers via req.app.get("io")
app.set("io", io);

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  // Prefer the httpOnly session cookie sent with the handshake; fall back to
  // an explicit auth token (backward compatibility / non-browser clients).
  const token =
    getTokenFromCookieHeader(socket.handshake.headers.cookie) ||
    socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error: Token missing"));
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return next(new Error("Authentication error: Invalid token"));
  }

  // Reject tokens issued before the user's last password change, matching the
  // HTTP auth middleware so a stale token cannot open a realtime connection.
  try {
    if (!(await isTokenStillValidForUser(decoded))) {
      return next(new Error("Authentication error: Session expired"));
    }
  } catch (error) {
    console.error("Socket auth validity check failed:", error);
    return next(new Error("Authentication error"));
  }

  // Store user info in socket object
  socket.userId = decoded.id;
  socket.username = decoded.username;
  next();
});

// Connected users map: userId -> socketId
const connectedUsers = new Map();

// Socket.IO connection handling
io.on("connection", (socket) => {
  const userId = socket.userId;
  if (process.env.NODE_ENV !== "production") {
    console.log(`User connected: ${userId} (${socket.username})`);
  }

  // Store user connection
  connectedUsers.set(userId, socket.id);

  // Join user to their own room for private messages
  socket.join(`user:${userId}`);

  // Join user to all their team rooms
  const joinUserTeams = async () => {
    try {
      const userTeamsResult = await db.query(
        `SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1`,
        [userId],
      );

      for (const row of userTeamsResult.rows) {
        const teamId = row.team_id;
        socket.join(`team:${teamId}`);
        if (process.env.NODE_ENV !== "production") {
          console.log(`User ${userId} joined team room: team:${teamId}`);
        }
      }
    } catch (error) {
      console.error("Error joining user teams:", error);
    }
  };

  joinUserTeams();

  // Emit online users to all clients
  io.emit("users:online", Array.from(connectedUsers.keys()));

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
           AND tm.user_id = $2
           AND t.archived_at IS NULL`,
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
        const canAccessTeam = await isActiveTeamMember(conversationId, userId);
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
            `SELECT m.id, m.content, m.sender_id,
                    u.username, u.first_name
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
             WHERE m.id = $1`,
            [replyToId],
          );

          if (replyResult.rows.length > 0) {
            const r = replyResult.rows[0];
            replyTo = {
              id: r.id,
              content: r.content ? r.content.slice(0, 150) : null,
              senderId: r.sender_id,
              senderUsername: r.username,
              senderFirstName: r.first_name,
            };
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
            `SELECT m.id, m.content, m.sender_id,
                    u.username, u.first_name
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
             WHERE m.id = $1`,
            [replyToId],
          );

          if (replyResult.rows.length > 0) {
            const r = replyResult.rows[0];
            replyTo = {
              id: r.id,
              content: r.content ? r.content.slice(0, 150) : null,
              senderId: r.sender_id,
              senderUsername: r.username,
              senderFirstName: r.first_name,
            };
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
        const { createNotification } = require("./controllers/notificationController");
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
              const mentionedMember = await isActiveTeamMember(
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

  // Handle typing indicator - start
  socket.on("typing:start", async (data) => {
    const { conversationId, type = "direct" } = data;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `User ${userId} started typing in ${type} conversation ${conversationId}`,
      );
    }

    if (type === "team") {
      const canAccessTeam = await isActiveTeamMember(conversationId, userId);
      if (!canAccessTeam) {
        socket.emit("error", { message: "Not authorized for this team conversation" });
        return;
      }

      // For team messages, broadcast to all team members except sender and
      // anyone in a block relationship with the typing user.
      const blockedRooms = await getBlockedUserRooms(userId);
      const typingEmitter =
        blockedRooms.length > 0
          ? socket.to(`team:${conversationId}`).except(blockedRooms)
          : socket.to(`team:${conversationId}`);
      typingEmitter.emit("typing:update", {
        conversationId: String(conversationId),
        userId,
        username: socket.username,
        isTyping: true,
        type: "team",
      });
    } else {
      const canAccessDirect = await hasDirectConversationAccess(userId, conversationId);
      if (!canAccessDirect) {
        socket.emit("error", { message: "Not authorized for this direct conversation" });
        return;
      }

      // For direct messages
      socket.to(`user:${conversationId}`).emit("typing:update", {
        conversationId: String(userId),
        userId,
        username: socket.username,
        isTyping: true,
        type: "direct",
      });
    }
  });

  // Handle typing indicator - stop
  socket.on("typing:stop", async (data) => {
    const { conversationId, type = "direct" } = data;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `User ${userId} stopped typing in ${type} conversation ${conversationId}`,
      );
    }

    if (type === "team") {
      const canAccessTeam = await isActiveTeamMember(conversationId, userId);
      if (!canAccessTeam) {
        socket.emit("error", { message: "Not authorized for this team conversation" });
        return;
      }

      // For team messages, broadcast to all team members except sender and
      // anyone in a block relationship with the typing user.
      const blockedRooms = await getBlockedUserRooms(userId);
      const typingEmitter =
        blockedRooms.length > 0
          ? socket.to(`team:${conversationId}`).except(blockedRooms)
          : socket.to(`team:${conversationId}`);
      typingEmitter.emit("typing:update", {
        conversationId: String(conversationId),
        userId,
        username: socket.username,
        isTyping: false,
        type: "team",
      });
    } else {
      const canAccessDirect = await hasDirectConversationAccess(userId, conversationId);
      if (!canAccessDirect) {
        socket.emit("error", { message: "Not authorized for this direct conversation" });
        return;
      }

      // For direct messages
      socket.to(`user:${conversationId}`).emit("typing:update", {
        conversationId: String(userId),
        userId,
        username: socket.username,
        isTyping: false,
        type: "direct",
      });
    }
  });

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
        const canAccessTeam = await isActiveTeamMember(conversationId, userId);
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

  // Handle disconnection
  socket.on("disconnect", () => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`User disconnected: ${userId}`);
    }
    connectedUsers.delete(userId);

    // Emit updated online users
    io.emit("users:online", Array.from(connectedUsers.keys()));
  });
});

// Initialize scheduled jobs
initScheduledJobs();

const cleanupUnverifiedAccounts = require("./jobs/cleanupUnverifiedAccounts");
cleanupUnverifiedAccounts();
cleanupUnverifiedAccounts.purgeExpiredUnverifiedAccounts().catch((error) => {
  console.error("[Cleanup] Error cleaning up unverified accounts on startup:", error);
});

const cleanupArchivedTeams = require("./jobs/cleanupArchivedTeams");
cleanupArchivedTeams();
cleanupArchivedTeams.purgeExpiredArchivedTeams().catch((error) => {
  console.error("[Cleanup] Error cleaning up archived teams on startup:", error);
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} with Socket.IO enabled`);
});
