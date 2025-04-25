const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
// const path = require('path'); // Uncomment if serving static files

// Load environment variables from .env file
dotenv.config();

const app = express();

// --- Middleware Setup ---

// Body Parsers for JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration
const allowedOrigins = [
  'https://lomir.onrender.com', // Your deployed frontend
  'http://localhost:5173',    // Your local frontend development server
  // Add any other origins as needed
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests) or from allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS blocked: origin ${origin} not in allowed list.`); // Log blocked origins
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  credentials: true, // Allow cookies/authorization headers to be sent
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS', // Allowed HTTP methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
};

// Apply CORS middleware
app.use(cors(corsOptions));
// Handle preflight requests (OPTIONS) which CORS middleware usually handles,
// but explicit handling can sometimes be necessary depending on setup.
// app.options('*', cors(corsOptions)); // Uncomment if preflight issues persist

// --- DEBUGGING: Log incoming requests (Placed BEFORE API routes) ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Incoming request: ${req.method} ${req.originalUrl}`);
  // Optional: Log body or headers if needed for deep debugging
  // if (req.body && Object.keys(req.body).length > 0) console.log('Request Body:', req.body);
  // console.log('Request Headers:', req.headers);
  next(); // Pass control to the next middleware/route handler
});
// --- END DEBUGGING ---


// --- API Routes ---
// Define specific API routes first. Order matters.

// Auth routes
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// Search routes
const searchRoutes = require('./routes/searchRoutes');
app.use('/api/search', searchRoutes);

// Team routes
const teamRoutes = require('./routes/teamRoutes');
app.use('/api/teams', teamRoutes);

// User routes (This is where PUT /api/users/:id should be handled)
const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

// Tag routes
// *** CHECK THIS PATH: Ensure './routes/api/tags' is the correct location of your tag routes file. ***
// If it's in './routes/tagRoutes.js', use require('./routes/tagRoutes') instead.
const tagRoutes = require('./routes/api/tags');
app.use('/api/tags', tagRoutes);

// Simple Home route (Optional)
app.get('/', (req, res) => {
  res.send('Lomir API is running...');
});


// --- Error Handling & Not Found ---
// IMPORTANT: Define these AFTER all valid API and static file routes.

// Catch-all for 404 Not Found errors (Routes not matched above)
// This should come BEFORE the general error handler.
app.use((req, res, next) => {
  // Log the unmatched route attempt
  console.log(`[${new Date().toISOString()}] No route matched for: ${req.method} ${req.originalUrl}`);
  // Send a JSON 404 response
  res.status(404).json({
      success: false, // Consistent response structure
      message: `Resource not found. Cannot ${req.method} ${req.originalUrl}`
  });
  // Note: No 'next(err)' here, this is a final response for 404.
});

// General Error Handler (Catches errors passed via next(err))
// This should be the LAST piece of middleware.
app.use((err, req, res, next) => {
  // Log the error details
  console.error(`[${new Date().toISOString()}] Unhandled Error: ${err.message}`);
  console.error(err.stack); // Log stack trace for debugging

  const statusCode = err.statusCode || 500; // Use error's status code or default to 500

  // Send a JSON response detailing the error
  res.status(statusCode).json({
    success: false, // Consistent response structure
    message: err.message || 'An unexpected internal server error occurred.',
    // Only include stack trace in development for security reasons
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});


// Export the configured app instance (e.g., for use in server.js or testing)
module.exports = app;

// Note: The app.listen() call is typically in a separate file (e.g., server.js)
// that imports this app.js file. Example:
/*
// In server.js
const app = require('./app');
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
*/
