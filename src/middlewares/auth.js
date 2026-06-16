const { verifyToken } = require('../utils/jwtUtils');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');

/**
 * Extract the session token, preferring the httpOnly cookie and falling back
 * to the Authorization header (for API clients / backward compatibility).
 */
const getTokenFromRequest = (req) => {
  const cookieToken = req.cookies && req.cookies[AUTH_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"
};

/**
 * Middleware to authenticate JWT token
 */
const authenticateToken = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Request to ${req.method} ${req.path}`);
  }

  const token = getTokenFromRequest(req);

  if (!token) {
    if (process.env.NODE_ENV !== 'production') {
      console.log("No token provided in request");
    }
    return res.status(401).json({ 
      success: false, 
      message: 'Access denied. No token provided.' 
    });
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    if (process.env.NODE_ENV !== 'production') {
      console.log("Token verification failed");
    }
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token.' 
    });
  }
  
  // Add the user info to the request
  req.user = decoded;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`User authenticated: ID=${decoded.id}, username=${decoded.username}`);
  }
  next();
};

/**
 * Optional authentication middleware - will set req.user if token is valid,
 * but will continue even if no token is provided
 */
const optionalAuthenticateToken = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Request to ${req.method} ${req.path} (optional auth)`);
  }

  const token = getTokenFromRequest(req);

  if (!token) {
    if (process.env.NODE_ENV !== 'production') {
      console.log("No token provided, continuing as unauthenticated user");
    }
    req.user = null; // Explicitly set user to null
    return next();
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    if (process.env.NODE_ENV !== 'production') {
      console.log("Token verification failed, continuing as unauthenticated user");
    }
    req.user = null; // Explicitly set user to null
    return next();
  }
  
  // Add the user info to the request
  req.user = decoded;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`User authenticated: ID=${decoded.id}, username=${decoded.username}`);
  }
  next();
};

module.exports = {
  authenticateToken,
  optionalAuthenticateToken
};
