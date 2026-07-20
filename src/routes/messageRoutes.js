const express = require("express");
const messageController = require("../controllers/messageController");
const { authenticateToken } = require("../middlewares/auth");

const router = express.Router();

// Get all conversations for current user
router.get(
  "/conversations",
  authenticateToken,
  messageController.getConversations,
);

router.get(
  "/unread-count",
  authenticateToken,
  messageController.getUnreadCount,
);

// Mark every conversation as read for the current user
router.put(
  "/read-all",
  authenticateToken,
  messageController.markAllAsRead,
);

// Get specific conversation
router.get(
  "/conversations/:id",
  authenticateToken,
  messageController.getConversationById,
);

// Get messages for a conversation
router.get(
  "/conversations/:id/messages",
  authenticateToken,
  messageController.getMessages,
);

// Send a message to a conversation
router.post(
  "/conversations/:id/messages",
  authenticateToken,
  messageController.sendMessage,
);

// Get specific message
router.get("/:id", authenticateToken, messageController.getMessageById);

// Edit a message
router.patch("/:id", authenticateToken, messageController.updateMessage);

// Delete a message
router.delete("/:id", authenticateToken, messageController.deleteMessage);

module.exports = router;
