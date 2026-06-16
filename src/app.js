const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const { buildErrorResponse } = require("./utils/errorResponse");
const { csrfProtection } = require("./middlewares/csrfProtection");
const { isAllowedOrigin } = require("./utils/allowedOrigins");

dotenv.config();

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const corsOptions = {
  origin(origin, callback) {
    if (process.env.NODE_ENV !== "production") {
      console.log("CORS origin:", origin);
    }

    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.error(`CORS blocked: origin ${origin} not allowed`);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Body parsing and other middleware run AFTER CORS so that error responses
// (e.g. for a malformed/empty body) still carry the CORS headers — otherwise
// the browser blocks the response and the client only sees a network error.
app.use(helmet());
app.use(cookieParser());
app.use(csrfProtection);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
    );
    next();
  });
}

const apiRoutes = require("./routes");
app.use("/api", apiRoutes);

app.get("/", (req, res) => {
  res.send("Lomir API is running...");
});

app.use((req, res) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[${new Date().toISOString()}] No route matched: ${req.method} ${req.originalUrl}`
    );
  }
  res.status(404).json({
    success: false,
    message: `Resource not found. Cannot ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }

  const { statusCode, body } = buildErrorResponse(err);

  res.status(statusCode).json(body);
});

module.exports = app;
