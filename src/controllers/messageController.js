const db = require("../config/database");

const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get total unread count for direct messages
    const directUnreadResult = await db.query(
      `SELECT COUNT(*) as count 
       FROM messages 
       WHERE receiver_id = $1 AND read_at IS NULL AND team_id IS NULL`,
      [userId],
    );

    // Get total unread count for team messages (messages in teams user is a member of, not sent by user)
    const teamUnreadResult = await db.query(
      `SELECT COUNT(*) as count 
       FROM messages m
       JOIN team_members tm ON m.team_id = tm.team_id
       WHERE tm.user_id = $1 
         AND m.sender_id != $1 
         AND m.read_at IS NULL 
         AND m.team_id IS NOT NULL`,
      [userId],
    );

    const directUnreadCount = parseInt(directUnreadResult.rows[0].count) || 0;
    const teamUnreadCount = parseInt(teamUnreadResult.rows[0].count) || 0;
    const totalUnreadCount = directUnreadCount + teamUnreadCount;

    // Find the most recent unread message across both direct and team conversations
    const mostRecentUnreadQuery = await db.query(
      `(
        SELECT 
          sender_id as conversation_id,
          'direct' as type,
          MAX(sent_at) as latest_unread
        FROM messages 
        WHERE receiver_id = $1 AND read_at IS NULL AND team_id IS NULL
        GROUP BY sender_id
      )
      UNION ALL
      (
        SELECT 
          m.team_id as conversation_id,
          'team' as type,
          MAX(m.sent_at) as latest_unread
        FROM messages m
        JOIN team_members tm ON m.team_id = tm.team_id
        WHERE tm.user_id = $1 
          AND m.sender_id != $1 
          AND m.read_at IS NULL 
          AND m.team_id IS NOT NULL
        GROUP BY m.team_id
      )
      ORDER BY latest_unread DESC
      LIMIT 1`,
      [userId],
    );

    let firstUnread = null;

    if (mostRecentUnreadQuery.rows.length > 0) {
      firstUnread = {
        conversationId: mostRecentUnreadQuery.rows[0].conversation_id,
        type: mostRecentUnreadQuery.rows[0].type,
      };
    }

    res.status(200).json({
      success: true,
      data: {
        count: totalUnreadCount,
        firstUnread: firstUnread,
      },
    });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching unread count",
      error: error.message,
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
      error: error.message,
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
        lm.last_message,
        lm.last_message_time as updated_at,
        COALESCE(uc.unread_count, 0) as unread_count
      FROM latest_messages lm
      JOIN users u ON lm.partner_id = u.id
      LEFT JOIN unread_counts uc ON lm.partner_id = uc.partner_id
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
        GROUP BY m.team_id
      ),
      latest_team_messages AS (
        SELECT 
          tc.team_id,
          tc.last_message_time,
          m.content as last_message
        FROM team_conversations tc
        JOIN messages m ON m.team_id = tc.team_id AND m.sent_at = tc.last_message_time
      ),
      team_unread_counts AS (
        SELECT 
          m.team_id,
          COUNT(*) as unread_count
        FROM messages m
        JOIN team_members tm ON m.team_id = tm.team_id
        WHERE tm.user_id = $1 
          AND m.sender_id != $1
          AND m.read_at IS NULL
          AND m.team_id IS NOT NULL
        GROUP BY m.team_id
      )
      SELECT 
        ltm.team_id as id,
        'team' as type,
        t.name,
        NULL as first_name,
        NULL as last_name,
        t.teamavatar_url as avatar_url,
        ltm.last_message,
        ltm.last_message_time as updated_at,
        COALESCE(tuc.unread_count, 0) as unread_count
      FROM latest_team_messages ltm
      JOIN teams t ON ltm.team_id = t.id
      LEFT JOIN team_unread_counts tuc ON ltm.team_id = tuc.team_id
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
      error: error.message,
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
          t.teamavatar_url as avatar_url
        FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        WHERE t.id = $1 AND tm.user_id = $2
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
          },
        },
      });
    } else {
      // Get direct conversation partner details
      const userQuery = `
        SELECT 
          id,
          username,
          first_name,
          last_name,
          avatar_url
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
          },
        },
      });
    }
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching conversation",
      error: error.message,
    });
  }
};

// Get messages for a conversation
const getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const type = req.query.type || "direct";

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
    m.image_url,
    m.file_url,
    m.file_name,
    m.sent_at as created_at,
    m.read_at,
    u.username as sender_username,
    u.first_name as sender_first_name,
    u.last_name as sender_last_name,
    u.avatar_url as sender_avatar_url
  FROM messages m
  JOIN users u ON m.sender_id = u.id
  WHERE m.team_id = $1
  ORDER BY m.sent_at ASC
`;
      queryParams = [conversationId];
    } else {
      messagesQuery = `
  SELECT 
    m.id,
    m.sender_id,
    m.receiver_id,
    m.content,
    m.image_url,
    m.file_url,
    m.file_name,
    m.sent_at as created_at,
    m.read_at,
    u.username as sender_username,
    u.first_name as sender_first_name,
    u.last_name as sender_last_name,
    u.avatar_url as sender_avatar_url
  FROM messages m
  JOIN users u ON m.sender_id = u.id
  WHERE ((m.sender_id = $1 AND m.receiver_id = $2) 
     OR (m.sender_id = $2 AND m.receiver_id = $1))
    AND m.team_id IS NULL
  ORDER BY m.sent_at ASC
`;
      queryParams = [userId, conversationId];
    }

    const result = await db.query(messagesQuery, queryParams);

    const messages = result.rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      teamId: row.team_id,
      content: row.content,
      imageUrl: row.image_url,
      fileUrl: row.file_url,
      fileName: row.file_name,
      createdAt: row.created_at,
      readAt: row.read_at,
      senderUsername: row.sender_username,
      senderFirstName: row.sender_first_name,
      senderLastName: row.sender_last_name,
      senderAvatarUrl: row.sender_avatar_url,
    }));

    res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
      error: error.message,
    });
  }
};

