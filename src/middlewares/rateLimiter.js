const rateLimit = require("express-rate-limit");
const { CONTACT_ERROR_CODES } = require("../config/contactErrors");

/**
 * `code` is optional and additive: a limiter that passes one lets the frontend
 * translate the refusal, and a limiter that does not keeps sending prose only,
 * exactly as before. Added for the contact form (the first surface to send
 * error codes — see `config/contactErrors.js`); the other five limiters are
 * unchanged and can adopt it one at a time.
 */
const createRateLimiter = ({ windowMs, max, message, code }) =>
  rateLimit({
    windowMs,
    max,
    message,
    statusCode: 429,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json({
        success: false,
        ...(code ? { code } : {}),
        message: options.message,
      });
    },
  });

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many attempts. Please try again in 15 minutes.",
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many registration attempts. Please try again later.",
});

// Authenticated account changes (change-email / change-password). Kept separate
// from authLimiter so a user mistyping their current password can't burn through
// the shared login budget (and vice versa); slightly more generous since these
// already require an authenticated session plus the current password.
const accountChangeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many account-change attempts. Please try again in 15 minutes.",
});

const usernameAvailabilityLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many username checks. Please try again later.",
});

const contactLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many messages. Please try again later.",
  code: CONTACT_ERROR_CODES.RATE_LIMITED,
});

// Public postal-code lookup. Generous enough for typing-driven autofill, but
// caps abuse of the endpoint and its upstream Nominatim (OSM) usage.
const geocodingLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many location lookups. Please try again later.",
});

module.exports = {
  authLimiter,
  registerLimiter,
  accountChangeLimiter,
  usernameAvailabilityLimiter,
  contactLimiter,
  geocodingLimiter,
};
