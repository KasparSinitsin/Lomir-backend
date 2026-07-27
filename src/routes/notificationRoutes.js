const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticateToken } = require("../middlewares/auth");

// All routes require authentication
router.use(authenticateToken);

// Get unread notification count (with firstUnread for navigation)
router.get("/unread-count", notificationController.getUnreadCount);

// Mark a single notification as read
router.put("/:id/read", notificationController.markAsRead);

// Mark all notifications as read
router.put("/read-all", notificationController.markAllAsRead);

// Delete a notification
router.delete("/:id", notificationController.deleteNotification);

module.exports = router;