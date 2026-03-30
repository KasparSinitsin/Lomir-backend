const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const app = express();

// --- Middleware Setup ---

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- CORS Configuration ---
const allowedOrigins = [
  "http://localhost:5173",
  "https://lomir-frontend.vercel.app",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.error(`CORS blocked: origin ${origin} not allowed`);
      return callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Apply CORS
app.use(cors(corsOptions));

// Explicitly handle preflight requests
app.options("*", cors(corsOptions));

// --- Debug logging (only in development) ---
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
    );
    next();
  });
}

// --- API Routes ---
const apiRoutes = require("./routes");
app.use("/api", apiRoutes);

// Root route
app.get("/", (req, res) => {
  res.send("Lomir API is running...");
});

// --- 404 Handler ---
app.use((req, res) => {
  console.log(
    `[${new Date().toISOString()}] No route matched: ${req.method} ${req.originalUrl}`
  );
  res.status(404).json({
    success: false,
    message: `Resource not found. Cannot ${req.method} ${req.originalUrl}`,
  });
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error(
    `[${new Date().toISOString()}] Error: ${err.message}`
  );
  console.error(err.stack);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

module.exports = app;