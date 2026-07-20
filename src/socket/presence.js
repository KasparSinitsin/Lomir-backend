const db = require("../config/database");

// Connected users map: userId -> socketId
const connectedUsers = new Map();

// Join user to all their team rooms
const joinUserTeams = async (socket, userId) => {
  try {
    const userTeamsResult = await db.query(
      `SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1`,
      [userId],
    );

    for (const row of userTeamsResult.rows) {
      const teamId = row.team_id;
      socket.join(`team:${teamId}`);
      if (process.env.NODE_ENV !== "production") {
        console.log(`User ${userId} joined team room: team:${teamId}`);
      }
    }
  } catch (error) {
    console.error("Error joining user teams:", error);
  }
};

// Register the socket as online: track it, join its rooms, announce presence.
const registerPresence = (io, socket, userId) => {
  // Store user connection
  connectedUsers.set(userId, socket.id);

  // Join user to their own room for private messages
  socket.join(`user:${userId}`);

  joinUserTeams(socket, userId);

  // Emit online users to all clients
  io.emit("users:online", Array.from(connectedUsers.keys()));
};

// Handle disconnection
const registerDisconnectHandler = (io, socket, userId) => {
  socket.on("disconnect", () => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`User disconnected: ${userId}`);
    }
    connectedUsers.delete(userId);

    // Emit updated online users
    io.emit("users:online", Array.from(connectedUsers.keys()));
  });
};

module.exports = {
  connectedUsers,
  joinUserTeams,
  registerPresence,
  registerDisconnectHandler,
};
