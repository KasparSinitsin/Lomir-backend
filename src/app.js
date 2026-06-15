const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const { buildErrorResponse } = require("./utils/errorResponse");

dotenv.config();

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

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

    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }

    if (
      url.protocol === "https:" &&
      (url.hostname === "lomir-frontend.vercel.app" ||
        /^lomir-frontend-[a-z0-9]+-juliabaurs-projects\.vercel\.app$/.test(
          url.hostname
        ))
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
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }

  const { statusCode, body } = buildErrorResponse(err);

  res.status(statusCode).json(body);
});

module.exports = app;
