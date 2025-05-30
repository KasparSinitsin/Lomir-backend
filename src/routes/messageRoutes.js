const express = require('express');
const messageController = require('../controllers/messageController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

// Start a new conversation
router.post('/conversations', authenticateToken, messageController.startConversation);

// Other message routes...
router.get('/conversations', authenticateToken, messageController.getConversations);
router.get('/conversations/:id', authenticateToken, messageController.getConversationById);
router.get('/conversations/:id/messages', authenticateToken, messageController.getMessages);
router.post('/conversations/:id/messages', authenticateToken, messageController.sendMessage);

module.exports = router;