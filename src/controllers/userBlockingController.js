const db = require("../config/database");
const { pool } = db;
const userModel = require("../models/userModel");

const isSelf = (req) => Number(req.user?.id) === Number(req.params.id);

// Tell both parties' clients (all devices) to re-sync block state in realtime,
// so a block/unblock instantly hides/restores chats without a manual refresh.
const emitBlocksUpdated = (req, blockerId, blockedId, blocked) => {
  const io = req.app.get("io");
  if (!io) return;
  io.to(`user:${blockedId}`).emit("blocks:updated", {
    withUserId: Number(blockerId),
    blocked,
  });
  io.to(`user:${blockerId}`).emit("blocks:updated", {
    withUserId: Number(blockedId),
    blocked,
  });
};

/**
 * @description List users the current user has blocked.
 * @route GET /api/users/:id/blocks
 * @access Private (self only)
 */
const getBlockedUsers = async (req, res) => {
  try {
    if (!isSelf(req)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const blocked = await userModel.getBlockedUsers(req.user.id);
    res.status(200).json({ success: true, data: blocked });
  } catch (error) {
    console.error("Error fetching blocked users:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching blocked users",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * @description Block a user.
 * @route POST /api/users/:id/blocks
 * @access Private (self only)
 */
const blockUser = async (req, res) => {
  try {
    if (!isSelf(req)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const blockedId = Number(req.body.blocked_id ?? req.body.blockedId);
    if (!blockedId || Number.isNaN(blockedId)) {
      return res
        .status(400)
        .json({ success: false, message: "blockedId is required" });
    }
    if (blockedId === Number(req.user.id)) {
      return res
        .status(400)
        .json({ success: false, message: "You cannot block yourself" });
    }

    const target = await pool.query(`SELECT id FROM users WHERE id = $1`, [
      blockedId,
    ]);
    if (target.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    await userModel.blockUser(req.user.id, blockedId);
    emitBlocksUpdated(req, req.user.id, blockedId, true);
    res
      .status(201)
      .json({ success: true, message: "User blocked successfully" });
  } catch (error) {
    console.error("Error blocking user:", error);
    res.status(500).json({
      success: false,
      message: "Error blocking user",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * @description Unblock a user.
 * @route DELETE /api/users/:id/blocks/:blockedId
 * @access Private (self only)
 */
const unblockUser = async (req, res) => {
  try {
    if (!isSelf(req)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const blockedId = Number(req.params.blockedId);
    if (!blockedId || Number.isNaN(blockedId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid blocked user id" });
    }
    await userModel.unblockUser(req.user.id, blockedId);
    emitBlocksUpdated(req, req.user.id, blockedId, false);
    res
      .status(200)
      .json({ success: true, message: "User unblocked successfully" });
  } catch (error) {
    console.error("Error unblocking user:", error);
    res.status(500).json({
      success: false,
      message: "Error unblocking user",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

/**
 * @description Get every user id in a block relationship with the current user
 *              (either direction) — used by the client to mutually anonymize
 *              blocked users in shared teams.
 * @route GET /api/users/:id/block-relationships
 * @access Private (self only)
 */
const getBlockRelationships = async (req, res) => {
  try {
    if (!isSelf(req)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const ids = await userModel.getBlockRelationshipIds(req.user.id);
    res.status(200).json({ success: true, data: { ids } });
  } catch (error) {
    console.error("Error fetching block relationships:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching block relationships",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};

module.exports = {
  getBlockedUsers,
  blockUser,
  unblockUser,
  getBlockRelationships,
};
