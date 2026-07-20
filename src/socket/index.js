const socketIo = require("socket.io");
const { isAllowedOrigin } = require("../utils/allowedOrigins");
const { authenticateSocket } = require("./socketAuth");
const { registerPresence, registerDisconnectHandler } = require("./presence");
const {
  registerConversationHandlers,
} = require("./handlers/conversationHandlers");
const { registerMessageHandlers } = require("./handlers/messageHandlers");
const { registerTypingHandlers } = require("./handlers/typingHandlers");
const { registerReadHandlers } = require("./handlers/readHandlers");

// Attach Socket.IO to the HTTP server and wire up auth plus every event handler.
// Returns the io instance, which is also exposed to controllers via
// `req.app.get("io")`.
const initSocket = (server, app) => {
  // Set up Socket.IO with CORS
  const io = socketIo(server, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Make io accessible to controllers via req.app.get("io")
  app.set("io", io);

  io.use(authenticateSocket);

  // Socket.IO connection handling
  io.on("connection", (socket) => {
    const userId = socket.userId;
    if (process.env.NODE_ENV !== "production") {
      console.log(`User connected: ${userId} (${socket.username})`);
    }

    registerPresence(io, socket, userId);

    registerConversationHandlers(io, socket, userId);
    registerMessageHandlers(io, socket, userId);
    registerTypingHandlers(io, socket, userId);
    registerReadHandlers(io, socket, userId);

    registerDisconnectHandler(io, socket, userId);
  });

  return io;
};

module.exports = { initSocket };
