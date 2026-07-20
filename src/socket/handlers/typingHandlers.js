const {
  getBlockedUserRooms,
  isCurrentTeamMember,
  hasDirectConversationAccess,
} = require("../access");

const registerTypingHandlers = (io, socket, userId) => {
  // Handle typing indicator - start
  socket.on("typing:start", async (data) => {
    const { conversationId, type = "direct" } = data;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `User ${userId} started typing in ${type} conversation ${conversationId}`,
      );
    }

    if (type === "team") {
      const canAccessTeam = await isCurrentTeamMember(conversationId, userId);
      if (!canAccessTeam) {
        socket.emit("error", { message: "Not authorized for this team conversation" });
        return;
      }

      // For team messages, broadcast to all team members except sender and
      // anyone in a block relationship with the typing user.
      const blockedRooms = await getBlockedUserRooms(userId);
      const typingEmitter =
        blockedRooms.length > 0
          ? socket.to(`team:${conversationId}`).except(blockedRooms)
          : socket.to(`team:${conversationId}`);
      typingEmitter.emit("typing:update", {
        conversationId: String(conversationId),
        userId,
        username: socket.username,
        isTyping: true,
        type: "team",
      });
    } else {
      const canAccessDirect = await hasDirectConversationAccess(userId, conversationId);
      if (!canAccessDirect) {
        socket.emit("error", { message: "Not authorized for this direct conversation" });
        return;
      }

      // For direct messages
      socket.to(`user:${conversationId}`).emit("typing:update", {
        conversationId: String(userId),
        userId,
        username: socket.username,
        isTyping: true,
        type: "direct",
      });
    }
  });

  // Handle typing indicator - stop
  socket.on("typing:stop", async (data) => {
    const { conversationId, type = "direct" } = data;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `User ${userId} stopped typing in ${type} conversation ${conversationId}`,
      );
    }

    if (type === "team") {
      const canAccessTeam = await isCurrentTeamMember(conversationId, userId);
      if (!canAccessTeam) {
        socket.emit("error", { message: "Not authorized for this team conversation" });
        return;
      }

      // For team messages, broadcast to all team members except sender and
      // anyone in a block relationship with the typing user.
      const blockedRooms = await getBlockedUserRooms(userId);
      const typingEmitter =
        blockedRooms.length > 0
          ? socket.to(`team:${conversationId}`).except(blockedRooms)
          : socket.to(`team:${conversationId}`);
      typingEmitter.emit("typing:update", {
        conversationId: String(conversationId),
        userId,
        username: socket.username,
        isTyping: false,
        type: "team",
      });
    } else {
      const canAccessDirect = await hasDirectConversationAccess(userId, conversationId);
      if (!canAccessDirect) {
        socket.emit("error", { message: "Not authorized for this direct conversation" });
        return;
      }

      // For direct messages
      socket.to(`user:${conversationId}`).emit("typing:update", {
        conversationId: String(userId),
        userId,
        username: socket.username,
        isTyping: false,
        type: "direct",
      });
    }
  });
};

module.exports = { registerTypingHandlers };
