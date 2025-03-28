const express = require('express');
const messageController = require('../controllers/messageController');

const router = express.Router();

router.post('/', messageController.sendMessage);
router.get('/', messageController.getMessages);
router.get('/:id', messageController.getMessageById);
router.delete('/:id', messageController.deleteMessage);

module.exports = router;