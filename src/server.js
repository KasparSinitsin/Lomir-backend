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
      const { conversationId, content } = data;

      // Validate message
      if (!conversationId || !content || content.trim() === "") {
        socket.emit("error", { message: "Invalid message data" });
        return;
      }

      // Create new message in database using existing controller
      const db = require("./config/database");

      // Check if user is part of this conversation
      const conversationCheck = await db.query(
        `
        SELECT * FROM conversations
        WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)
      `,
        [conversationId, userId]
      );

      if (conversationCheck.rows.length === 0) {
        socket.emit("error", {
          message: "Not authorized to send message to this conversation",
        });
        return;
      }

      // Get other participant
      const otherUserId =
        conversationCheck.rows[0].user1_id === userId
          ? conversationCheck.rows[0].user2_id
          : conversationCheck.rows[0].user1_id;

      // Insert message into database
      const messageResult = await db.query(
        `
        INSERT INTO messages (conversation_id, sender_id, content)
        VALUES ($1, $2, $3)
        RETURNING id, sender_id, content, created_at
      `,
        [conversationId, userId, content.trim()]
      );

      // Update conversation updated_at timestamp
      await db.query(
        `
        UPDATE conversations
        SET updated_at = NOW()
        WHERE id = $1
      `,
        [conversationId]
      );

      const message = {
        id: messageResult.rows[0].id,
        conversationId,
        senderId: userId,
        senderUsername: socket.username,
        content: messageResult.rows[0].content,
        createdAt: messageResult.rows[0].created_at,
      };

      // Emit message to conversation room
      io.to(`conversation:${conversationId}`).emit("message:received", message);

      // Also send to the other user's personal room (in case they're not in the conversation room)
      io.to(`user:${otherUserId}`).emit("conversation:updated", {
        id: conversationId,
        lastMessage: content,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error handling new message:", error);
      socket.emit("error", { message: "Error sending message" });
    }
  });

  // Handle typing indicator
  socket.on("typing:start", (conversationId) => {
    socket.to(`conversation:${conversationId}`).emit("typing:update", {
      conversationId,
      userId,
      username: socket.username,
      isTyping: true,
    });
  });

  socket.on("typing:stop", (conversationId) => {
    socket.to(`conversation:${conversationId}`).emit("typing:update", {
      conversationId,
      userId,
      username: socket.username,
      isTyping: false,
    });
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
        WHERE conversation_id = $1 AND sender_id != $2 AND read_at IS NULL
      `,
        [conversationId, userId]
      );

      // Emit read status update to conversation
      socket.to(`conversation:${conversationId}`).emit("message:status", {
        conversationId,
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
