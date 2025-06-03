const db = require("../config/database");

const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const countResult = await db.query(
      `SELECT COUNT(*) as count 
       FROM messages 
       WHERE receiver_id = $1 AND read_at IS NULL`,
      [userId]
    );

    res.status(200).json({
      success: true,
      data: {
        count: parseInt(countResult.rows[0].count),
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
      [receiverId]
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
        [senderId, receiverId, initialMessage.trim()]
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
      )
      SELECT 
        lm.partner_id as id,
        'direct' as type,
        u.username,
        u.first_name,
        u.last_name,
        u.avatar_url,
        lm.last_message,
        lm.last_message_time as updated_at
      FROM latest_messages lm
      JOIN users u ON lm.partner_id = u.id
      ORDER BY lm.last_message_time DESC
    `;

    // Get team conversations where user is a member
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
      )
      SELECT 
        ltm.team_id as id,
        'team' as type,
        t.name,
        NULL as first_name,
        NULL as last_name,
        t.teamavatar_url as avatar_url,
        ltm.last_message,
        ltm.last_message_time as updated_at
      FROM latest_team_messages ltm
      JOIN teams t ON ltm.team_id = t.id
      ORDER BY ltm.last_message_time DESC
    `;

    const [directResult, teamResult] = await Promise.all([
      db.query(directMessagesQuery, [userId]),
      db.query(teamMessagesQuery, [userId]),
    ]);

    // Combine and format results
    const allConversations = [
      ...directResult.rows.map((row) => ({
        id: row.id,
        type: row.type,
        partner: {
          id: row.id,
          username: row.username,
          firstName: row.first_name,
          lastName: row.last_name,
          avatarUrl: row.avatar_url,
        },
        lastMessage: row.last_message,
        updatedAt: row.updated_at,
      })),
      ...teamResult.rows.map((row) => ({
        id: row.id,
        type: row.type,
        team: {
          id: row.id,
          name: row.name,
          avatarUrl: row.avatar_url,
        },
        lastMessage: row.last_message,
        updatedAt: row.updated_at,
      })),
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

// Get conversation details by ID
const getConversationById = async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const userId = req.user.id;
    const { type } = req.query;

    if (type === "team") {
      // Get team information
      const teamQuery = `
        SELECT id, name, description, teamavatar_url as avatar_url
        FROM teams 
        WHERE id = $1
      `;

      const result = await db.query(teamQuery, [conversationId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Team not found",
        });
      }

      const team = result.rows[0];
      res.status(200).json({
        success: true,
        data: {
          id: conversationId,
          type: "team",
          team: {
            id: team.id,
            name: team.name,
            description: team.description,
            avatarUrl: team.avatar_url,
          },
        },
      });
    } else {
      // Get user information for direct message
      const userQuery = `
        SELECT id, username, first_name, last_name, avatar_url
        FROM users 
        WHERE id = $1
      `;

      const result = await db.query(userQuery, [conversationId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const partner = result.rows[0];
      res.status(200).json({
        success: true,
        data: {
          id: conversationId,
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
    const conversationId = parseInt(req.params.id);
    const userId = req.user.id;
    const { type } = req.query;

    let messagesQuery;
    let queryParams;

    if (type === "team") {
      // Get team messages
      messagesQuery = `
        SELECT 
          m.id,
          m.sender_id as "senderId",
          m.content,
          m.sent_at as "createdAt",
          m.read_at as "readAt",
          u.username as "senderUsername",
          u.first_name as "senderFirstName",
          u.avatar_url as "senderAvatarUrl"
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.team_id = $1
        ORDER BY m.sent_at ASC
      `;
      queryParams = [conversationId];
    } else {
      // Get direct messages between two users
      messagesQuery = `
        SELECT 
          m.id,
          m.sender_id as "senderId",
          m.content,
          m.sent_at as "createdAt",
          m.read_at as "readAt",
          u.username as "senderUsername"
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE (
          (m.sender_id = $1 AND m.receiver_id = $2) OR
          (m.sender_id = $2 AND m.receiver_id = $1)
        )
        AND m.team_id IS NULL
        ORDER BY m.sent_at ASC
      `;
      queryParams = [userId, conversationId];
    }

    const result = await db.query(messagesQuery, queryParams);

    res.status(200).json({
      success: true,
      data: result.rows,
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
    const conversationId = parseInt(req.params.id);
    const userId = req.user.id;
    const { content, type } = req.body;

    if (!content || content.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    let messageResult;

    if (type === "team") {
      // Send message to team
      messageResult = await db.query(
        `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, team_id, content, sent_at`,
        [userId, conversationId, content.trim()]
      );
    } else {
      // Send direct message
      messageResult = await db.query(
        `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, receiver_id, content, sent_at`,
        [userId, conversationId, content.trim()]
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
