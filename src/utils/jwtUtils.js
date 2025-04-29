const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Debug logging
console.log("JWT_SECRET loaded:", JWT_SECRET ? "Yes (first 3 chars: " + JWT_SECRET.substring(0, 3) + "...)" : "NO - CHECK YOUR .ENV FILE");
console.log("JWT_EXPIRES_IN:", JWT_EXPIRES_IN);

/**
 * Generate a JWT token for a user
 * @param {Object} user - User object (typically from database)
 * @returns {String} JWT token
 */
const generateToken = (user) => {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email
  };

  console.log(`Generating token for user ID: ${user.id}, username: ${user.username}`);
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Verify a JWT token
 * @param {String} token - JWT token to verify
 * @returns {Object} Decoded token payload or null if invalid
 */
const verifyToken = (token) => {
  try {
    console.log("Verifying token...");
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log(`Token verified successfully for user ID: ${decoded.id}`);
    return decoded;
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken
};