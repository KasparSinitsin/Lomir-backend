const { AUTH_COOKIE_NAME } = require("../utils/authCookie");
const {
  getOriginFromReferer,
  isAllowedOrigin,
} = require("../utils/allowedOrigins");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const getHeader = (req, name) => {
  if (typeof req.get === "function") {
    return req.get(name);
  }

  return req.headers?.[name.toLowerCase()];
};

const hasSessionCookie = (req) =>
  Boolean(req.cookies && req.cookies[AUTH_COOKIE_NAME]);

const hasBearerToken = (req) => {
  const authorization = getHeader(req, "Authorization");
  return /^Bearer\s+\S+/i.test(authorization || "");
};

const getRequestOrigin = (req) => {
  const origin = getHeader(req, "Origin");
  if (origin) {
    return { source: "Origin", value: origin };
  }

  const refererOrigin = getOriginFromReferer(
    getHeader(req, "Referer") || getHeader(req, "Referrer"),
  );

  if (refererOrigin) {
    return { source: "Referer", value: refererOrigin };
  }

  return null;
};

const sendForbidden = (res, message) =>
  res.status(403).json({
    success: false,
    message,
  });

const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const requestOrigin = getRequestOrigin(req);

  if (requestOrigin) {
    if (isAllowedOrigin(requestOrigin.value)) {
      return next();
    }

    console.warn(
      `CSRF blocked: ${requestOrigin.source} ${requestOrigin.value} is not allowed for ${req.method} ${req.originalUrl}`,
    );

    return sendForbidden(res, "Request origin is not allowed.");
  }

  // Non-browser API clients often have no Origin/Referer. Keep those working
  // unless the request relies on the browser session cookie, which is the CSRF
  // risk introduced by SameSite=None cross-site cookies.
  if (hasSessionCookie(req) && !hasBearerToken(req)) {
    console.warn(
      `CSRF blocked: missing Origin/Referer for cookie-authenticated ${req.method} ${req.originalUrl}`,
    );

    return sendForbidden(res, "Request origin is required.");
  }

  return next();
};

module.exports = {
  csrfProtection,
  getRequestOrigin,
};
