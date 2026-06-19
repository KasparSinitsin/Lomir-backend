const { verifyToken } = require('../utils/jwtUtils');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');
const db = require('../config/database');

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
 * Reject tokens that were issued before the user's most recent password change.
 * Changing the password stamps users.password_changed_at, which retroactively
 * invalidates every session/device that was authenticated with an older token.
 *
 * Returns true when the token is still valid for this user, false when it must
 * be treated as logged out (stale token or the user no longer exists).
 */
const isTokenStillValidForUser = async (decoded) => {
  const result = await db.query(
    'SELECT password_changed_at FROM users WHERE id = $1',
    [decoded.id],
  );

  if (result.rows.length === 0) {
    return false; // User was deleted — any lingering token is invalid.
  }

  const passwordChangedAt = result.rows[0].password_changed_at;

  if (!passwordChangedAt) {
    return true; // Password has never been changed since this feature shipped.
  }

  // JWT `iat` is in whole seconds; compare at second granularity so a freshly
  // issued token is never rejected by sub-second rounding. The token is stale
  // only if the password changed in a strictly later second than it was issued.
  const passwordChangedAtSeconds = Math.floor(
    new Date(passwordChangedAt).getTime() / 1000,
  );

  return (
    typeof decoded.iat === 'number' && decoded.iat >= passwordChangedAtSeconds
  );
};

/**
 * Middleware to authenticate JWT token
 */
const authenticateToken = async (req, res, next) => {
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

  try {
    if (!(await isTokenStillValidForUser(decoded))) {
      if (process.env.NODE_ENV !== 'production') {
        console.log("Token rejected: issued before the user's last password change");
      }
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
      });
    }
  } catch (error) {
    console.error('Error checking token validity:', error);
    return res.status(500).json({
      success: false,
      message: 'Error authenticating request.',
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
const optionalAuthenticateToken = async (req, res, next) => {
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

  try {
    if (!(await isTokenStillValidForUser(decoded))) {
      if (process.env.NODE_ENV !== 'production') {
        console.log("Stale token on optional-auth route, continuing as unauthenticated user");
      }
      req.user = null;
      return next();
    }
  } catch (error) {
    console.error('Error checking token validity (optional auth):', error);
    req.user = null;
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
  optionalAuthenticateToken,
  isTokenStillValidForUser
};
