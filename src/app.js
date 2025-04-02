const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const tagRoutes = require('./routes/api/tags');
app.use('/api/tags', tagRoutes);

// If you have other API routes to include
try {
  const routes = require('./routes');
  app.use('/api', routes);
} catch (error) {
  console.log('No general routes module found or error importing:', error.message);
}

// Home route
app.get('/', (req, res) => {
  res.send('Lomir API is running...');
});

// Error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

module.exports = app;