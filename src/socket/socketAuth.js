const { verifyToken } = require("../utils/jwtUtils");
const { getTokenFromCookieHeader } = require("../utils/authCookie");
const { isTokenStillValidForUser } = require("../middlewares/auth");

// Socket.IO middleware for authentication
const authenticateSocket = async (socket, next) => {
  // Prefer the httpOnly session cookie sent with the handshake; fall back to
  // an explicit auth token (backward compatibility / non-browser clients).
  const token =
    getTokenFromCookieHeader(socket.handshake.headers.cookie) ||
    socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error: Token missing"));
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return next(new Error("Authentication error: Invalid token"));
  }

  // Reject tokens issued before the user's last password change, matching the
  // HTTP auth middleware so a stale token cannot open a realtime connection.
  try {
    if (!(await isTokenStillValidForUser(decoded))) {
      return next(new Error("Authentication error: Session expired"));
    }
  } catch (error) {
    console.error("Socket auth validity check failed:", error);
    return next(new Error("Authentication error"));
  }

  // Store user info in socket object
  socket.userId = decoded.id;
  socket.username = decoded.username;
  next();
};

module.exports = { authenticateSocket };
