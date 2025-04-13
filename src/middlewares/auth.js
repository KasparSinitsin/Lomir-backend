const { verifyToken } = require('../utils/jwtUtils');

/**
 * Middleware to authenticate JWT token
 */
const authenticateToken = (req, res, next) => {
  // Get the token from the Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access denied. No token provided.' 
    });
  }

  try {
    // Verify the token
    const decoded = verifyToken(token);

    // Add the user info to the request
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token.',
      error: error.message
    });
  }
};

module.exports = {
  authenticateToken
};