require("dotenv").config();

const app = require("./app");
const http = require("http");
const socketIo = require("socket.io");
const { verifyToken } = require("./utils/jwtUtils");
const PORT = process.env.PORT || 5001;

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket.IO middleware for authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error: Token missing"));
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return next(new Error("Authentication error: Invalid token"));
  }

  // Store user info in socket object
  socket.userId = decoded.id;
  socket.username = decoded.username;
  next();
});

// Connected users map: userId -> socketId
const connectedUsers = new Map();

// Socket.IO connection handling
io.on("connection", (socket) => {
  const userId = socket.userId;
  console.log(`User connected: ${userId} (${socket.username})`);

  // Store user connection
  connectedUsers.set(userId, socket.id);

  // Join user to their own room for private messages
  socket.join(`user:${userId}`);

  // ✅ JOIN USER TO ALL THEIR TEAM ROOMS
  const joinUserTeams = async () => {
    try {
      const db = require("./config/database");
      const userTeamsResult = await db.query(
        `SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1`,
        [userId]
      );

      for (const row of userTeamsResult.rows) {
        const teamId = row.team_id;
        socket.join(`team:${teamId}`);
        console.log(`User ${userId} joined team room: team:${teamId}`);
      }
    } catch (error) {
      console.error("Error joining user teams:", error);
    }
  };

  joinUserTeams();

  // Emit online users to all clients
  io.emit("users:online", Array.from(connectedUsers.keys()));

  // Emit online users to all clients
  io.emit("users:online", Array.from(connectedUsers.keys()));

  // Handle joining a conversation
  socket.on("conversation:join", (conversationId) => {
    // Join the conversation room
    socket.join(`conversation:${conversationId}`);
    console.log(`User ${userId} joined conversation ${conversationId}`);
  });

  // Handle leaving a conversation
  socket.on("conversation:leave", (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    console.log(`User ${userId} left conversation ${conversationId}`);
  });

  // Handle new message
  socket.on("message:new", async (data) => {
    try {
      const { conversationId, content, type = "direct" } = data;

      console.log(
        `User ${userId} sending ${type} message to ${
          type === "team" ? "team" : "user"
        } ${conversationId}: "${content}"`
      );

      // Validate message
      if (!conversationId || !content || content.trim() === "") {
        socket.emit("error", { message: "Invalid message data" });
        return;
      }

      const db = require("./config/database");
      let messageResult;

      if (type === "team") {
        // ✅ TEAM MESSAGE HANDLING
        console.log(`Inserting team message for team ${conversationId}`);

        // First verify user is a member of this team
        const memberCheck = await db.query(
          `SELECT tm.user_id FROM team_members tm 
         WHERE tm.team_id = $1 AND tm.user_id = $2`,
          [conversationId, userId]
        );

        if (memberCheck.rows.length === 0) {
          socket.emit("error", {
            message: "Not authorized to send messages to this team",
          });
          return;
        }

        // Insert team message
        messageResult = await db.query(
          `INSERT INTO messages (sender_id, team_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, team_id, content, sent_at`,
          [userId, conversationId, content.trim()]
        );

        const message = {
          id: messageResult.rows[0].id,
          conversationId: String(conversationId),
          senderId: userId,
          senderUsername: socket.username,
          content: messageResult.rows[0].content,
          createdAt: messageResult.rows[0].sent_at,
          type: "team",
        };

        console.log("Broadcasting team message:", message);

        // ✅ BROADCAST TO ALL TEAM MEMBERS
        // Emit to the team room (all members will receive it)
        io.to(`team:${conversationId}`).emit("message:received", message);
      } else {
        // ✅ DIRECT MESSAGE HANDLING (existing code)
        messageResult = await db.query(
          `INSERT INTO messages (sender_id, receiver_id, content, sent_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, sender_id, receiver_id, content, sent_at`,
          [userId, conversationId, content.trim()]
        );

        const message = {
          id: messageResult.rows[0].id,
          conversationId: String(conversationId),
          senderId: userId,
          senderUsername: socket.username,
          content: messageResult.rows[0].content,
          createdAt: messageResult.rows[0].sent_at,
          type: "direct",
        };

        console.log("Broadcasting direct message:", message);

        // Emit to both users in direct conversation
        io.to(`user:${userId}`).emit("message:received", message);
        io.to(`user:${conversationId}`).emit("message:received", message);
      }
    } catch (error) {
      console.error("Error handling new message:", error);
      socket.emit("error", { message: "Error sending message" });
    }
  });

  // Handle typing indicator
  socket.on("typing:start", (data) => {
    const { conversationId, type = "direct" } = data;
    console.log(
      `User ${userId} started typing in ${type} conversation ${conversationId}`
    );

    if (type === "team") {
      // For team messages, broadcast to all team members except sender
      socket.to(`team:${conversationId}`).emit("typing:update", {
        conversationId: String(conversationId),
        userId,
        username: socket.username,
        isTyping: true,
        type: "team",
      });
    } else {
      // For direct messages (existing logic)
      socket.to(`user:${conversationId}`).emit("typing:update", {
        conversationId: String(userId),
        userId,
        username: socket.username,
        isTyping: true,
        type: "direct",
      });
    }
  });

  socket.on("typing:stop", (data) => {
    const { conversationId, type = "direct" } = data;
    console.log(
      `User ${userId} stopped typing in ${type} conversation ${conversationId}`
    );

    if (type === "team") {
      // For team messages, broadcast to all team members except sender
      socket.to(`team:${conversationId}`).emit("typing:update", {
        conversationId: String(conversationId),
        userId,
        username: socket.username,
        isTyping: false,
        type: "team",
      });
    } else {
      // For direct messages (existing logic)
      socket.to(`user:${conversationId}`).emit("typing:update", {
        conversationId: String(userId),
        userId,
        username: socket.username,
        isTyping: false,
        type: "direct",
      });
    }
  });

  // Handle message read status
  socket.on("message:read", async (data) => {
    try {
      const { conversationId } = data;

      // Update read status in database
      const db = require("./config/database");
      await db.query(
        `
        UPDATE messages
        SET read_at = NOW()
        WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL
      `,
        [userId, conversationId]
      );

      // Emit read status update to the sender
      socket.to(`user:${conversationId}`).emit("message:status", {
        conversationId: String(conversationId),
        readBy: userId,
        readAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error handling message read status:", error);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${userId}`);
    connectedUsers.delete(userId);

    // Emit updated online users
    io.emit("users:online", Array.from(connectedUsers.keys()));
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} with Socket.IO enabled`);
});
