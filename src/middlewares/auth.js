const { verifyToken } = require('../utils/jwtUtils');

/**
 * Middleware to authenticate JWT token
 */
const authenticateToken = (req, res, next) => {
  console.log(`Request to ${req.method} ${req.path}`);
  
  // Get the token from the Authorization header
  const authHeader = req.headers['authorization'];
  console.log("Authorization header:", authHeader ? "Present" : "Missing");
  
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"
  
  if (!token) {
    console.log("No token provided in request");
    return res.status(401).json({ 
      success: false, 
      message: 'Access denied. No token provided.' 
    });
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    console.log("Token verification failed");
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token.' 
    });
  }
  
  // Add the user info to the request
  req.user = decoded;
  console.log(`User authenticated: ID=${decoded.id}, username=${decoded.username}`);
  next();
};

/**
 * Optional authentication middleware - will set req.user if token is valid,
 * but will continue even if no token is provided
 */
const optionalAuthenticateToken = (req, res, next) => {
  console.log(`Request to ${req.method} ${req.path} (optional auth)`);
  
  // Get the token from the Authorization header
  const authHeader = req.headers['authorization'];
  console.log("Authorization header:", authHeader ? "Present" : "Missing");
  
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"
  
  if (!token) {
    console.log("No token provided, continuing as unauthenticated user");
    req.user = null; // Explicitly set user to null
    return next();
  }
  
  const decoded = verifyToken(token);
  
  if (!decoded) {
    console.log("Token verification failed, continuing as unauthenticated user");
    req.user = null; // Explicitly set user to null
    return next();
  }
  
  // Add the user info to the request
  req.user = decoded;
  console.log(`User authenticated: ID=${decoded.id}, username=${decoded.username}`);
  next();
};

module.exports = {
  authenticateToken,
  optionalAuthenticateToken
};