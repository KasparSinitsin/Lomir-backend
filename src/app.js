const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const explicitOrigins = [
  "http://localhost:5173",
  "https://lomir-frontend.vercel.app",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

const normalizeOrigin = (origin) => {
  if (!origin) return origin;
  return origin.replace(/\/$/, "");
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  const normalizedExplicit = explicitOrigins.map(normalizeOrigin);

  if (normalizedExplicit.includes(normalized)) {
    return true;
  }

  try {
    const url = new URL(normalized);

    if (
      url.protocol === "https:" &&
      (url.hostname === "lomir-frontend.vercel.app" ||
        url.hostname.endsWith(".vercel.app"))
    ) {
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
};

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
  console.error(err.stack);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

module.exports = app;
