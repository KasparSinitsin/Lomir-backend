const startConversation = async (req, res) => {
  try {
    const userId = req.user.id; // The authenticated user
    const { recipient_id, initial_message } = req.body;
    
    if (!recipient_id) {
      return res.status(400).json({
        success: false,
        message: 'Recipient ID is required'
      });
    }
    
    // Check if recipient exists
    const recipientResult = await db.query(`
      SELECT id FROM users WHERE id = $1
    `, [recipient_id]);
    
    if (recipientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }
    
    // Check if a conversation already exists between these users
    const existingConversationResult = await db.query(`
      SELECT id FROM conversations
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
    `, [userId, recipient_id]);
    
    let conversationId;
    
    if (existingConversationResult.rows.length > 0) {
      // Use existing conversation
      conversationId = existingConversationResult.rows[0].id;
    } else {
      // Create new conversation
      const newConversationResult = await db.query(`
        INSERT INTO conversations (user1_id, user2_id)
        VALUES ($1, $2)
        RETURNING id
      `, [userId, recipient_id]);
      
      conversationId = newConversationResult.rows[0].id;
    }
    
    // Send initial message if provided
    if (initial_message && initial_message.trim() !== '') {
      await db.query(`
        INSERT INTO messages (conversation_id, sender_id, content)
        VALUES ($1, $2, $3)
      `, [conversationId, userId, initial_message.trim()]);
      
      // Update conversation timestamp
      await db.query(`
        UPDATE conversations
        SET updated_at = NOW()
        WHERE id = $1
      `, [conversationId]);
    }
    
    res.status(201).json({
      success: true,
      data: {
        conversationId
      }
    });
  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting conversation',
      error: error.message
    });
  }
};



const sendMessage = async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        message: 'Send message placeholder',
        data: { id: 1 }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error sending message',
        error: error.message
      });
    }
  };
  
  const getMessages = async (req, res) => {
    try {
      res.status(200).json({
        success: true,
        message: 'Get messages placeholder',
        data: []
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching messages',
        error: error.message
      });
    }
  };
  
  const getMessageById = async (req, res) => {
    try {
      const messageId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Get message ${messageId} placeholder`,
        data: { id: messageId, content: 'Sample message' }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching message',
        error: error.message
      });
    }
  };
  
  const deleteMessage = async (req, res) => {
    try {
      const messageId = req.params.id;
      res.status(200).json({
        success: true,
        message: `Delete message ${messageId} placeholder`,
        data: { id: messageId }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting message',
        error: error.message
      });
    }
  };
  
  module.exports = {
    startConversation,
    sendMessage,
    getMessages,
    getMessageById,
    deleteMessage
  };