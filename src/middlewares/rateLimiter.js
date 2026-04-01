const rateLimit = require("express-rate-limit");

const createRateLimiter = ({ windowMs, max, message }) =>
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
  max: 5,
  message: "Too many registration attempts. Please try again later.",
});

const generalApiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: "Too many requests. Please slow down.",
});

module.exports = {
  authLimiter,
  registerLimiter,
  generalApiLimiter,
};