// Send a message
const sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const { content, type, imageUrl, fileUrl, fileName } = req.body;

    // Allow content OR imageUrl OR fileUrl (or combinations)
    if ((!content || content.trim() === "") && !imageUrl && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: "Message content, image, or file is required",
      });
    }

    /**
     * ✅ Fix 2: Backend - Block messages to archived teams
     * Use the "targetTeamId" derived from:
     * - conversationId when type === "team"
     * - req.body.team_id (if some clients send it)
     *
     * (We use db.query here for consistency with the rest of this controller.
     * If your database module exposes db.pool.query as well, you can swap it in.)
     */
    const targetTeamId =
      type === "team" ? conversationId : req.body.team_id || req.body.teamId;

    if (targetTeamId) {
      const teamCheck = await db.query(
        `SELECT archived_at FROM teams WHERE id = $1`,
        [targetTeamId],
      );

      if (teamCheck.rows.length > 0 && teamCheck.rows[0].archived_at) {
        return res.status(403).json({
          success: false,
          message: "Cannot send messages to a deleted team",
        });
      }
    }

    let messageResult;

    if (type === "team") {
      messageResult = await db.query(
        `INSERT INTO messages (sender_id, team_id, content, image_url, file_url, file_name, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, sender_id, team_id, content, image_url, file_url, file_name, sent_at`,
        [
          userId,
          conversationId,
          content?.trim() || null,
          imageUrl || null,
          fileUrl || null,
          fileName || null,
        ],
      );
    } else {
      messageResult = await db.query(
        `INSERT INTO messages (sender_id, receiver_id, content, image_url, file_url, file_name, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, sender_id, receiver_id, content, image_url, file_url, file_name, sent_at`,
        [
          userId,
          conversationId,
          content?.trim() || null,
          imageUrl || null,
          fileUrl || null,
          fileName || null,
        ],
      );
    }

    res.status(201).json({
      success: true,
      data: messageResult.rows[0],
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      success: false,
      message: "Error sending message",
      error: error.message,
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
        m.sent_at,
        m.read_at,
        u.username as sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = $1
    `;

    const result = await db.query(messageQuery, [messageId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching message",
      error: error.message,
    });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user.id;

    // Check if user owns this message
    const checkQuery = `
      SELECT id FROM messages 
      WHERE id = $1 AND sender_id = $2
    `;

    const checkResult = await db.query(checkQuery, [messageId, userId]);

    if (checkResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this message",
      });
    }

    // Delete the message
    await db.query("DELETE FROM messages WHERE id = $1", [messageId]);

    res.status(200).json({
      success: true,
      message: "Message deleted successfully",
      data: { id: messageId },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting message",
      error: error.message,
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
  deleteMessage,
  getUnreadCount,
};
