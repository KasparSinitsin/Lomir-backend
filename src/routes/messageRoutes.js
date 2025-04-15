const express = require('express');
const messageController = require('../controllers/messageController');
const { authenticateToken } = require('../middlewares/auth');

const router = express.Router();

router.post('/', authenticateToken, messageController.sendMessage);
router.get('/', authenticateToken, messageController.getMessages);
router.get('/:id', authenticateToken, messageController.getMessageById);
router.delete('/:id', authenticateToken, messageController.deleteMessage);

module.exports = router;