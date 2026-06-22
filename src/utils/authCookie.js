const cookie = require("cookie");

// Name of the httpOnly cookie that carries the session JWT.
const AUTH_COOKIE_NAME = "token";

// Keep the cookie lifetime aligned with the JWT expiry (default 7 days).
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Cookie attributes for the session token.
 *
 * In production the app is served same-origin — Vercel reverse-proxies `/api/*`
 * and `/socket.io/*` to the Render backend (see the frontend `vercel.json`), so
 * the session cookie is first-party. `sameSite: "lax"` therefore suffices and is
 * preferred: it keeps the cookie from being sent on cross-site requests at all
 * (a stronger CSRF posture than `"none"`), while still covering the app's
 * same-site navigations and XHR/fetch. `secure: true` in production (HTTPS);
 * locally `sameSite: "lax"` works over plain HTTP on localhost.
 *
 * `clear` omits `maxAge`/`expires` so the same attributes can be reused to
 * delete the cookie (the attributes must match for the browser to remove it).
 */
const buildCookieOptions = ({ clear = false } = {}) => {
  const options = {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
  };

  if (!clear) {
    options.maxAge = SEVEN_DAYS_MS;
  }

  return options;
};

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, buildCookieOptions());
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, buildCookieOptions({ clear: true }));
};

/**
 * Read the session token from a raw Cookie header string. Used by the Socket.IO
 * handshake, which is not processed by the cookie-parser Express middleware.
 */
const getTokenFromCookieHeader = (cookieHeader) => {
  if (!cookieHeader) return null;
  try {
    const parsed = cookie.parse(cookieHeader);
    return parsed[AUTH_COOKIE_NAME] || null;
  } catch (error) {
    return null;
  }
};

module.exports = {
  AUTH_COOKIE_NAME,
  setAuthCookie,
  clearAuthCookie,
  getTokenFromCookieHeader,
};
