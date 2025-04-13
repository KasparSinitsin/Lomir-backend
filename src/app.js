const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// *** Middleware ***
// Body Parsers (for JSON and URL-encoded data)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Configuration
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const corsOptions = {
  origin: frontendOrigin,
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization',
};
app.use(cors(corsOptions));

// *** Routes ***
const tagRoutes = require('./routes/api/tags');
app.use('/api/tags', tagRoutes);

// Importing search routes and ensuring they are used under '/api/search'
const searchRoutes = require('./routes/searchRoutes'); // Ensure correct path
app.use('/api/search', searchRoutes);

// Home route (optional)
app.get('/', (req, res) => {
  res.send('Lomir API is running...');
});

// *** Error Handling Middleware (Last middleware) ***
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err); // Log the full error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack, // Don't send stack in production
  });
});

module.exports = app;