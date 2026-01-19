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

// Make io accessible to controllers via req.app.get("io")
app.set("io", io);

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

  // Join user to all their team rooms
  const joinUserTeams = async () => {
    try {
      const db = require("./config/database");
      const userTeamsResult = await db.query(
        `SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $1`,
        [userId],
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

  // Handle joining a conversation
  socket.on("conversation:join", (data) => {
    const conversationId =
      typeof data === "object" ? data.conversationId : data;
    const type = typeof data === "object" ? data.type : "direct";

    // Join the conversation room
    socket.join(`conversation:${conversationId}`);
    console.log(`User ${userId} joined ${type} conversation ${conversationId}`);
  });

  // Handle leaving a conversation
  socket.on("conversation:leave", (data) => {
    const conversationId =
      typeof data === "object" ? data.conversationId : data;
    const type = typeof data === "object" ? data.type : "direct";

    socket.leave(`conversation:${conversationId}`);
    console.log(`User ${userId} left ${type} conversation ${conversationId}`);
  });

  // Handle new message
  socket.on("message:new", async (data) => {
    try {
      const { conversationId, content, type = "direct", imageUrl } = data;

      // Allow either content OR imageUrl
      if ((!content || content.trim() === "") && !imageUrl) {
        socket.emit("error", { message: "Invalid message data" });
        return;
      }

      const db = require("./config/database");
      let messageResult;

      if (type === "team") {
        messageResult = await db.query(
          `INSERT INTO messages (sender_id, team_id, content, image_url, sent_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, sender_id, team_id, content, image_url, sent_at`,
          [userId, conversationId, content?.trim() || null, imageUrl || null],
        );

        const message = {
          id: messageResult.rows[0].id,
          conversationId: String(conversationId),
          teamId: parseInt(conversationId),
          senderId: userId,
          senderUsername: socket.username,
          content: messageResult.rows[0].content,
          imageUrl: messageResult.rows[0].image_url,
          createdAt: messageResult.rows[0].sent_at,
          type: "team",
        };

        io.to(`team:${conversationId}`).emit("message:received", message);
      } else {
        // Similar update for direct messages
        messageResult = await db.query(
          `INSERT INTO messages (sender_id, receiver_id, content, image_url, sent_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, sender_id, receiver_id, content, image_url, sent_at`,
          [userId, conversationId, content?.trim() || null, imageUrl || null],
        );

        const message = {
          id: messageResult.rows[0].id,
          conversationId: String(conversationId),
          senderId: userId,
          senderUsername: socket.username,
          content: messageResult.rows[0].content,
          imageUrl: messageResult.rows[0].image_url,
          createdAt: messageResult.rows[0].sent_at,
          type: "direct",
        };

        io.to(`user:${userId}`).emit("message:received", message);
        io.to(`user:${conversationId}`).emit("message:received", message);
      }
    } catch (error) {
      console.error("Error handling new message:", error);
      socket.emit("error", { message: "Error sending message" });
    }
  });

  // Handle typing indicator - start
  socket.on("typing:start", (data) => {
    const { conversationId, type = "direct" } = data;
    console.log(
      `User ${userId} started typing in ${type} conversation ${conversationId}`,
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
  socket.on("typing:stop", (data) => {
    const { conversationId, type = "direct" } = data;
    console.log(
      `User ${userId} stopped typing in ${type} conversation ${conversationId}`,
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

  // Handle message read status
  socket.on("message:read", async (data) => {
    try {
      const { conversationId, type = "direct" } = data;
      const db = require("./config/database");

      console.log(
        `User ${userId} marking ${type} messages as read in conversation ${conversationId}`,
      );

      if (type === "team") {
        // Mark team messages as read (messages not sent by this user)
        await db.query(
          `UPDATE messages
           SET read_at = NOW()
           WHERE team_id = $1 
             AND sender_id != $2 
             AND read_at IS NULL`,
          [conversationId, userId],
        );

        // Emit read status update to the team room
        socket.to(`team:${conversationId}`).emit("message:status", {
          conversationId: String(conversationId),
          type: "team",
          readBy: userId,
          readAt: new Date().toISOString(),
        });
      } else {
        // Mark direct messages as read
        await db.query(
          `UPDATE messages
           SET read_at = NOW()
           WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL`,
          [userId, conversationId],
        );

        // Emit read status update to the sender
        socket.to(`user:${conversationId}`).emit("message:status", {
          conversationId: String(conversationId),
          type: "direct",
          readBy: userId,
          readAt: new Date().toISOString(),
        });
      }

      // IMPORTANT: Emit to the current user so their Navbar can update the unread count
      socket.emit("messages:read", {
        conversationId: String(conversationId),
        type: type,
        readAt: new Date().toISOString(),
      });

      console.log(
        `Messages marked as read for ${type} conversation ${conversationId}`,
      );
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
