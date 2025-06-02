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

      console.log(
        `User ${userId} sending message to conversation ${conversationId}: "${content}"`
      );

      // Validate message
      if (!conversationId || !content || content.trim() === "") {
        socket.emit("error", { message: "Invalid message data" });
        return;
      }

      const db = require("./config/database");

      // For direct messages, conversationId is the recipient's user ID
      const messageResult = await db.query(
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
      };

      console.log("Broadcasting message:", message);

      // Emit message to both users
      io.to(`user:${userId}`).emit("message:received", message);
      io.to(`user:${conversationId}`).emit("message:received", message);
    } catch (error) {
      console.error("Error handling new message:", error);
      socket.emit("error", { message: "Error sending message" });
    }
  });

  // Handle typing indicator
  socket.on("typing:start", (conversationId) => {
    console.log(
      `User ${userId} started typing in conversation ${conversationId}`
    );

    // For direct messages, conversationId is the other user's ID
    // Send typing indicator to the specific user in the conversation
    // But send it with the sender's ID as the conversationId (from recipient's perspective)
    socket.to(`user:${conversationId}`).emit("typing:update", {
      conversationId: String(userId), // Use sender's ID as conversationId
      userId,
      username: socket.username,
      isTyping: true,
    });
  });

  socket.on("typing:stop", (conversationId) => {
    console.log(
      `User ${userId} stopped typing in conversation ${conversationId}`
    );

    // For direct messages, conversationId is the other user's ID
    // Send stop typing indicator to the specific user in the conversation
    // But send it with the sender's ID as the conversationId (from recipient's perspective)
    socket.to(`user:${conversationId}`).emit("typing:update", {
      conversationId: String(userId), // <-- CHANGED: Use sender's ID as conversationId
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
