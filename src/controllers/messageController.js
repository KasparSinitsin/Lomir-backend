const db = require("../config/database");
const {
  deleteImageKitFile,
  isImageKitUrl,
} = require("../utils/imagekitUtils");
const { validateChatFileUrl } = require("../utils/fileValidation");
const userModel = require("../models/userModel");

const CHAT_FILE_RETENTION_DAYS = 60;

const getChatFileExpiresAt = () =>
  new Date(Date.now() + CHAT_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

const validateMessageFileInputs = async ({ imageUrl, fileUrl }) => {
  let fileSize = null;
  let fileExpiresAt = null;

  if (imageUrl) {
    const validation = await validateChatFileUrl(imageUrl, "chatImage");
    if (!validation.valid) {
      return { valid: false, message: validation.error };
    }
    fileSize = validation.size || null;
    fileExpiresAt = getChatFileExpiresAt();
  }

  if (fileUrl) {
    const validation = await validateChatFileUrl(fileUrl, "chatFile");
    if (!validation.valid) {
      return { valid: false, message: validation.error };
    }
    fileSize = validation.size || null;
    fileExpiresAt = getChatFileExpiresAt();
  }

  return { valid: true, fileSize, fileExpiresAt };
};

const ensureTeamMessageAccess = async (teamId, userId) => {
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

const ensureReplyMessageAccess = async ({ replyToId, userId, conversationId, type }) => {
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

const emitMessageReceived = async (req, messageRow, type, conversationId) => {
  const io = req.app.get("io");
  if (!io || !messageRow) return;

  const senderResult = await db.query(
    `SELECT username, first_name, last_name FROM users WHERE id = $1`,
    [messageRow.sender_id],
  );
  const sender = senderResult.rows[0] || {};
  const baseMessage = {
    id: messageRow.id,
    conversationId: String(conversationId),
    senderId: messageRow.sender_id,
    senderUsername: sender.username,
    senderFirstName: sender.first_name,
    senderLastName: sender.last_name,
    content: messageRow.content,
    replyToId: messageRow.reply_to_id,
    imageUrl: messageRow.image_url,
    fileUrl: messageRow.file_url,
    fileName: messageRow.file_name,
    createdAt: messageRow.sent_at,
    type,
  };

  if (type === "team") {
    const recipientCountResult = await db.query(
      `SELECT COUNT(*)::int AS recipient_count
       FROM team_members
       WHERE team_id = $1
         AND user_id != $2`,
      [conversationId, messageRow.sender_id],
    );

    io.to(`team:${conversationId}`).emit("message:received", {
      ...baseMessage,
      teamId: parseInt(conversationId, 10),
      readCount: 0,
      recipientCount:
        Number(recipientCountResult.rows[0]?.recipient_count) || 0,
    });
    return;
  }

  io.to(`user:${messageRow.sender_id}`).emit("message:received", baseMessage);
  io.to(`user:${conversationId}`).emit("message:received", baseMessage);
};

const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const unreadResult = await db.query(
      `WITH direct_unread AS (
         SELECT
           sender_id AS conversation_id,
           'direct' AS type,
           COUNT(*) AS cnt,
           MAX(sent_at) AS latest
         FROM messages
         WHERE receiver_id = $1 AND read_at IS NULL AND team_id IS NULL AND deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM user_blocks ub
             WHERE (ub.blocker_id = messages.sender_id AND ub.blocked_id = $1)
                OR (ub.blocked_id = messages.sender_id AND ub.blocker_id = $1)
           )
         GROUP BY sender_id
       ),
       team_unread AS (
         SELECT
           m.team_id AS conversation_id,
           'team' AS type,
           COUNT(*) AS cnt,
           MAX(m.sent_at) AS latest
         FROM messages m
         JOIN team_members tm ON m.team_id = tm.team_id AND tm.user_id = $1
         WHERE m.sender_id != $1
           AND m.team_id IS NOT NULL
           AND m.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM message_reads mr
             WHERE mr.message_id = m.id
               AND mr.user_id = $1
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_blocks ub
             WHERE (ub.blocker_id = m.sender_id AND ub.blocked_id = $1)
                OR (ub.blocked_id = m.sender_id AND ub.blocker_id = $1)
           )
         GROUP BY m.team_id
       ),
       combined AS (
         SELECT * FROM direct_unread
         UNION ALL
         SELECT * FROM team_unread
       )
       SELECT
         COALESCE(SUM(cnt), 0)::int AS total_count,
         (SELECT conversation_id FROM combined ORDER BY latest DESC LIMIT 1) AS first_conversation_id,
         (SELECT type FROM combined ORDER BY latest DESC LIMIT 1) AS first_type,
         (SELECT COUNT(*)::int FROM team_unread) AS team_count,
         (SELECT COUNT(DISTINCT m.sender_id)::int
          FROM messages m
          WHERE (
                  (m.receiver_id = $1 AND m.read_at IS NULL AND m.team_id IS NULL AND m.deleted_at IS NULL)
               OR (m.team_id IS NOT NULL AND m.sender_id != $1 AND m.deleted_at IS NULL
                   AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = m.team_id AND tm.user_id = $1)
                   AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $1))
                )
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks ub
              WHERE (ub.blocker_id = m.sender_id AND ub.blocked_id = $1)
                 OR (ub.blocked_id = m.sender_id AND ub.blocker_id = $1)
            )
         ) AS sender_count
       FROM combined`,
      [userId],
    );

    const unreadRow = unreadResult.rows[0] || {};
    const totalUnreadCount = parseInt(unreadRow.total_count, 10) || 0;
    const firstUnread =
      totalUnreadCount > 0
        ? {
            conversationId: unreadRow.first_conversation_id,
            type: unreadRow.first_type,
          }
        : null;

    res.status(200).json({
      success: true,
      data: {
        count: totalUnreadCount,
        firstUnread,
        teamCount: parseInt(unreadRow.team_count, 10) || 0,
        senderCount: parseInt(unreadRow.sender_count, 10) || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching unread count",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// Start a conversation by sending the first message
const startConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { recipientId, initialMessage } = req.body;

    if (!recipientId) {
      return res.status(400).json({
        success: false,
        message: "Recipient ID is required",
      });
    }

    const senderId = parseInt(userId);
    const receiverId = parseInt(recipientId);

    // Check if recipient exists
    const recipientResult = await db.query(
      `SELECT id FROM users WHERE id = $1`,
      [receiverId],
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Recipient not found",
      });
    }

    if (await userModel.isBlockedBetween(senderId, receiverId)) {
      return res.status(403).json({
        success: false,
        message: "You can no longer message this user",
      });
    }

    // Only send a message if there's actual content
    if (initialMessage && initialMessage.trim() !== "") {
      await db.query(
        `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())`,
        [senderId, receiverId, initialMessage.trim()],
      );
    }

    // Always return success - the frontend will handle showing the conversation
    res.status(201).json({
      success: true,
      data: {
        conversationId: receiverId,
      },
    });
  } catch (error) {
    console.error("Error starting conversation:", error);
    res.status(500).json({
      success: false,
      message: "Error starting conversation",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// Get all conversations for current user
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all unique conversation partners for direct messages
    // Now includes unread_count per conversation
    const directMessagesQuery = `
      WITH conversation_partners AS (
        SELECT DISTINCT
          CASE 
            WHEN m.sender_id = $1 THEN m.receiver_id 
            ELSE m.sender_id 
          END as partner_id,
          MAX(m.sent_at) as last_message_time
        FROM messages m
        WHERE (m.sender_id = $1 OR m.receiver_id = $1) 
          AND m.team_id IS NULL
        GROUP BY partner_id
      ),
      latest_messages AS (
        SELECT 
          cp.partner_id,
          cp.last_message_time,
          m.content as last_message
        FROM conversation_partners cp
        JOIN messages m ON (
          ((m.sender_id = $1 AND m.receiver_id = cp.partner_id) OR 
           (m.sender_id = cp.partner_id AND m.receiver_id = $1)) 
          AND m.sent_at = cp.last_message_time
          AND m.team_id IS NULL
        )
      ),
      unread_counts AS (
        SELECT 
          sender_id as partner_id,
          COUNT(*) as unread_count
        FROM messages
        WHERE receiver_id = $1 
          AND read_at IS NULL
          AND team_id IS NULL
        GROUP BY sender_id
      )
      SELECT
        lm.partner_id as id,
        'direct' as type,
        u.username,
        u.first_name,
        u.last_name,
        u.avatar_url,
        u.is_synthetic,
        lm.last_message,
        lm.last_message_time as updated_at,
        COALESCE(uc.unread_count, 0) as unread_count
      FROM latest_messages lm
      JOIN users u ON lm.partner_id = u.id
      LEFT JOIN unread_counts uc ON lm.partner_id = uc.partner_id
      WHERE NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = $1 AND ub.blocked_id = lm.partner_id)
           OR (ub.blocked_id = $1 AND ub.blocker_id = lm.partner_id)
      )
      ORDER BY lm.last_message_time DESC
    `;

    // Get team conversations where user is a member
    // Now includes unread_count per team conversation
    const teamMessagesQuery = `
      WITH team_conversations AS (
        SELECT DISTINCT
          m.team_id,
          MAX(m.sent_at) as last_message_time
        FROM messages m
        JOIN team_members tm ON m.team_id = tm.team_id
        WHERE tm.user_id = $1 AND m.team_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = m.sender_id AND ub.blocked_id = $1)
               OR (ub.blocked_id = m.sender_id AND ub.blocker_id = $1)
          )
        GROUP BY m.team_id
      ),
      latest_team_messages AS (
        SELECT
          tc.team_id,
          tc.last_message_time,
          m.content as last_message
        FROM team_conversations tc
        JOIN messages m ON m.team_id = tc.team_id AND m.sent_at = tc.last_message_time
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = m.sender_id AND ub.blocked_id = $1)
               OR (ub.blocked_id = m.sender_id AND ub.blocker_id = $1)
          )
      ),
      team_unread_counts AS (
        SELECT
          m.team_id,
          COUNT(*) as unread_count
        FROM messages m
        JOIN team_members tm ON m.team_id = tm.team_id
        WHERE tm.user_id = $1
          AND m.sender_id != $1
          AND m.team_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM message_reads mr
            WHERE mr.message_id = m.id
              AND mr.user_id = $1
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = m.sender_id AND ub.blocked_id = $1)
               OR (ub.blocked_id = m.sender_id AND ub.blocker_id = $1)
          )
        GROUP BY m.team_id
      )
      SELECT 
        ltm.team_id as id,
        'team' as type,
        t.name,
        NULL as first_name,
        NULL as last_name,
        t.teamavatar_url as avatar_url,
        t.archived_at,
        t.status,
        ltm.last_message,
        ltm.last_message_time as updated_at,
        COALESCE(tuc.unread_count, 0) as unread_count
      FROM latest_team_messages ltm
      JOIN teams t ON ltm.team_id = t.id
      LEFT JOIN team_unread_counts tuc ON ltm.team_id = tuc.team_id
      -- Hide archived (deleted) teams where the viewer is the only remaining
      -- member: there is no one left who needs to see the deletion notice, so the
      -- chat should disappear. Archived teams with other members stay visible so
      -- those members still see the "team deleted" message until they leave.
      WHERE NOT (
        t.archived_at IS NOT NULL
        AND (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id) <= 1
      )
      ORDER BY ltm.last_message_time DESC
    `;

    const [directResult, teamResult] = await Promise.all([
      db.query(directMessagesQuery, [userId]),
      db.query(teamMessagesQuery, [userId]),
    ]);

    // Combine and format results
    const directConversations = directResult.rows.map((row) => ({
      id: row.id,
      type: "direct",
      partner: {
        id: row.id,
        username: row.username,
        firstName: row.first_name,
        lastName: row.last_name,
        avatarUrl: row.avatar_url,
        isSynthetic: row.is_synthetic,
        is_synthetic: row.is_synthetic,
      },
      lastMessage: row.last_message,
      updatedAt: row.updated_at,
      unreadCount: parseInt(row.unread_count) || 0,
    }));

    const teamConversations = teamResult.rows.map((row) => ({
      id: row.id,
      type: "team",
      team: {
        id: row.id,
        name: row.name,
        avatarUrl: row.avatar_url,
        archived_at: row.archived_at,
        archivedAt: row.archived_at,
        status: row.status,
      },
      lastMessage: row.last_message,
      updatedAt: row.updated_at,
      unreadCount: parseInt(row.unread_count) || 0,
    }));

    // Combine and sort by most recent
    const allConversations = [
      ...directConversations,
      ...teamConversations,
    ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.status(200).json({
      success: true,
      data: allConversations,
    });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching conversations",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// Get conversation by ID
const getConversationById = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const type = req.query.type || "direct";

    if (type === "team") {
      // Get team conversation details
      const teamQuery = `
        SELECT 
          t.id,
          t.name,
          t.teamavatar_url as avatar_url,
          t.archived_at,
          t.status,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', u.id,
                'userId', u.id,
                'user_id', u.id,
                'username', u.username,
                'firstName', u.first_name,
                'lastName', u.last_name,
                'avatarUrl', u.avatar_url,
                'role', tm_all.role
              )
              ORDER BY u.first_name, u.last_name, u.username
            ) FILTER (WHERE u.id IS NOT NULL),
            '[]'::jsonb
          ) as members
        FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        LEFT JOIN team_members tm_all ON t.id = tm_all.team_id
        LEFT JOIN users u ON tm_all.user_id = u.id
        WHERE t.id = $1 AND tm.user_id = $2
        GROUP BY t.id
      `;

      const teamResult = await db.query(teamQuery, [conversationId, userId]);

      if (teamResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Team conversation not found or access denied",
        });
      }

      const team = teamResult.rows[0];

      res.status(200).json({
        success: true,
        data: {
          id: team.id,
          type: "team",
          team: {
            id: team.id,
            name: team.name,
            avatarUrl: team.avatar_url,
            archived_at: team.archived_at,
            archivedAt: team.archived_at,
            status: team.status,
            members: team.members || [],
          },
        },
      });
    } else {
      if (await userModel.isBlockedBetween(userId, conversationId)) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found or access denied",
        });
      }

      const participantCheck = await db.query(
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

      if (participantCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found or access denied",
        });
      }

      // Get direct conversation partner details
      const userQuery = `
        SELECT
          id,
          username,
          first_name,
          last_name,
          avatar_url,
          is_synthetic
        FROM users
        WHERE id = $1
      `;

      const userResult = await db.query(userQuery, [conversationId]);

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const partner = userResult.rows[0];

      res.status(200).json({
        success: true,
        data: {
          id: partner.id,
          type: "direct",
          partner: {
            id: partner.id,
            username: partner.username,
            firstName: partner.first_name,
            lastName: partner.last_name,
            avatarUrl: partner.avatar_url,
            isSynthetic: partner.is_synthetic,
            is_synthetic: partner.is_synthetic,
          },
        },
      });
    }
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching conversation",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const type = req.query.type || "direct";
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.max(
      1,
      Math.min(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 200),
    );
    const parsedBefore = req.query.before
      ? parseInt(req.query.before, 10)
      : null;
    const before =
      Number.isInteger(parsedBefore) && parsedBefore > 0 ? parsedBefore : null;

    let messagesQuery;
    let queryParams;

    if (type === "team") {
      // Verify user is a team member
      const memberCheck = await db.query(
        `SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [conversationId, userId],
      );

      if (memberCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this team conversation",
        });
      }

      messagesQuery = `
    SELECT 
      m.id,
      m.sender_id,
      m.team_id,
      m.content,
      m.reply_to_id,
      m.image_url,
      m.file_url,
      m.file_name,
      m.file_size,
      m.file_expires_at,
      m.file_deleted_at,
      m.deleted_at,
      m.deleted_by,
      m.edited_at,
      m.edited_by,
      m.sent_at as created_at,
      m.read_at,
      current_user_read.read_at as current_user_read_at,
      COALESCE(read_stats.read_count, 0)::int as read_count,
      read_stats.first_read_at,
      COALESCE(read_stats.read_by_users, '[]'::jsonb) as read_by_users,
      COALESCE(recipient_stats.recipient_count, 0)::int as recipient_count,
      u.username as sender_username,
      u.first_name as sender_first_name,
      u.last_name as sender_last_name,
      u.avatar_url as sender_avatar_url,
      rm.id as reply_to_message_id,
      rm.content as reply_to_content,
      rm.sender_id as reply_to_sender_id,
      ru.username as reply_to_sender_username,
      ru.first_name as reply_to_sender_first_name
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    LEFT JOIN messages rm ON m.reply_to_id = rm.id
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ubr
        WHERE (ubr.blocker_id = rm.sender_id AND ubr.blocked_id = $2)
           OR (ubr.blocked_id = rm.sender_id AND ubr.blocker_id = $2)
      )
    LEFT JOIN users ru ON rm.sender_id = ru.id
    LEFT JOIN LATERAL (
      SELECT mr.read_at
      FROM message_reads mr
      WHERE mr.message_id = m.id
        AND mr.user_id = $2
      LIMIT 1
    ) current_user_read ON TRUE
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
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ubrd
          WHERE (ubrd.blocker_id = mr.user_id AND ubrd.blocked_id = $2)
             OR (ubrd.blocked_id = mr.user_id AND ubrd.blocker_id = $2)
        )
    ) read_stats ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int as recipient_count
      FROM team_members tm
      WHERE tm.team_id = m.team_id
        AND tm.user_id != m.sender_id
    ) recipient_stats ON TRUE
    WHERE m.team_id = $1
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = m.sender_id AND ub.blocked_id = $2)
           OR (ub.blocked_id = m.sender_id AND ub.blocker_id = $2)
      )
    ${before ? "AND m.id < $3" : ""}
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT $${before ? "4" : "3"}
  `;
      queryParams = before
        ? [conversationId, userId, before, limit]
        : [conversationId, userId, limit];
    } else {
      if (await userModel.isBlockedBetween(userId, conversationId)) {
        return res.status(403).json({
          success: false,
          message: "You can no longer view this conversation",
        });
      }

      messagesQuery = `
    SELECT
      m.id,
      m.sender_id,
      m.receiver_id,
      m.content,
      m.reply_to_id,
      m.image_url,
      m.file_url,
      m.file_name,
      m.file_size,
      m.file_expires_at,
      m.file_deleted_at,
      m.deleted_at,
      m.deleted_by,
      m.edited_at,
      m.edited_by,
      m.sent_at as created_at,
      m.read_at,
      u.username as sender_username,
      u.first_name as sender_first_name,
      u.last_name as sender_last_name,
      u.avatar_url as sender_avatar_url,
      rm.id as reply_to_message_id,
      rm.content as reply_to_content,
      rm.sender_id as reply_to_sender_id,
      ru.username as reply_to_sender_username,
      ru.first_name as reply_to_sender_first_name
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    LEFT JOIN messages rm ON m.reply_to_id = rm.id
    LEFT JOIN users ru ON rm.sender_id = ru.id
    WHERE ((m.sender_id = $1 AND m.receiver_id = $2) 
       OR (m.sender_id = $2 AND m.receiver_id = $1))
      AND m.team_id IS NULL
      ${before ? "AND m.id < $3" : ""}
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT $${before ? "4" : "3"}
  `;
      queryParams = before
        ? [userId, conversationId, before, limit]
        : [userId, conversationId, limit];
    }

    const result = await db.query(messagesQuery, queryParams);
    const hasMore = result.rows.length === limit;
    result.rows.reverse();

    const messages = result.rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      teamId: row.team_id,
      content: row.content,
      replyToId: row.reply_to_id,
      replyTo: row.reply_to_message_id
        ? {
            id: row.reply_to_message_id,
            content: row.reply_to_content
              ? row.reply_to_content.slice(0, 150)
              : null,
            senderId: row.reply_to_sender_id,
            senderUsername: row.reply_to_sender_username,
            senderFirstName: row.reply_to_sender_first_name,
          }
        : null,
      imageUrl: row.image_url,
      fileUrl: row.file_url,
      fileName: row.file_name,
      fileSize: row.file_size,
      fileExpiresAt: row.file_expires_at,
      fileDeletedAt: row.file_deleted_at,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      editedAt: row.edited_at,
      editedBy: row.edited_by,
      isEdited: Boolean(row.edited_at),
      createdAt: row.created_at,
      readAt:
        row.team_id && Number(row.sender_id) !== Number(userId)
          ? row.current_user_read_at
          : row.first_read_at || row.read_at,
      readCount: parseInt(row.read_count, 10) || 0,
      recipientCount: parseInt(row.recipient_count, 10) || 0,
      readByUsers: row.read_by_users || [],
      senderUsername: row.sender_username,
      senderFirstName: row.sender_first_name,
      senderLastName: row.sender_last_name,
      senderAvatarUrl: row.sender_avatar_url,
    }));

    res.status(200).json({
      success: true,
      data: messages,
      hasMore,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const {
      content,
      type,
      imageUrl,
      fileUrl,
      fileName,
      replyToId: bodyReplyToId,
      reply_to_id: bodyReplyToIdSnake,
    } = req.body;
    const replyToId = bodyReplyToId || bodyReplyToIdSnake || null;
    const messageType = type === "team" ? "team" : "direct";

    // Allow content OR imageUrl OR fileUrl (or combinations)
    if ((!content || content.trim() === "") && !imageUrl && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: "Message content, image, or file is required",
      });
    }

    const fileValidation = await validateMessageFileInputs({ imageUrl, fileUrl });
    if (!fileValidation.valid) {
      return res.status(400).json({
        success: false,
        message: fileValidation.message,
      });
    }

    if (messageType === "team") {
      const canAccessTeam = await ensureTeamMessageAccess(conversationId, userId);
      if (!canAccessTeam) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to send messages to this team",
        });
      }
    } else {
      const recipientResult = await db.query(
        `SELECT id FROM users WHERE id = $1`,
        [conversationId],
      );

      if (recipientResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Recipient not found",
        });
      }

      if (await userModel.isBlockedBetween(userId, conversationId)) {
        return res.status(403).json({
          success: false,
          message: "You can no longer message this user",
        });
      }
    }

    const replyAllowed = await ensureReplyMessageAccess({
      replyToId,
      userId,
      conversationId,
      type: messageType,
    });

    if (!replyAllowed) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to reply to this message",
      });
    }

    let messageResult;

    if (messageType === "team") {
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
          fileValidation.fileSize,
          fileValidation.fileExpiresAt,
        ],
      );
    } else {
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
          fileValidation.fileSize,
          fileValidation.fileExpiresAt,
        ],
      );
    }

    await emitMessageReceived(
      req,
      messageResult.rows[0],
      messageType,
      conversationId,
    );

    res.status(201).json({
      success: true,
      data: messageResult.rows[0],
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      success: false,
      message: "Error sending message",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const getMessageById = async (req, res) => {
  try {
    const messageId = req.params.id;

    const messageQuery = `
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.team_id,
        m.content,
        m.reply_to_id,
        m.sent_at,
        m.read_at,
        u.username as sender_username,
        rm.id as reply_to_message_id,
        rm.content as reply_to_content,
        rm.sender_id as reply_to_sender_id,
        ru.username as reply_to_sender_username,
        ru.first_name as reply_to_sender_first_name
      FROM messages m
      LEFT JOIN users u ON m.sender_id = u.id
      LEFT JOIN messages rm ON m.reply_to_id = rm.id
      LEFT JOIN users ru ON rm.sender_id = ru.id
      WHERE m.id = $1
    `;

    const result = await db.query(messageQuery, [messageId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const row = result.rows[0];
    const currentUserId = Number(req.user?.id ?? req.userId);

    if (row.team_id) {
      const memberCheck = await db.query(
        'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
        [row.team_id, currentUserId],
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this message',
        });
      }
    } else {
      if (Number(row.sender_id) !== currentUserId &&
          Number(row.receiver_id) !== currentUserId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this message',
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...row,
        replyTo: row.reply_to_message_id
          ? {
              id: row.reply_to_message_id,
              content: row.reply_to_content
                ? row.reply_to_content.slice(0, 150)
                : null,
              senderId: row.reply_to_sender_id,
              senderUsername: row.reply_to_sender_username,
              senderFirstName: row.reply_to_sender_first_name,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching message:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching message",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const updateMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const currentUserId = req.user?.id ?? req.userId;
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

    if (!content) {
      return res.status(400).json({ message: "Message content is required" });
    }

    if (content.length > 500) {
      return res.status(400).json({ message: "Message content is too long" });
    }

    const msgResult = await db.query(
      `SELECT id, sender_id, receiver_id, team_id, deleted_at
       FROM messages
       WHERE id = $1`,
      [messageId],
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ message: "Message not found" });
    }

    const msg = msgResult.rows[0];

    if (Number(msg.sender_id) !== Number(currentUserId)) {
      return res
        .status(403)
        .json({ message: "Not authorized to edit this message" });
    }

    if (msg.team_id) {
      const canAccessTeam = await ensureTeamMessageAccess(msg.team_id, currentUserId);
      if (!canAccessTeam) {
        return res
          .status(403)
          .json({ message: "Not authorized to edit this message" });
      }
    }

    if (msg.deleted_at) {
      return res.status(400).json({ message: "Cannot edit a deleted message" });
    }

    const updateResult = await db.query(
      `UPDATE messages
       SET content = $2,
           edited_at = NOW(),
           edited_by = $3
       WHERE id = $1
       RETURNING id, sender_id, receiver_id, team_id, content, edited_at, edited_by`,
      [messageId, content, currentUserId],
    );

    const updatedMessage = updateResult.rows[0];
    const latestMessageResult = updatedMessage.team_id
      ? await db.query(
          `SELECT id
           FROM messages
           WHERE team_id = $1
           ORDER BY sent_at DESC, id DESC
           LIMIT 1`,
          [updatedMessage.team_id],
        )
      : await db.query(
          `SELECT id
           FROM messages
           WHERE team_id IS NULL
             AND (
               (sender_id = $1 AND receiver_id = $2)
               OR (sender_id = $2 AND receiver_id = $1)
             )
           ORDER BY sent_at DESC, id DESC
           LIMIT 1`,
          [updatedMessage.sender_id, updatedMessage.receiver_id],
        );
    const isLatestMessage =
      String(latestMessageResult.rows[0]?.id) === String(updatedMessage.id);
    const payload = {
      messageId: Number(updatedMessage.id),
      conversationId: updatedMessage.team_id
        ? String(updatedMessage.team_id)
        : String(
            Number(updatedMessage.sender_id) === Number(currentUserId)
              ? updatedMessage.receiver_id
              : updatedMessage.sender_id,
          ),
      content: updatedMessage.content,
      editedAt: updatedMessage.edited_at,
      editedBy: Number(updatedMessage.edited_by),
      isEdited: true,
      type: updatedMessage.team_id ? "team" : "direct",
      teamId: updatedMessage.team_id ? Number(updatedMessage.team_id) : null,
      senderId: updatedMessage.sender_id ? Number(updatedMessage.sender_id) : null,
      receiverId: updatedMessage.receiver_id
        ? Number(updatedMessage.receiver_id)
        : null,
      isLatestMessage,
    };

    const io = req.app.get("io");

    if (io) {
      if (updatedMessage.team_id) {
        io.to(`team:${updatedMessage.team_id}`).emit("message:edited", payload);
      } else {
        io.to(`user:${updatedMessage.sender_id}`).emit("message:edited", payload);
        io.to(`user:${updatedMessage.receiver_id}`).emit("message:edited", payload);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        id: updatedMessage.id,
        senderId: updatedMessage.sender_id,
        receiverId: updatedMessage.receiver_id,
        teamId: updatedMessage.team_id,
        content: updatedMessage.content,
        editedAt: updatedMessage.edited_at,
        editedBy: updatedMessage.edited_by,
        isEdited: true,
        isLatestMessage,
      },
    });
  } catch (error) {
    console.error("updateMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to edit message",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.id;

    // If authenticateToken sets req.user = { id, ... }, use req.user.id
    // If it sets req.userId, use req.userId
    const currentUserId = req.user?.id ?? req.userId;

    // 1) Fetch message first (so we know whether it’s team or direct + room ids)
    const msgResult = await db.query(
      `SELECT id, sender_id, receiver_id, team_id, image_url, file_url
       FROM messages
       WHERE id = $1`,
      [messageId],
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ message: "Message not found" });
    }

    const msg = msgResult.rows[0];

    // 2) Authorization: only sender can delete
    if (Number(msg.sender_id) !== Number(currentUserId)) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this message" });
    }

    if (msg.team_id) {
      const canAccessTeam = await ensureTeamMessageAccess(msg.team_id, currentUserId);
      if (!canAccessTeam) {
        return res
          .status(403)
          .json({ message: "Not authorized to delete this message" });
      }
    }

    const imageUrl = msg.image_url;
    const fileUrl = msg.file_url;

    if (imageUrl && isImageKitUrl(imageUrl)) {
      await deleteImageKitFile(imageUrl);
    }
    if (fileUrl && isImageKitUrl(fileUrl)) {
      await deleteImageKitFile(fileUrl);
    }

    // 3) SOFT DELETE (matches your UI + your getMessages already returns deleted_at/deleted_by)
    await db.query(
      `UPDATE messages
       SET deleted_at = NOW(),
           deleted_by = $2,
           content = NULL,
           image_url = NULL,
           file_url = NULL,
           file_name = NULL,
           file_size = NULL
       WHERE id = $1`,
      [messageId, currentUserId],
    );

    // 4) Emit socket event to other users
    const io = req.app.get("io");

    const payload = {
      messageId: Number(messageId),
      deletedAt: new Date().toISOString(),
      deletedBy: Number(currentUserId),
      type: msg.team_id ? "team" : "direct",
      teamId: msg.team_id ? Number(msg.team_id) : null,
      senderId: msg.sender_id ? Number(msg.sender_id) : null,
      receiverId: msg.receiver_id ? Number(msg.receiver_id) : null,
    };

    if (msg.team_id) {
      io.to(`team:${msg.team_id}`).emit("message:deleted", payload);
    } else {
      io.to(`user:${msg.sender_id}`).emit("message:deleted", payload);
      io.to(`user:${msg.receiver_id}`).emit("message:deleted", payload);
    }

    return res.status(200).json({ success: true, message: "Message deleted" });
  } catch (error) {
    console.error("deleteMessage error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete message",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  startConversation,
  getConversations,
  getConversationById,
  sendMessage,
  getMessages,
  getMessageById,
  updateMessage,
  deleteMessage,
  getUnreadCount,
};
