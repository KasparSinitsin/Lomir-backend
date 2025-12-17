const express = require("express");
const messageController = require("../controllers/messageController");
const { authenticateToken } = require("../middlewares/auth");

const router = express.Router();

// Start a new conversation
router.post(
  "/conversations",
  authenticateToken,
  messageController.startConversation
);

// Get all conversations for current user
router.get(
  "/conversations",
  authenticateToken,
  messageController.getConversations
);

router.get(
  "/unread-count",
  authenticateToken,
  messageController.getUnreadCount
);

// Get specific conversation
router.get(
  "/conversations/:id",
  authenticateToken,
  messageController.getConversationById
);

// Get messages for a conversation
router.get(
  "/conversations/:id/messages",
  authenticateToken,
  messageController.getMessages
);

// Send a message to a conversation
router.post(
  "/conversations/:id/messages",
  authenticateToken,
  messageController.sendMessage
);

// Get specific message
router.get(
  "/messages/:id",
  authenticateToken,
  messageController.getMessageById
);

// Delete a message
router.delete(
  "/messages/:id",
  authenticateToken,
  messageController.deleteMessage
);

module.exports = router;
