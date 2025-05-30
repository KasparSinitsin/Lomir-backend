const db = require("../config/database");

// Start a conversation by sending the first message
const startConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { recipient_id, initial_message } = req.body; // Use snake_case

    if (!recipient_id) {
      return res.status(400).json({
        success: false,
        message: "Recipient ID is required",
      });
    }

    // Check if recipient exists
    const recipientResult = await db.query(
      `
      SELECT id FROM users WHERE id = $1
    `,
      [recipient_id]
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Recipient not found",
      });
    }

    // Send initial message if provided
    if (initial_message && initial_message.trim() !== "") {
      await db.query(
        `
        INSERT INTO messages (sender_id, receiver_id, content, sent_at)
        VALUES ($1, $2, $3, NOW())
      `,
        [userId, recipient_id, initial_message.trim()]
      );
    }

    res.status(201).json({
      success: true,
      data: {
        conversationId: recipient_id, // Use recipient_id as conversation identifier
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

// Get all conversations (both direct messages and team chats) for current user
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get direct message conversations
    const directMessagesQuery = `
      WITH latest_dm AS (
        SELECT DISTINCT
          CASE 
            WHEN m.sender_id = $1 THEN m.receiver_id 
            ELSE m.sender_id 
          END as partner_id,
          (SELECT content FROM messages m2 
           WHERE ((m2.sender_id = $1 AND m2.receiver_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END) 
                  OR (m2.sender_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AND m2.receiver_id = $1))
             AND m2.team_id IS NULL
           ORDER BY m2.sent_at DESC LIMIT 1) as last_message,
          (SELECT sent_at FROM messages m2 
           WHERE ((m2.sender_id = $1 AND m2.receiver_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END) 
                  OR (m2.sender_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AND m2.receiver_id = $1))
             AND m2.team_id IS NULL
           ORDER BY m2.sent_at DESC LIMIT 1) as last_message_time
        FROM messages m
        WHERE (m.sender_id = $1 OR m.receiver_id = $1) 
          AND m.team_id IS NULL
      )
      SELECT 
        dm.partner_id as id,
        'direct' as type,
        u.username as name,
        u.first_name,
        u.last_name,
        u.avatar_url,
        dm.last_message,
        dm.last_message_time as updated_at
      FROM latest_dm dm
      JOIN users u ON dm.partner_id = u.id
      WHERE dm.last_message IS NOT NULL
    `;

    // Get team message conversations
    const teamMessagesQuery = `
      WITH latest_team AS (
        SELECT DISTINCT
          m.team_id,
          (SELECT content FROM messages m2 
           WHERE m2.team_id = m.team_id 
           ORDER BY m2.sent_at DESC LIMIT 1) as last_message,
          (SELECT sent_at FROM messages m2 
           WHERE m2.team_id = m.team_id 
           ORDER BY m2.sent_at DESC LIMIT 1) as last_message_time
        FROM messages m
        WHERE m.team_id IS NOT NULL 
          AND (m.sender_id = $1 OR EXISTS (
            SELECT 1 FROM team_members tm 
            WHERE tm.team_id = m.team_id AND tm.user_id = $1
          ))
      )
      SELECT 
        lt.team_id as id,
        'team' as type,
        t.name,
        NULL as first_name,
        NULL as last_name,
        t.teamavatar_url as avatar_url,
        lt.last_message,
        lt.last_message_time as updated_at
      FROM latest_team lt
      JOIN teams t ON lt.team_id = t.id
      WHERE lt.last_message IS NOT NULL
    `;

    const [directResult, teamResult] = await Promise.all([
      db.query(directMessagesQuery, [userId]),
      db.query(teamMessagesQuery, [userId]),
    ]);

    // Combine and sort all conversations
    const allConversations = [
      ...directResult.rows.map((row) => ({
        id: row.id,
        type: row.type,
        partner: {
          id: row.id,
          username: row.name,
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

// Get conversation details by ID (could be user ID for DM or team ID for group)
const getConversationById = async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const userId = req.user.id;
    const { type } = req.query; // 'direct' or 'team'

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

// Get messages for a conversation (direct or team)
const getMessages = async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const userId = req.user.id;
    const { type } = req.query; // 'direct' or 'team'

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

// Send a message (direct or to team)
const sendMessage = async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const userId = req.user.id;
    const { content, type } = req.body; // type: 'direct' or 'team'

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
        `
        INSERT INTO messages (sender_id, team_id, content, sent_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING id, sender_id, team_id, content, sent_at
      `,
        [userId, conversationId, content.trim()]
      );
    } else {
      // Send direct message
      messageResult = await db.query(
        `
        INSERT INTO messages (sender_id, receiver_id, content, sent_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING id, sender_id, receiver_id, content, sent_at
      `,
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
};
