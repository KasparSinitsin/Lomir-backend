const db = require("../config/database");

// ============================================================================
// HELPER: Generate navigation URL based on notification type
// ============================================================================
const getNavigationUrl = (notification) => {
  const { type, team_id, reference_id, actor_id } = notification;

  switch (type) {
    // === NAVIGATES TO MY TEAMS PAGE ===
    case "invitation_received":
      // Invitee sees their invitation card highlighted
      return `/teams/my-teams?tab=invitations&highlight=${reference_id}`;

    case "application_received":
      // Team admin sees applications modal with applicant highlighted
      return `/teams/my-teams?team=${team_id}&openApplications=true&highlight=${actor_id}`;

    // === NAVIGATES TO DM CHAT ===
    case "application_approved":
      // Applicant sees DM with approver + green approval message
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "application_rejected":
      // Applicant sees DM with rejector + violet rejection message
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "invitation_declined":
      // Inviter sees DM with decliner + violet decline message
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "invitation_cancelled":
      // Navigate to DM with the person who cancelled
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    // === NAVIGATES TO TEAM CHAT ===
    case "member_joined":
      // Team members see team chat with join message highlighted
      return `/chat/${team_id}?type=team&highlightUser=${actor_id}`;

    case "member_left":
      // Team members see team chat with leave message highlighted
      return `/chat/${team_id}?type=team&highlightUser=${actor_id}`;

    case "application_cancelled":
      // Navigate to DM with the applicant who cancelled
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "member_removed":
      // Navigate to DM with the admin who removed you
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "role_changed":
      // Navigate to DM with the admin who changed the role
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "ownership_transferred":
      // Navigate to DM with the previous owner who transferred
      return `/chat/${actor_id}?type=direct&highlightUser=${actor_id}`;

    case "team_deleted":
      // Navigate to the archived team chat
      return `/chat/${team_id}?type=team&highlightUser=${actor_id}`;

    default:
      return "/teams/my-teams";
  }
};

// ============================================================================
// HELPER: Create a notification (used by other controllers)
// ============================================================================
const createNotification = async ({
  userId,
  type,
  title,
  message = null,
  referenceType = null,
  referenceId = null,
  teamId = null,
  actorId = null,
}) => {
  try {
    const result = await db.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, team_id, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        type,
        title,
        message,
        referenceType,
        referenceId,
        teamId,
        actorId,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

// ============================================================================
// HELPER: Create notifications for all team members (for member_joined/left)
// ============================================================================
const notifyTeamMembers = async ({
  teamId,
  excludeUserId,
  type,
  title,
  message = null,
  referenceType = null,
  referenceId = null,
  actorId = null,
}) => {
  try {
    // Get all team members except the excluded user
    const membersResult = await db.query(
      `SELECT user_id FROM team_members WHERE team_id = $1 AND user_id != $2`,
      [teamId, excludeUserId]
    );

    const notifications = [];
    for (const member of membersResult.rows) {
      const notification = await createNotification({
        userId: member.user_id,
        type,
        title,
        message,
        referenceType,
        referenceId,
        teamId,
        actorId,
      });
      notifications.push(notification);
    }

    return notifications;
  } catch (error) {
    console.error("Error notifying team members:", error);
    throw error;
  }
};

// ============================================================================
// HELPER: Notify team admins and owners (for applications)
// ============================================================================
const notifyTeamAdmins = async ({
  teamId,
  type,
  title,
  message = null,
  referenceType = null,
  referenceId = null,
  actorId = null,
}) => {
  try {
    // Get team owner and admins
    const adminsResult = await db.query(
      `SELECT user_id FROM team_members 
       WHERE team_id = $1 AND role IN ('owner', 'admin')`,
      [teamId]
    );

    const notifications = [];
    for (const admin of adminsResult.rows) {
      const notification = await createNotification({
        userId: admin.user_id,
        type,
        title,
        message,
        referenceType,
        referenceId,
        teamId,
        actorId,
      });
      notifications.push(notification);
    }

    return notifications;
  } catch (error) {
    console.error("Error notifying team admins:", error);
    throw error;
  }
};

// ============================================================================
// GET /notifications/unread-count - Get unread notification count
// ============================================================================
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get total unread count
    const countResult = await db.query(
      `SELECT COUNT(*) as count 
       FROM notifications 
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );

    // Get the first unread notification (most recent)
    const firstUnreadResult = await db.query(
      `SELECT id, type, team_id, reference_id, actor_id, created_at
       FROM notifications 
       WHERE user_id = $1 AND read_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    const unreadCount = parseInt(countResult.rows[0].count) || 0;
    let firstUnread = null;

    if (firstUnreadResult.rows.length > 0) {
      const notification = firstUnreadResult.rows[0];
      firstUnread = {
        id: notification.id,
        type: notification.type,
        teamId: notification.team_id,
        referenceId: notification.reference_id,
        actorId: notification.actor_id,
        navigateTo: getNavigationUrl(notification),
      };
    }

    res.status(200).json({
      success: true,
      data: {
        count: unreadCount,
        firstUnread,
      },
    });
  } catch (error) {
    console.error("Error fetching unread notification count:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching unread notification count",
      error: error.message,
    });
  }
};

// ============================================================================
// GET /notifications - Get all notifications for the user
// ============================================================================
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0, unreadOnly = false } = req.query;

    let query = `
      SELECT 
        n.id,
        n.type,
        n.title,
        n.message,
        n.reference_type as "referenceType",
        n.reference_id as "referenceId",
        n.team_id as "teamId",
        n.actor_id as "actorId",
        n.read_at as "readAt",
        n.created_at as "createdAt",
        t.name as "teamName",
        u.username as "actorUsername",
        u.first_name as "actorFirstName",
        u.last_name as "actorLastName",
        u.avatar_url as "actorAvatarUrl"
      FROM notifications n
      LEFT JOIN teams t ON n.team_id = t.id
      LEFT JOIN users u ON n.actor_id = u.id
      WHERE n.user_id = $1
    `;

    const params = [userId];

    if (unreadOnly === "true") {
      query += ` AND n.read_at IS NULL`;
    }

    query += ` ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);

    // Add navigation URL to each notification
    const notifications = result.rows.map((notification) => ({
      ...notification,
      navigateTo: getNavigationUrl({
        type: notification.type,
        team_id: notification.teamId,
        reference_id: notification.referenceId,
        actor_id: notification.actorId,
      }),
    }));

    res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message,
    });
  }
};

// ============================================================================
// PUT /notifications/:id/read - Mark a single notification as read
// ============================================================================
const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.id);

    const result = await db.query(
      `UPDATE notifications 
       SET read_at = NOW() 
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL
       RETURNING *`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or already read",
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking notification as read",
      error: error.message,
    });
  }
};

// ============================================================================
// PUT /notifications/read-all - Mark all notifications as read
// ============================================================================
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `UPDATE notifications 
       SET read_at = NOW() 
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id`,
      [userId]
    );

    res.status(200).json({
      success: true,
      data: {
        markedCount: result.rows.length,
      },
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking all notifications as read",
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE /notifications/:id - Delete a notification
// ============================================================================
const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.id);

    const result = await db.query(
      `DELETE FROM notifications 
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting notification",
      error: error.message,
    });
  }
};

module.exports = {
  // API endpoints
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  // Helper functions (for use in other controllers)
  createNotification,
  notifyTeamMembers,
  notifyTeamAdmins,
  getNavigationUrl,
};
